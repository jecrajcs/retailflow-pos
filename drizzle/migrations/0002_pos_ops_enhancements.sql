-- Product pre-fill enhancements: variant, rack location, floor price
ALTER TABLE public.products ADD COLUMN variant text;
ALTER TABLE public.products ADD COLUMN rack_location text;
ALTER TABLE public.products ADD COLUMN min_sale_price numeric NOT NULL DEFAULT 0;

-- Customer demographics: visit count
ALTER TABLE public.customers ADD COLUMN visits integer NOT NULL DEFAULT 0;

-- Payment cash tendered / change return
ALTER TABLE public.payments ADD COLUMN tendered numeric;
ALTER TABLE public.payments ADD COLUMN change_given numeric;

-- Backfills (part of the additive change)
UPDATE public.products SET rack_location = CASE category
  WHEN 'Dairy' THEN 'Rack D1'
  WHEN 'Snacks' THEN 'Rack S1'
  WHEN 'Spices' THEN 'Rack S2'
  WHEN 'Grocery' THEN 'Rack G1'
  WHEN 'Beverages' THEN 'Rack B1'
  WHEN 'Household' THEN 'Rack H1'
  WHEN 'Personal Care' THEN 'Rack P1'
  ELSE 'Rack U1' END
WHERE rack_location IS NULL;

UPDATE public.products SET min_sale_price = GREATEST(purchase_cost, round(sale_price * 0.9, 2))
WHERE min_sale_price = 0;

UPDATE public.customers c SET visits = (SELECT count(*) FROM public.invoices i WHERE i.customer_id = c.id);

-- Cash In/Out history log for the drawer
CREATE TABLE public.cash_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.cash_drawer_sessions(id) ON DELETE SET NULL,
  location_id uuid NOT NULL REFERENCES public.locations(id),
  direction text NOT NULL CHECK (direction IN ('IN','OUT')),
  amount numeric NOT NULL,
  reason text NOT NULL DEFAULT 'OTHER',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.cash_transactions TO anon;
GRANT ALL ON public.cash_transactions TO service_role;

ALTER TABLE public.cash_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open access" ON public.cash_transactions
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- Log one cash in/out event and keep the open shift's running totals in sync
CREATE OR REPLACE FUNCTION public.log_cash_txn(
  p_session_id uuid, p_location_id uuid, p_direction text, p_amount numeric, p_reason text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.cash_transactions (session_id, location_id, direction, amount, reason)
  VALUES (p_session_id, p_location_id, p_direction, p_amount, COALESCE(p_reason, 'OTHER'))
  RETURNING id INTO v_id;

  IF p_session_id IS NOT NULL THEN
    IF p_direction = 'IN' THEN
      UPDATE public.cash_drawer_sessions SET cash_in = cash_in + p_amount WHERE id = p_session_id AND status = 'OPEN';
    ELSE
      UPDATE public.cash_drawer_sessions SET cash_out = cash_out + p_amount WHERE id = p_session_id AND status = 'OPEN';
    END IF;
  END IF;
  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.log_cash_txn(uuid, uuid, text, numeric, text) TO anon, service_role;

-- Close shift: NULL cash_in/out means "use the running totals already logged on the shift"
CREATE OR REPLACE FUNCTION public.close_cash_session(
  p_session_id uuid, p_cash_in numeric, p_cash_out numeric, p_counted_cash numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session record;
  v_cash_sales numeric := 0;
  v_in numeric;
  v_out numeric;
  v_expected numeric;
BEGIN
  SELECT * INTO v_session FROM public.cash_drawer_sessions WHERE id = p_session_id AND status = 'OPEN';
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
      closing_cash = COALESCE(p_counted_cash, v_expected), closed_at = now()
  WHERE id = p_session_id;

  RETURN jsonb_build_object('cash_sales', v_cash_sales, 'expected_cash', v_expected,
    'difference', COALESCE(p_counted_cash, v_expected) - v_expected);
END $$;

GRANT EXECUTE ON FUNCTION public.close_cash_session(uuid, numeric, numeric, numeric) TO anon, service_role;

-- Invoice creation: count the customer visit and record tendered/change on cash payments
CREATE OR REPLACE FUNCTION public.create_pos_invoice(
  p_location_id uuid, p_customer_id uuid, p_discount numeric, p_items jsonb, p_payments jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    INSERT INTO public.payments (invoice_id, customer_id, amount, mode, tendered, change_given)
    VALUES (
      v_invoice_id, p_customer_id,
      (v_item->>'amount')::numeric,
      COALESCE(v_item->>'mode', 'CASH'),
      (v_item->>'tendered')::numeric,
      (v_item->>'change_given')::numeric
    );
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

  IF p_customer_id IS NOT NULL THEN
    UPDATE public.customers SET visits = visits + 1 WHERE id = p_customer_id;
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

GRANT EXECUTE ON FUNCTION public.create_pos_invoice(uuid, uuid, numeric, jsonb, jsonb) TO anon, service_role;