-- Staff identity and location scope are cached on each device after the first sign-in.
CREATE TABLE IF NOT EXISTS public.staff_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('CASHIER', 'MANAGER', 'ADMIN')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.staff_location_access (
  user_id uuid NOT NULL REFERENCES public.staff_profiles(user_id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, location_id)
);

CREATE OR REPLACE FUNCTION public.current_staff_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.staff_profiles WHERE user_id = auth.uid() AND is_active = true
$$;

CREATE OR REPLACE FUNCTION public.can_access_location(p_location_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(public.current_staff_role() = 'ADMIN', false)
    OR EXISTS (
      SELECT 1 FROM public.staff_location_access access
      JOIN public.staff_profiles profile ON profile.user_id = access.user_id
      WHERE access.user_id = auth.uid() AND access.location_id = p_location_id AND profile.is_active = true
    )
$$;

CREATE OR REPLACE FUNCTION public.can_manage_retail_data()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(public.current_staff_role() IN ('MANAGER', 'ADMIN'), false)
$$;

CREATE TABLE IF NOT EXISTS public.offline_sync_operations (
  operation_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  device_id text NOT NULL,
  outlet_id uuid,
  operation_type text NOT NULL,
  payload jsonb NOT NULL,
  sync_status text NOT NULL DEFAULT 'SYNCED' CHECK (sync_status IN ('SYNCED', 'REVIEW')),
  sync_message text,
  created_at timestamptz NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inventory_sync_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES public.offline_sync_operations(operation_id),
  product_id uuid NOT NULL REFERENCES public.products(id),
  location_id uuid NOT NULL REFERENCES public.locations(id),
  resulting_quantity numeric NOT NULL,
  message text NOT NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.purchase_receipts (
  id uuid PRIMARY KEY,
  supplier_name text NOT NULL,
  supplier_invoice_number text NOT NULL,
  invoice_date date NOT NULL,
  warehouse_location_id uuid NOT NULL REFERENCES public.locations(id),
  status text NOT NULL,
  attachment_path text,
  reviewed_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_name, supplier_invoice_number)
);
ALTER TABLE public.purchase_receipts ADD COLUMN IF NOT EXISTS ocr_text text;
ALTER TABLE public.purchase_receipts ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE public.purchase_receipts ADD COLUMN IF NOT EXISTS received_at timestamptz;

CREATE TABLE IF NOT EXISTS public.purchase_receipt_items (
  id uuid PRIMARY KEY,
  receipt_id uuid NOT NULL REFERENCES public.purchase_receipts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  quantity numeric(14,3) NOT NULL,
  unit_cost numeric(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.cashier_shortcuts (
  location_id uuid PRIMARY KEY REFERENCES public.locations(id) ON DELETE CASCADE,
  product_ids uuid[] NOT NULL DEFAULT '{}',
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS invoice_status text NOT NULL DEFAULT 'COMPLETED';
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS business_date date NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS draft_payload jsonb;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_location_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offline_sync_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_sync_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashier_shortcuts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "open access" ON public.locations;
DROP POLICY IF EXISTS "open access" ON public.products;
DROP POLICY IF EXISTS "open access" ON public.inventory;
DROP POLICY IF EXISTS "open access" ON public.customers;
DROP POLICY IF EXISTS "open access" ON public.invoices;
DROP POLICY IF EXISTS "open access" ON public.invoice_items;
DROP POLICY IF EXISTS "open access" ON public.payments;
DROP POLICY IF EXISTS "open access" ON public.stock_transfers;
DROP POLICY IF EXISTS "open access" ON public.stock_transfer_items;
DROP POLICY IF EXISTS "open access" ON public.cash_drawer_sessions;
DROP POLICY IF EXISTS "open access" ON public.stock_adjustments;
DROP POLICY IF EXISTS "open access" ON public.cash_transactions;
DROP POLICY IF EXISTS "open access stock_movements" ON public.stock_movements;

CREATE POLICY staff_profile_self_read ON public.staff_profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.current_staff_role() = 'ADMIN');
CREATE POLICY staff_profile_admin_write ON public.staff_profiles FOR ALL TO authenticated
  USING (public.current_staff_role() = 'ADMIN') WITH CHECK (public.current_staff_role() = 'ADMIN');
CREATE POLICY staff_access_self_read ON public.staff_location_access FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.current_staff_role() = 'ADMIN');
CREATE POLICY staff_access_admin_write ON public.staff_location_access FOR ALL TO authenticated
  USING (public.current_staff_role() = 'ADMIN') WITH CHECK (public.current_staff_role() = 'ADMIN');
CREATE POLICY offline_ops_scoped_read ON public.offline_sync_operations FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.current_staff_role() = 'ADMIN');
CREATE POLICY sync_alerts_scoped_read ON public.inventory_sync_alerts FOR SELECT TO authenticated
  USING (public.can_manage_retail_data() AND public.can_access_location(location_id));
CREATE POLICY purchase_receipts_scoped_read ON public.purchase_receipts FOR SELECT TO authenticated
  USING (public.can_manage_retail_data() AND public.can_access_location(warehouse_location_id));
CREATE POLICY purchase_items_scoped_read ON public.purchase_receipt_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchase_receipts receipt WHERE receipt.id = receipt_id AND public.can_access_location(receipt.warehouse_location_id)));
CREATE POLICY shortcuts_location_read ON public.cashier_shortcuts FOR SELECT TO authenticated USING (public.can_access_location(location_id));
CREATE POLICY purchase_receipts_manager_insert ON public.purchase_receipts FOR INSERT TO authenticated WITH CHECK (public.can_manage_retail_data() AND public.can_access_location(warehouse_location_id));
CREATE POLICY purchase_receipts_manager_update ON public.purchase_receipts FOR UPDATE TO authenticated USING (public.can_manage_retail_data() AND public.can_access_location(warehouse_location_id)) WITH CHECK (public.can_manage_retail_data() AND public.can_access_location(warehouse_location_id));

