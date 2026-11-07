ALTER TABLE public.invoices ADD COLUMN business_date date NOT NULL DEFAULT CURRENT_DATE;

CREATE OR REPLACE FUNCTION public.open_cash_session(p_location_id uuid, p_opened_by text, p_opening_cash numeric, p_opening_denominations jsonb DEFAULT NULL::jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF p_opening_cash < 0 THEN RAISE EXCEPTION 'Opening cash cannot be negative'; END IF;
  INSERT INTO public.cash_drawer_sessions (location_id, opened_by, opening_cash, opening_denominations)
  VALUES (p_location_id, COALESCE(NULLIF(p_opened_by, ''), 'Operator'), COALESCE(p_opening_cash, 0), p_opening_denominations)
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.close_cash_session(p_session_id uuid, p_cash_in numeric, p_cash_out numeric, p_counted_cash numeric, p_closing_denominations jsonb DEFAULT NULL::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_session record;
  v_cash_sales numeric := 0;
  v_in numeric;
  v_out numeric;
  v_expected numeric;
BEGIN
  SELECT * INTO v_session FROM public.cash_drawer_sessions WHERE id = p_session_id AND status = 'OPEN' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No open session'; END IF;
  SELECT COALESCE(SUM(p.amount), 0) INTO v_cash_sales
  FROM public.payments p JOIN public.invoices i ON i.id = p.invoice_id
  WHERE i.location_id = v_session.location_id AND p.mode = 'CASH'
    AND p.created_at >= v_session.opened_at AND p.created_at <= now();
  v_in := COALESCE(p_cash_in, v_session.cash_in);
  v_out := COALESCE(p_cash_out, v_session.cash_out);
  v_expected := v_session.opening_cash + v_cash_sales + v_in - v_out;
  UPDATE public.cash_drawer_sessions
  SET status = 'CLOSED', cash_sales = v_cash_sales, cash_in = v_in, cash_out = v_out,
      closing_cash = COALESCE(p_counted_cash, v_expected), closed_at = now(),
      closing_denominations = COALESCE(p_closing_denominations, closing_denominations)
  WHERE id = p_session_id;
  RETURN jsonb_build_object('cash_sales', v_cash_sales, 'expected_cash', v_expected,
    'difference', COALESCE(p_counted_cash, v_expected) - v_expected);
END $function$;

CREATE OR REPLACE FUNCTION public.create_pos_invoice(p_location_id uuid, p_customer_id uuid, p_discount numeric, p_items jsonb, p_payments jsonb, p_business_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice_id uuid;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_item jsonb;
  v_credit numeric := 0;
BEGIN
  IF p_business_date IS NULL THEN RAISE EXCEPTION 'Billing date is required'; END IF;
  PERFORM set_config('app.movement_type', 'SALE', true);
  INSERT INTO public.invoices (location_id, customer_id, discount_amount, business_date)
  VALUES (p_location_id, p_customer_id, COALESCE(p_discount, 0), p_business_date)
  RETURNING id INTO v_invoice_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.invoice_items (invoice_id, product_id, quantity, unit_price, uom, discount, total)
    VALUES (v_invoice_id, (v_item->>'product_id')::uuid, (v_item->>'quantity')::numeric,
      (v_item->>'unit_price')::numeric, COALESCE(v_item->>'uom', 'UNIT'),
      COALESCE((v_item->>'discount')::numeric, 0), (v_item->>'total')::numeric);
    v_total := v_total + COALESCE((v_item->>'total')::numeric, 0);
  END LOOP;
  v_total := v_total - COALESCE(p_discount, 0);
  UPDATE public.invoices SET total_amount = v_total WHERE id = v_invoice_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_payments, '[]'::jsonb))
  LOOP
    INSERT INTO public.payments (invoice_id, customer_id, amount, mode, tendered, change_given)
    VALUES (v_invoice_id, p_customer_id, (v_item->>'amount')::numeric, COALESCE(v_item->>'mode', 'CASH'),
      (v_item->>'tendered')::numeric, (v_item->>'change_given')::numeric);
    v_paid := v_paid + (v_item->>'amount')::numeric;
    IF COALESCE(v_item->>'mode', 'CASH') = 'CREDIT' THEN v_credit := v_credit + (v_item->>'amount')::numeric; END IF;
  END LOOP;
  UPDATE public.invoices SET paid_amount = v_paid, balance_amount = GREATEST(v_total - v_paid, 0),
    payment_status = CASE WHEN v_paid >= v_total THEN 'PAID' WHEN v_paid > 0 THEN 'PARTIALLY_PAID' ELSE 'UNPAID' END
  WHERE id = v_invoice_id;
  IF v_credit > 0 AND p_customer_id IS NOT NULL THEN
    UPDATE public.customers SET outstanding_balance = outstanding_balance + v_credit WHERE id = p_customer_id;
  END IF;
  IF p_customer_id IS NOT NULL THEN UPDATE public.customers SET visits = visits + 1 WHERE id = p_customer_id; END IF;
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
END $function$;