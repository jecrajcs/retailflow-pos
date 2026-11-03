CREATE SEQUENCE IF NOT EXISTS public.invoice_number_seq;

CREATE OR REPLACE FUNCTION public.set_invoice_number()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
    NEW.invoice_number := 'INV-' || to_char(now(), 'YYMMDD') || '-' || lpad(nextval('public.invoice_number_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_set_invoice_number BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.set_invoice_number();

CREATE OR REPLACE FUNCTION public.create_pos_invoice(
  p_location_id uuid,
  p_customer_id uuid,
  p_discount numeric,
  p_items jsonb,
  p_payments jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_invoice_id uuid;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_item jsonb;
  v_credit numeric := 0;
BEGIN
  INSERT INTO public.invoices (location_id, customer_id, discount_amount)
  VALUES (p_location_id, p_customer_id, COALESCE(p_discount, 0))
  RETURNING id INTO v_invoice_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.invoice_items (invoice_id, product_id, quantity, unit_price, uom, discount, total)
    VALUES (
      v_invoice_id,
      (v_item->>'product_id')::uuid,
      (v_item->>'quantity')::numeric,
      (v_item->>'unit_price')::numeric,
      COALESCE(v_item->>'uom', 'UNIT'),
      COALESCE((v_item->>'discount')::numeric, 0),
      (v_item->>'total')::numeric
    );
    v_total := v_total + COALESCE((v_item->>'total')::numeric, 0);
  END LOOP;

  v_total := v_total - COALESCE(p_discount, 0);
  UPDATE public.invoices SET total_amount = v_total WHERE id = v_invoice_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_payments, '[]'::jsonb))
  LOOP
    INSERT INTO public.payments (invoice_id, customer_id, amount, mode)
    VALUES (v_invoice_id, p_customer_id, (v_item->>'amount')::numeric, COALESCE(v_item->>'mode', 'CASH'));
    v_paid := v_paid + (v_item->>'amount')::numeric;
    IF COALESCE(v_item->>'mode', 'CASH') = 'CREDIT' THEN
      v_credit := v_credit + (v_item->>'amount')::numeric;
    END IF;
  END LOOP;

  UPDATE public.invoices
  SET paid_amount = v_paid, balance_amount = GREATEST(v_total - v_paid, 0),
      payment_status = CASE
        WHEN v_paid >= v_total THEN 'PAID'
        WHEN v_paid > 0 THEN 'PARTIALLY_PAID'
        ELSE 'UNPAID'
      END
  WHERE id = v_invoice_id;

  IF v_credit > 0 AND p_customer_id IS NOT NULL THEN
    UPDATE public.customers SET outstanding_balance = outstanding_balance + v_credit WHERE id = p_customer_id;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.inventory (product_id, location_id, quantity_on_hand)
    VALUES ((v_item->>'product_id')::uuid, p_location_id, -1 * (v_item->>'quantity')::numeric)
    ON CONFLICT (product_id, location_id)
    DO UPDATE SET quantity_on_hand = public.inventory.quantity_on_hand - (v_item->>'quantity')::numeric;
  END LOOP;

  RETURN jsonb_build_object('invoice_id', v_invoice_id,
    'invoice_number', (SELECT invoice_number FROM public.invoices WHERE id = v_invoice_id),
    'total', v_total, 'paid', v_paid);
END $$;

CREATE OR REPLACE FUNCTION public.add_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_mode text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer uuid;
  v_balance numeric;
  v_paid numeric;
BEGIN
  SELECT customer_id, balance_amount, paid_amount INTO v_customer, v_balance, v_paid
  FROM public.invoices WHERE id = p_invoice_id;
  INSERT INTO public.payments (invoice_id, customer_id, amount, mode)
  VALUES (p_invoice_id, v_customer, p_amount, p_mode);
  IF p_mode = 'CREDIT' AND v_customer IS NOT NULL THEN
    UPDATE public.customers SET outstanding_balance = outstanding_balance + p_amount WHERE id = v_customer;
  END IF;
  UPDATE public.invoices
  SET paid_amount = v_paid + p_amount,
      balance_amount = GREATEST(v_balance - p_amount, 0),
      payment_status = CASE WHEN v_balance - p_amount <= 0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END
  WHERE id = p_invoice_id;
END $$;

CREATE OR REPLACE FUNCTION public.receive_stock_transfer(p_transfer_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from uuid; v_to uuid;
  v_item record;
BEGIN
  SELECT from_location_id, to_location_id INTO v_from, v_to FROM public.stock_transfers WHERE id = p_transfer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;
  UPDATE public.stock_transfers SET status = 'RECEIVED' WHERE id = p_transfer_id;
  FOR v_item IN SELECT product_id, quantity FROM public.stock_transfer_items WHERE transfer_id = p_transfer_id
  LOOP
    UPDATE public.inventory SET quantity_on_hand = quantity_on_hand - v_item.quantity
    WHERE product_id = v_item.product_id AND location_id = v_from;
    INSERT INTO public.inventory (product_id, location_id, quantity_on_hand)
    VALUES (v_item.product_id, v_to, v_item.quantity)
    ON CONFLICT (product_id, location_id)
    DO UPDATE SET quantity_on_hand = public.inventory.quantity_on_hand + v_item.quantity;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.create_stock_adjustment(
  p_product_id uuid, p_location_id uuid, p_quantity numeric, p_reason text, p_returnable boolean
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cost numeric; v_id uuid;
BEGIN
  SELECT purchase_cost INTO v_cost FROM public.products WHERE id = p_product_id;
  INSERT INTO public.stock_adjustments (product_id, location_id, quantity, reason, returnable_to_vendor, cost_loss)
  VALUES (p_product_id, p_location_id, p_quantity, p_reason, COALESCE(p_returnable, false), p_quantity * COALESCE(v_cost, 0))
  RETURNING id INTO v_id;
  UPDATE public.inventory SET quantity_on_hand = quantity_on_hand - p_quantity
  WHERE product_id = p_product_id AND location_id = p_location_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.open_cash_session(p_location_id uuid, p_opened_by text, p_opening_cash numeric)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.cash_drawer_sessions (location_id, opened_by, opening_cash)
  VALUES (p_location_id, COALESCE(p_opened_by, 'Operator'), COALESCE(p_opening_cash, 0))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.close_cash_session(p_session_id uuid, p_cash_in numeric, p_cash_out numeric, p_counted_cash numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_session record;
  v_cash_sales numeric := 0;
  v_expected numeric;
BEGIN
  SELECT * INTO v_session FROM public.cash_drawer_sessions WHERE id = p_session_id AND status = 'OPEN';
  IF NOT FOUND THEN RAISE EXCEPTION 'No open session'; END IF;
  SELECT COALESCE(SUM(p.amount), 0) INTO v_cash_sales
  FROM public.payments p JOIN public.invoices i ON i.id = p.invoice_id
  WHERE i.location_id = v_session.location_id AND p.mode = 'CASH'
    AND p.created_at >= v_session.opened_at AND p.created_at <= now();
  v_expected := v_session.opening_cash + v_cash_sales + COALESCE(p_cash_in, 0) - COALESCE(p_cash_out, 0);
  UPDATE public.cash_drawer_sessions
  SET status = 'CLOSED', cash_sales = v_cash_sales, cash_in = COALESCE(p_cash_in, 0), cash_out = COALESCE(p_cash_out, 0),
      closing_cash = COALESCE(p_counted_cash, v_expected), closed_at = now()
  WHERE id = p_session_id;
  RETURN jsonb_build_object('cash_sales', v_cash_sales, 'expected_cash', v_expected,
    'difference', COALESCE(p_counted_cash, v_expected) - v_expected);
END $$;

GRANT EXECUTE ON FUNCTION public.create_pos_invoice(uuid, uuid, numeric, jsonb, jsonb) TO anon, service_role;
GRANT EXECUTE ON FUNCTION public.add_payment(uuid, numeric, text) TO anon, service_role;
GRANT EXECUTE ON FUNCTION public.receive_stock_transfer(uuid) TO anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_stock_adjustment(uuid, uuid, numeric, text, boolean) TO anon, service_role;
GRANT EXECUTE ON FUNCTION public.open_cash_session(uuid, text, numeric) TO anon, service_role;
GRANT EXECUTE ON FUNCTION public.close_cash_session(uuid, numeric, numeric, numeric) TO anon, service_role;