CREATE POLICY locations_scoped_read ON public.locations FOR SELECT TO authenticated USING (public.can_access_location(id));
CREATE POLICY products_staff_read ON public.products FOR SELECT TO authenticated USING (public.current_staff_role() IS NOT NULL);
CREATE POLICY products_manager_write ON public.products FOR ALL TO authenticated USING (public.can_manage_retail_data()) WITH CHECK (public.can_manage_retail_data());
CREATE POLICY customers_staff_read ON public.customers FOR SELECT TO authenticated USING (public.current_staff_role() IS NOT NULL);
CREATE POLICY customers_staff_insert ON public.customers FOR INSERT TO authenticated WITH CHECK (public.current_staff_role() IS NOT NULL);
CREATE POLICY customers_manager_update ON public.customers FOR UPDATE TO authenticated USING (public.can_manage_retail_data()) WITH CHECK (public.can_manage_retail_data());
CREATE POLICY inventory_location_read ON public.inventory FOR SELECT TO authenticated USING (public.can_access_location(location_id));
CREATE POLICY invoice_location_read ON public.invoices FOR SELECT TO authenticated USING (public.can_access_location(location_id));
CREATE POLICY invoice_item_location_read ON public.invoice_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.invoices invoice WHERE invoice.id = invoice_id AND public.can_access_location(invoice.location_id)));
CREATE POLICY payment_location_read ON public.payments FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.invoices invoice WHERE invoice.id = invoice_id AND public.can_access_location(invoice.location_id)));
CREATE POLICY transfer_location_read ON public.stock_transfers FOR SELECT TO authenticated USING (public.can_access_location(from_location_id) OR public.can_access_location(to_location_id));
CREATE POLICY transfer_items_location_read ON public.stock_transfer_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.stock_transfers transfer WHERE transfer.id = transfer_id AND (public.can_access_location(transfer.from_location_id) OR public.can_access_location(transfer.to_location_id))));
CREATE POLICY cash_session_location_read ON public.cash_drawer_sessions FOR SELECT TO authenticated USING (public.can_access_location(location_id));
CREATE POLICY cash_transaction_location_read ON public.cash_transactions FOR SELECT TO authenticated USING (public.can_access_location(location_id));
CREATE POLICY adjustment_location_read ON public.stock_adjustments FOR SELECT TO authenticated USING (public.can_access_location(location_id));
CREATE POLICY movement_location_read ON public.stock_movements FOR SELECT TO authenticated USING (public.can_access_location(location_id));

-- Supplier documents remain private. Sync uploads them only after the local purchase draft exists.
INSERT INTO storage.buckets (id, name, public)
VALUES ('supplier-invoices', 'supplier-invoices', false)
ON CONFLICT (id) DO UPDATE SET public = false;
CREATE POLICY supplier_invoice_scoped_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'supplier-invoices' AND public.can_manage_retail_data()
    AND public.can_access_location(((storage.foldername(name))[2])::uuid));
CREATE POLICY supplier_invoice_scoped_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'supplier-invoices' AND public.can_manage_retail_data()
    AND public.can_access_location(((storage.foldername(name))[2])::uuid));
CREATE POLICY supplier_invoice_scoped_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'supplier-invoices' AND public.can_manage_retail_data()
    AND public.can_access_location(((storage.foldername(name))[2])::uuid))
  WITH CHECK (bucket_id = 'supplier-invoices' AND public.can_manage_retail_data()
    AND public.can_access_location(((storage.foldername(name))[2])::uuid));
CREATE POLICY supplier_invoice_scoped_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'supplier-invoices' AND public.can_manage_retail_data()
    AND public.can_access_location(((storage.foldername(name))[2])::uuid));

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS name_hi text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS search_aliases text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS cashier_id uuid REFERENCES auth.users(id);
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS cashier_name text;

REVOKE ALL ON public.locations, public.products, public.inventory, public.customers, public.invoices,
  public.invoice_items, public.payments, public.stock_transfers, public.stock_transfer_items,
  public.cash_drawer_sessions, public.stock_adjustments,
  public.cash_transactions, public.stock_movements FROM anon;
GRANT SELECT ON public.locations, public.products, public.inventory, public.customers, public.invoices,
  public.invoice_items, public.payments, public.stock_transfers, public.stock_transfer_items,
  public.cash_drawer_sessions, public.stock_adjustments, public.cash_transactions, public.stock_movements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_profiles, public.staff_location_access TO authenticated;
GRANT SELECT ON public.offline_sync_operations, public.inventory_sync_alerts, public.purchase_receipts, public.purchase_receipt_items TO authenticated;
GRANT SELECT ON public.cashier_shortcuts TO authenticated;
REVOKE ALL ON FUNCTION public.current_staff_role(), public.can_access_location(uuid), public.can_manage_retail_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_staff_role(), public.can_access_location(uuid), public.can_manage_retail_data() TO authenticated;

-- Earlier migrations exposed privileged SECURITY DEFINER checkout and inventory
-- functions to anonymous clients. The device-first sync RPC above replaces them.
REVOKE ALL ON FUNCTION public.create_pos_invoice(uuid, uuid, numeric, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_pos_invoice(uuid, uuid, numeric, jsonb, jsonb, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_payment(uuid, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.receive_stock_transfer(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_stock_adjustment(uuid, uuid, numeric, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.open_cash_session(uuid, text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.open_cash_session(uuid, text, numeric, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.close_cash_session(uuid, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.close_cash_session(uuid, numeric, numeric, numeric, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_cash_txn(uuid, uuid, text, numeric, text) FROM PUBLIC, anon, authenticated;

-- Offline sales are never rejected after local completion. This endpoint stores the operation
-- idempotently and applies stock deltas in order, reporting stale-snapshot oversells as alerts.
CREATE OR REPLACE FUNCTION public.sync_offline_operation(
  p_operation_id uuid, p_device_id text, p_outlet_id uuid, p_operation_type text, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text := public.current_staff_role();
  v_rows integer := 0;
  v_record jsonb;
  v_stock jsonb;
  v_qty numeric;
  v_inventory_id uuid;
  v_credit numeric := 0;
  v_review boolean := false;
  v_message text;
BEGIN
  IF auth.uid() IS NULL OR v_role IS NULL THEN RAISE EXCEPTION 'An active staff account is required'; END IF;
  IF p_outlet_id IS NOT NULL AND NOT public.can_access_location(p_outlet_id) THEN RAISE EXCEPTION 'Location access denied'; END IF;
  IF p_operation_type LIKE 'inventory.transfer.%' AND (
    NOT public.can_access_location((p_payload->'transfer'->>'from_location_id')::uuid)
    OR NOT public.can_access_location((p_payload->'transfer'->>'to_location_id')::uuid)
  ) THEN RAISE EXCEPTION 'Location access denied for both transfer endpoints'; END IF;
  IF p_operation_type LIKE 'purchase.%' OR p_operation_type LIKE 'inventory.%' OR p_operation_type IN ('product.create', 'product.update', 'shortcut.update') THEN
    IF v_role NOT IN ('MANAGER', 'ADMIN') THEN RAISE EXCEPTION 'Manager access is required for this operation'; END IF;
  END IF;
  IF p_operation_type IN ('customer.update', 'customer.import') AND v_role NOT IN ('MANAGER', 'ADMIN') THEN
    RAISE EXCEPTION 'Manager access is required to update customer profiles';
  END IF;
  IF p_operation_type NOT IN ('invoice.draft.save', 'invoice.draft.void', 'invoice.finalize', 'customer.create', 'customer.update', 'product.create', 'product.quick_add', 'product.update', 'shortcut.update', 'inventory.transfer.create', 'inventory.transfer.status', 'inventory.transfer.receive', 'inventory.adjustment.create', 'cash.session.open', 'cash.session.close', 'cash.transaction.create', 'payment.add', 'purchase.draft.save', 'purchase.review', 'purchase.receive') THEN
    RAISE EXCEPTION 'Unsupported operation type';
  END IF;
  INSERT INTO public.offline_sync_operations (operation_id, user_id, device_id, outlet_id, operation_type, payload, created_at)
  VALUES (p_operation_id, auth.uid(), p_device_id, p_outlet_id, p_operation_type, COALESCE(p_payload, '{}'::jsonb), now())
  ON CONFLICT (operation_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN (SELECT jsonb_build_object('accepted', true, 'duplicate', true, 'review_needed', sync_status = 'REVIEW', 'message', sync_message)
      FROM public.offline_sync_operations WHERE operation_id = p_operation_id);
  END IF;

  BEGIN
    IF p_operation_type = 'invoice.draft.save' THEN
      v_record := p_payload->'invoice';
      INSERT INTO public.invoices (id, invoice_number, location_id, customer_id, total_amount, discount_amount, paid_amount, balance_amount, payment_status, business_date, cashier_id, cashier_name, invoice_status, draft_payload, created_at, updated_at)
      VALUES ((v_record->>'id')::uuid, v_record->>'invoice_number', (v_record->>'location_id')::uuid,
        NULLIF(v_record->>'customer_id', '')::uuid, COALESCE((v_record->>'total_amount')::numeric, 0), COALESCE((v_record->>'discount_amount')::numeric, 0),
        COALESCE((v_record->>'paid_amount')::numeric, 0), COALESCE((v_record->>'balance_amount')::numeric, 0), COALESCE(v_record->>'payment_status', 'UNPAID'),
        (v_record->>'business_date')::date, NULLIF(v_record->>'cashier_id', '')::uuid, v_record->>'cashier_name', 'DRAFT', p_payload,
        COALESCE((v_record->>'created_at')::timestamptz, now()), COALESCE((v_record->>'updated_at')::timestamptz, now()))
      ON CONFLICT (id) DO UPDATE SET customer_id = EXCLUDED.customer_id, discount_amount = EXCLUDED.discount_amount,
        business_date = EXCLUDED.business_date, invoice_status = 'DRAFT', draft_payload = EXCLUDED.draft_payload, updated_at = EXCLUDED.updated_at
      WHERE public.invoices.invoice_status = 'DRAFT';
    ELSIF p_operation_type = 'invoice.draft.void' THEN
      UPDATE public.invoices SET invoice_status = 'VOID', draft_payload = NULL, updated_at = now()
      WHERE id = ((p_payload->'invoice')->>'id')::uuid AND invoice_status = 'DRAFT';
    ELSIF p_operation_type = 'invoice.finalize' THEN
      v_record := p_payload->'invoice';
      INSERT INTO public.invoices (id, invoice_number, location_id, customer_id, total_amount, discount_amount, paid_amount, balance_amount, payment_status, business_date, cashier_id, cashier_name, invoice_status, draft_payload, created_at, updated_at)
      VALUES ((v_record->>'id')::uuid, v_record->>'invoice_number', (v_record->>'location_id')::uuid,
        NULLIF(v_record->>'customer_id', '')::uuid, (v_record->>'total_amount')::numeric, (v_record->>'discount_amount')::numeric,
        (v_record->>'paid_amount')::numeric, (v_record->>'balance_amount')::numeric, v_record->>'payment_status',
        (v_record->>'business_date')::date, NULLIF(v_record->>'cashier_id', '')::uuid, v_record->>'cashier_name', 'COMPLETED', NULL,
        (v_record->>'created_at')::timestamptz, COALESCE((v_record->>'updated_at')::timestamptz, now()))
      ON CONFLICT (id) DO UPDATE SET customer_id = EXCLUDED.customer_id, total_amount = EXCLUDED.total_amount,
        discount_amount = EXCLUDED.discount_amount, paid_amount = EXCLUDED.paid_amount, balance_amount = EXCLUDED.balance_amount,
        payment_status = EXCLUDED.payment_status, business_date = EXCLUDED.business_date, invoice_status = 'COMPLETED',
        draft_payload = NULL, updated_at = EXCLUDED.updated_at WHERE public.invoices.invoice_status = 'DRAFT';
      FOR v_record IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'items', '[]'::jsonb)) LOOP
        INSERT INTO public.invoice_items (id, invoice_id, product_id, quantity, unit_price, uom, discount, total)
        VALUES ((v_record->>'id')::uuid, (v_record->>'invoice_id')::uuid, (v_record->>'product_id')::uuid,
          (v_record->>'quantity')::numeric, (v_record->>'unit_price')::numeric, COALESCE(v_record->>'uom', 'UNIT'),
          COALESCE((v_record->>'discount')::numeric, 0), (v_record->>'total')::numeric) ON CONFLICT (id) DO NOTHING;
      END LOOP;
      FOR v_record IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'payments', '[]'::jsonb)) LOOP
        INSERT INTO public.payments (id, invoice_id, customer_id, amount, mode, tendered, change_given, created_at)
        VALUES ((v_record->>'id')::uuid, (v_record->>'invoice_id')::uuid, NULLIF(v_record->>'customer_id', '')::uuid,
          (v_record->>'amount')::numeric, v_record->>'mode', NULLIF(v_record->>'tendered', '')::numeric,
          NULLIF(v_record->>'change_given', '')::numeric, (v_record->>'created_at')::timestamptz) ON CONFLICT (id) DO NOTHING;
      END LOOP;
      v_credit := COALESCE((p_payload->'invoice'->>'balance_amount')::numeric, 0);
      IF NULLIF((p_payload->'invoice')->>'customer_id', '') IS NOT NULL THEN
        UPDATE public.customers SET outstanding_balance = outstanding_balance + v_credit, visits = visits + 1
        WHERE id = ((p_payload->'invoice')->>'customer_id')::uuid;
      END IF;
    ELSIF p_operation_type = 'customer.create' THEN
      v_record := p_payload->'customer';
      INSERT INTO public.customers (id, name, mobile, age_group, gender, credit_limit, outstanding_balance, visits)
      VALUES ((v_record->>'id')::uuid, v_record->>'name', NULLIF(v_record->>'mobile', ''), v_record->>'age_group',
        v_record->>'gender', COALESCE((v_record->>'credit_limit')::numeric, 0), COALESCE((v_record->>'outstanding_balance')::numeric, 0), 0) ON CONFLICT (id) DO NOTHING;
    ELSIF p_operation_type IN ('product.create', 'product.quick_add') THEN
      v_record := p_payload->'product';
      INSERT INTO public.products (id, name, name_hi, search_aliases, sku, barcode, category, variant, rack_location, purchase_cost, mrp, sale_price, min_sale_price, min_stock,
        uom_purchase, uom_stock, uom_sale, conversion_factor, enrichment_status)
      VALUES ((v_record->>'id')::uuid, v_record->>'name', v_record->>'name_hi', ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_record->'search_aliases', '[]'::jsonb))), v_record->>'sku', NULLIF(v_record->>'barcode', ''), v_record->>'category',
        v_record->>'variant', v_record->>'rack_location', COALESCE((v_record->>'purchase_cost')::numeric, 0),
        COALESCE((v_record->>'mrp')::numeric, 0), COALESCE((v_record->>'sale_price')::numeric, 0),
        COALESCE((v_record->>'min_sale_price')::numeric, 0), COALESCE((v_record->>'min_stock')::numeric, 0), COALESCE(v_record->>'uom_purchase', 'UNIT'),
        COALESCE(v_record->>'uom_stock', 'UNIT'), COALESCE(v_record->>'uom_sale', 'UNIT'), 1, 'PENDING') ON CONFLICT (id) DO NOTHING;
    ELSIF p_operation_type = 'product.update' THEN
      v_record := p_payload->'product';
      UPDATE public.products SET name = v_record->>'name', name_hi = v_record->>'name_hi', search_aliases = ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_record->'search_aliases', '[]'::jsonb))),
        sku = v_record->>'sku', barcode = NULLIF(v_record->>'barcode', ''), hsn = NULLIF(v_record->>'hsn', ''), category = v_record->>'category',
        variant = v_record->>'variant', rack_location = v_record->>'rack_location', purchase_cost = (v_record->>'purchase_cost')::numeric,
        mrp = (v_record->>'mrp')::numeric, sale_price = (v_record->>'sale_price')::numeric, min_sale_price = (v_record->>'min_sale_price')::numeric,
        min_stock = (v_record->>'min_stock')::numeric, enrichment_status = v_record->>'enrichment_status' WHERE id = (v_record->>'id')::uuid;
    ELSIF p_operation_type = 'customer.update' THEN
      v_record := p_payload->'customer';
      UPDATE public.customers SET name = v_record->>'name', mobile = NULLIF(v_record->>'mobile', ''), age_group = v_record->>'age_group',
        gender = v_record->>'gender', credit_limit = COALESCE((v_record->>'credit_limit')::numeric, 0)
      WHERE id = (v_record->>'id')::uuid;
    ELSIF p_operation_type = 'shortcut.update' THEN
      v_record := p_payload->'shortcut';
      INSERT INTO public.cashier_shortcuts (location_id, product_ids, updated_by, updated_at)
      VALUES ((v_record->>'location_id')::uuid,
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_record->'product_ids', '[]'::jsonb)))::uuid[], auth.uid(), now())
      ON CONFLICT (location_id) DO UPDATE SET product_ids = EXCLUDED.product_ids, updated_by = auth.uid(), updated_at = now();
    ELSIF p_operation_type LIKE 'inventory.transfer.%' THEN
      v_record := p_payload->'transfer';
      INSERT INTO public.stock_transfers (id, from_location_id, to_location_id, status, notes, created_at)
      VALUES ((v_record->>'id')::uuid, (v_record->>'from_location_id')::uuid, (v_record->>'to_location_id')::uuid,
        v_record->>'status', v_record->>'notes', COALESCE((v_record->>'created_at')::timestamptz, now()))
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes;
      IF jsonb_typeof(p_payload->'items') = 'array' THEN
        DELETE FROM public.stock_transfer_items WHERE transfer_id = (v_record->>'id')::uuid;
        FOR v_record IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
          INSERT INTO public.stock_transfer_items (id, transfer_id, product_id, quantity)
          VALUES (COALESCE(NULLIF(v_record->>'id', '')::uuid, gen_random_uuid()), (v_record->>'transfer_id')::uuid,
            (v_record->>'product_id')::uuid, (v_record->>'quantity')::numeric);
        END LOOP;
      END IF;
    ELSIF p_operation_type = 'inventory.adjustment.create' THEN
      v_record := p_payload->'adjustment';
      INSERT INTO public.stock_adjustments (id, product_id, location_id, quantity, reason, returnable_to_vendor, cost_loss, created_at)
      VALUES ((v_record->>'id')::uuid, (v_record->>'product_id')::uuid, (v_record->>'location_id')::uuid,
        (v_record->>'quantity')::numeric, v_record->>'reason', COALESCE((v_record->>'returnable_to_vendor')::boolean, false),
        COALESCE((v_record->>'cost_loss')::numeric, 0), (v_record->>'created_at')::timestamptz) ON CONFLICT (id) DO NOTHING;
    ELSIF p_operation_type = 'cash.session.open' THEN
      v_record := p_payload->'session';
      INSERT INTO public.cash_drawer_sessions (id, location_id, opened_by, opening_cash, status, opened_at, opening_denominations)
      VALUES ((v_record->>'id')::uuid, (v_record->>'location_id')::uuid, v_record->>'opened_by', (v_record->>'opening_cash')::numeric,
        'OPEN', (v_record->>'opened_at')::timestamptz, v_record->'opening_denominations') ON CONFLICT (id) DO NOTHING;
    ELSIF p_operation_type = 'cash.session.close' THEN
      v_record := p_payload->'session';
      UPDATE public.cash_drawer_sessions SET status = 'CLOSED', cash_sales = (v_record->>'cash_sales')::numeric,
        cash_in = (v_record->>'cash_in')::numeric, cash_out = (v_record->>'cash_out')::numeric,
        closing_cash = (v_record->>'closing_cash')::numeric, closed_at = (v_record->>'closed_at')::timestamptz,
        closing_denominations = v_record->'closing_denominations' WHERE id = (v_record->>'id')::uuid;
    ELSIF p_operation_type = 'cash.transaction.create' THEN
      v_record := p_payload->'transaction';
      INSERT INTO public.cash_transactions (id, session_id, location_id, direction, amount, reason, created_at)
      VALUES ((v_record->>'id')::uuid, NULLIF(v_record->>'session_id', '')::uuid, (v_record->>'location_id')::uuid,
        v_record->>'direction', (v_record->>'amount')::numeric, v_record->>'reason', (v_record->>'created_at')::timestamptz) ON CONFLICT (id) DO NOTHING;
      v_record := p_payload->'session';
      IF jsonb_typeof(v_record) = 'object' THEN
        UPDATE public.cash_drawer_sessions SET cash_in = (v_record->>'cash_in')::numeric, cash_out = (v_record->>'cash_out')::numeric
        WHERE id = (v_record->>'id')::uuid;
      END IF;
    ELSIF p_operation_type = 'payment.add' THEN
      v_record := p_payload->'payment';
      INSERT INTO public.payments (id, invoice_id, customer_id, amount, mode, tendered, change_given, created_at)
      VALUES ((v_record->>'id')::uuid, (v_record->>'invoice_id')::uuid, NULLIF(v_record->>'customer_id', '')::uuid,
        (v_record->>'amount')::numeric, v_record->>'mode', (v_record->>'tendered')::numeric, (v_record->>'change_given')::numeric,
        (v_record->>'created_at')::timestamptz) ON CONFLICT (id) DO NOTHING;
      v_record := p_payload->'invoice';
      UPDATE public.invoices SET paid_amount = (v_record->>'paid_amount')::numeric,
        balance_amount = (v_record->>'balance_amount')::numeric, payment_status = v_record->>'payment_status'
      WHERE id = (v_record->>'id')::uuid;
      IF NULLIF(v_record->>'customer_id', '') IS NOT NULL THEN
        UPDATE public.customers SET outstanding_balance = GREATEST(outstanding_balance - (p_payload->'payment'->>'amount')::numeric, 0)
        WHERE id = (v_record->>'customer_id')::uuid;
      END IF;
    ELSIF p_operation_type LIKE 'purchase.%' THEN
      v_record := p_payload->'receipt';
      INSERT INTO public.purchase_receipts (id, supplier_name, supplier_invoice_number, invoice_date, warehouse_location_id, status, attachment_path, ocr_text, reviewed_by, reviewed_at, received_at, created_at)
      VALUES ((v_record->>'id')::uuid, v_record->>'supplier_name', v_record->>'supplier_invoice_number', (v_record->>'invoice_date')::date,
        (v_record->>'warehouse_location_id')::uuid, v_record->>'status', v_record->>'attachment_path', v_record->>'ocr_text',
        CASE WHEN v_record->>'status' IN ('REVIEWED', 'RECEIVED') THEN auth.uid() ELSE NULL END,
        NULLIF(v_record->>'reviewed_at', '')::timestamptz,
        NULLIF(v_record->>'received_at', '')::timestamptz,
        COALESCE((v_record->>'created_at')::timestamptz, now()))
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, attachment_path = COALESCE(EXCLUDED.attachment_path, public.purchase_receipts.attachment_path),
        ocr_text = EXCLUDED.ocr_text,
        reviewed_at = COALESCE(EXCLUDED.reviewed_at, public.purchase_receipts.reviewed_at),
        received_at = COALESCE(EXCLUDED.received_at, public.purchase_receipts.received_at),
        reviewed_by = COALESCE(EXCLUDED.reviewed_by, public.purchase_receipts.reviewed_by);
      DELETE FROM public.purchase_receipt_items WHERE receipt_id = (v_record->>'id')::uuid;
      FOR v_record IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'receipt'->'items', '[]'::jsonb)) LOOP
        IF NULLIF(v_record->>'product_id', '') IS NOT NULL THEN
          INSERT INTO public.purchase_receipt_items (id, receipt_id, product_id, quantity, unit_cost)
          VALUES (COALESCE(NULLIF(v_record->>'id', '')::uuid, gen_random_uuid()),
            (p_payload->'receipt'->>'id')::uuid, (v_record->>'product_id')::uuid,
            (v_record->>'quantity')::numeric, COALESCE((v_record->>'unit_cost')::numeric, 0));
        END IF;
      END LOOP;
    END IF;

    FOR v_stock IN
      SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'stock_movements', '[]'::jsonb))
      UNION ALL SELECT p_payload->'stock_movement' WHERE jsonb_typeof(p_payload->'stock_movement') = 'object'
    LOOP
      PERFORM set_config('app.movement_type', COALESCE(v_stock->>'movement_type', 'STOCK CHANGE'), true);
      INSERT INTO public.inventory (product_id, location_id, quantity_on_hand)
      VALUES ((v_stock->>'product_id')::uuid, (v_stock->>'location_id')::uuid, (v_stock->>'quantity_delta')::numeric)
      ON CONFLICT (product_id, location_id) DO UPDATE
        SET quantity_on_hand = public.inventory.quantity_on_hand + (v_stock->>'quantity_delta')::numeric
      RETURNING id, quantity_on_hand INTO v_inventory_id, v_qty;
      IF v_qty < 0 THEN
        INSERT INTO public.inventory_sync_alerts (operation_id, product_id, location_id, resulting_quantity, message)
        VALUES (p_operation_id, (v_stock->>'product_id')::uuid, (v_stock->>'location_id')::uuid, v_qty,
          'Offline sales exceeded the stock snapshot available on this device. Review transfers/stock count.');
      END IF;
    END LOOP;
  EXCEPTION WHEN unique_violation OR foreign_key_violation OR invalid_text_representation
    OR check_violation OR not_null_violation OR numeric_value_out_of_range THEN
    v_review := true;
    v_message := 'Operation saved locally but needs manager review before server records could be reconciled.';
  END;

  UPDATE public.offline_sync_operations SET sync_status = CASE WHEN v_review THEN 'REVIEW' ELSE 'SYNCED' END, sync_message = v_message
  WHERE operation_id = p_operation_id;
  RETURN jsonb_build_object('accepted', true, 'duplicate', false, 'review_needed', v_review, 'message', v_message);
END $$;

REVOKE ALL ON FUNCTION public.sync_offline_operation(uuid, text, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_offline_operation(uuid, text, uuid, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_staff_access(
  p_user_id uuid, p_display_name text, p_role text, p_location_ids uuid[], p_is_active boolean DEFAULT true
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.current_staff_role() <> 'ADMIN' THEN RAISE EXCEPTION 'Admin access is required'; END IF;
  IF p_role IS NULL OR p_role NOT IN ('CASHIER', 'MANAGER', 'ADMIN') THEN RAISE EXCEPTION 'Invalid staff role'; END IF;
  IF p_user_id = auth.uid() AND p_role <> 'ADMIN' THEN RAISE EXCEPTION 'An Admin cannot remove their own Admin access'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(COALESCE(p_location_ids, '{}'::uuid[])) AS requested(id) LEFT JOIN public.locations l ON l.id = requested.id WHERE l.id IS NULL) THEN
    RAISE EXCEPTION 'One or more assigned locations do not exist';
  END IF;
  INSERT INTO public.staff_profiles (user_id, display_name, role, is_active)
  VALUES (p_user_id, p_display_name, p_role, COALESCE(p_is_active, true))
  ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, role = EXCLUDED.role,
    is_active = EXCLUDED.is_active, updated_at = now();
  DELETE FROM public.staff_location_access WHERE user_id = p_user_id;
  INSERT INTO public.staff_location_access (user_id, location_id)
  SELECT p_user_id, assigned.location_id FROM unnest(COALESCE(p_location_ids, '{}'::uuid[])) AS assigned(location_id);
END $$;
REVOKE ALL ON FUNCTION public.admin_set_staff_access(uuid, text, text, uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_staff_access(uuid, text, text, uuid[], boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_inventory_sync_alert(p_alert_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_location_id uuid;
BEGIN
  IF NOT public.can_manage_retail_data() THEN RAISE EXCEPTION 'Manager access is required'; END IF;
  SELECT location_id INTO v_location_id FROM public.inventory_sync_alerts WHERE id = p_alert_id;
  IF v_location_id IS NULL OR NOT public.can_access_location(v_location_id) THEN RAISE EXCEPTION 'Location access denied'; END IF;
  UPDATE public.inventory_sync_alerts SET resolved_at = now() WHERE id = p_alert_id AND resolved_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION public.resolve_inventory_sync_alert(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_inventory_sync_alert(uuid) TO authenticated;
