-- Forward-only RetailFlow stabilization. Published migrations remain unchanged.

ALTER TABLE public.cash_drawer_sessions
  ADD COLUMN opened_by_id uuid REFERENCES public.users(user_id),
  ADD COLUMN closed_by_id uuid REFERENCES public.users(user_id),
  ADD COLUMN override_by_id uuid REFERENCES public.users(user_id),
  ADD COLUMN override_reason text,
  ADD COLUMN override_difference numeric(12,2);

ALTER TABLE public.customers ADD COLUMN segment text;
ALTER TABLE public.invoices
  ADD COLUMN customer_segment text,
  ADD COLUMN order_type text;
ALTER TABLE public.invoice_items ADD COLUMN unit_cost_snapshot numeric(12,2);
ALTER TABLE public.purchase_receipts ADD COLUMN source_total numeric(12,2);
ALTER TABLE public.purchase_receipt_items ADD COLUMN source_total numeric(12,2);
ALTER TABLE public.stock_adjustments
  ADD COLUMN created_by uuid REFERENCES public.users(user_id),
  ADD COLUMN import_batch_id uuid;

CREATE INDEX cash_drawer_sessions_opened_by_status_idx
  ON public.cash_drawer_sessions (opened_by_id, status)
  WHERE status = 'OPEN';

WITH uniquely_matched_cashiers AS (
  SELECT c.id, min(u.user_id::text)::uuid AS user_id
  FROM public.cash_drawer_sessions c
  JOIN public.users u
    ON lower(btrim(c.opened_by)) IN (
      lower(btrim(u.display_name)), lower(btrim(COALESCE(u.email, ''))), lower(btrim(COALESCE(u.phone, '')))
    )
  WHERE c.status = 'OPEN' AND c.opened_by_id IS NULL AND u.is_active AND u.role = 'CASHIER'
  GROUP BY c.id
  HAVING count(*) = 1
)
UPDATE public.cash_drawer_sessions c
SET opened_by_id = matched.user_id
FROM uniquely_matched_cashiers matched
WHERE c.id = matched.id;

CREATE TABLE public.retail_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_key text NOT NULL UNIQUE,
  source_file_name text NOT NULL,
  imported_by uuid NOT NULL REFERENCES public.users(user_id),
  location_mapping jsonb NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  committed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.retail_import_source_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.retail_import_batches(id) ON DELETE CASCADE,
  sheet_name text NOT NULL,
  source_key text NOT NULL,
  source_row_number integer NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  source_payload jsonb NOT NULL,
  UNIQUE (sheet_name, source_key)
);

ALTER TABLE public.retail_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retail_import_source_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.retail_import_batches, public.retail_import_source_rows FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.retail_import_batches, public.retail_import_source_rows TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_cash_session_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_expected numeric(12,2);
  v_cash_sales numeric(12,2);
  v_cash_in numeric(12,2);
  v_cash_out numeric(12,2);
  v_denom_total numeric(12,2);
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtext(NEW.location_id::text)::bigint);
    NEW.opened_by_id := COALESCE(NEW.opened_by_id, v_actor);
    IF NEW.opened_by_id IS NULL OR (v_actor IS NOT NULL AND NEW.opened_by_id <> v_actor) THEN
      RAISE EXCEPTION 'The signed-in staff member must open the cash shift';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.locations WHERE id = NEW.location_id AND is_active) THEN
      RAISE EXCEPTION 'Cash shifts can only open at an active location';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.cash_drawer_sessions
      WHERE location_id = NEW.location_id AND status = 'OPEN'
    ) THEN
      RAISE EXCEPTION 'This location already has an open cash shift';
    END IF;
    SELECT role INTO v_role FROM public.users WHERE user_id = NEW.opened_by_id AND is_active;
    IF v_role IS NULL OR (v_role <> 'ADMIN' AND NOT EXISTS (
      SELECT 1 FROM public.staff_location_access
      WHERE user_id = NEW.opened_by_id AND location_id = NEW.location_id
    )) THEN
      RAISE EXCEPTION 'The staff member is not assigned to this cash drawer';
    END IF;
    IF NEW.opening_denominations IS NULL OR jsonb_typeof(NEW.opening_denominations) <> 'object' THEN
      RAISE EXCEPTION 'Opening denominations must be provided as an object';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_each_text(COALESCE(NEW.opening_denominations, '{}'::jsonb)) denomination
      WHERE denomination.key NOT IN ('2000', '500', '200', '100', '50', '20', '10', '5', '2', '1')
        OR denomination.value !~ '^[0-9]+$'
    ) THEN
      RAISE EXCEPTION 'Opening denominations contain an invalid value';
    END IF;
    SELECT COALESCE(sum(key::numeric * value::numeric), 0) INTO v_denom_total
    FROM jsonb_each_text(COALESCE(NEW.opening_denominations, '{}'::jsonb));
    IF abs(v_denom_total - NEW.opening_cash) > 0.01 THEN
      RAISE EXCEPTION 'Opening denominations do not match the opening cash total';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'OPEN' AND NEW.status = 'CLOSED' THEN
    IF NEW.override_by_id IS NOT NULL THEN
      SELECT role INTO v_role FROM public.users WHERE user_id = NEW.override_by_id AND is_active;
      IF v_actor IS DISTINCT FROM NEW.override_by_id OR v_role IS NULL OR v_role NOT IN ('MANAGER', 'ADMIN') OR
        (v_role = 'MANAGER' AND NOT EXISTS (
          SELECT 1 FROM public.staff_location_access
          WHERE user_id = NEW.override_by_id AND location_id = OLD.location_id
        )) OR
        NEW.closed_by_id IS DISTINCT FROM NEW.override_by_id OR
        length(btrim(COALESCE(NEW.override_reason, ''))) < 5 THEN
        RAISE EXCEPTION 'A location-authorized Manager or Admin and a reason are required';
      END IF;
    ELSE
      NEW.closed_by_id := COALESCE(NEW.closed_by_id, v_actor);
      IF v_actor IS NULL OR NEW.closed_by_id <> v_actor OR OLD.opened_by_id IS DISTINCT FROM v_actor THEN
        RAISE EXCEPTION 'Only the cashier who opened this shift can close it';
      END IF;
    END IF;

    SELECT COALESCE(sum(p.amount), 0) INTO v_cash_sales
    FROM public.payments p
    JOIN public.invoices i ON i.id = p.invoice_id
    WHERE i.location_id = OLD.location_id
      AND p.created_at >= OLD.opened_at
      AND p.created_at <= COALESCE(NEW.closed_at, now())
      AND p.mode = 'CASH';
    SELECT COALESCE(sum(amount) FILTER (WHERE direction = 'IN'), 0),
           COALESCE(sum(amount) FILTER (WHERE direction = 'OUT'), 0)
      INTO v_cash_in, v_cash_out
    FROM public.cash_transactions
    WHERE session_id = OLD.id;
    v_expected := OLD.opening_cash + v_cash_sales + v_cash_in - v_cash_out;
    NEW.cash_sales := v_cash_sales;
    NEW.cash_in := v_cash_in;
    NEW.cash_out := v_cash_out;
    IF NEW.override_by_id IS NULL AND abs(COALESCE(NEW.closing_cash, -1) - v_expected) > 0.01 THEN
      RAISE EXCEPTION 'Cash count does not match expected drawer total';
    END IF;
    IF NEW.override_by_id IS NOT NULL THEN
      NEW.override_difference := COALESCE(NEW.closing_cash, 0) - v_expected;
    END IF;
    IF NEW.closing_denominations IS NULL OR jsonb_typeof(NEW.closing_denominations) <> 'object' THEN
      RAISE EXCEPTION 'Closing denominations must be provided as an object';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_each_text(COALESCE(NEW.closing_denominations, '{}'::jsonb)) denomination
      WHERE denomination.key NOT IN ('2000', '500', '200', '100', '50', '20', '10', '5', '2', '1')
        OR denomination.value !~ '^[0-9]+$'
    ) THEN
      RAISE EXCEPTION 'Closing denominations contain an invalid value';
    END IF;
    SELECT COALESCE(sum(key::numeric * value::numeric), 0) INTO v_denom_total
    FROM jsonb_each_text(COALESCE(NEW.closing_denominations, '{}'::jsonb));
    IF abs(v_denom_total - COALESCE(NEW.closing_cash, 0)) > 0.01 THEN
      RAISE EXCEPTION 'Closing denominations do not match the counted cash total';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER cash_session_reconciliation_guard
BEFORE INSERT OR UPDATE OF status ON public.cash_drawer_sessions
FOR EACH ROW EXECUTE FUNCTION public.enforce_cash_session_reconciliation();

CREATE OR REPLACE FUNCTION public.app_sync_offline_operation_as_staff(
  p_actor_user_id uuid,
  p_operation_id uuid,
  p_device_id text,
  p_outlet_id uuid,
  p_operation_type text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_result jsonb;
  v_record jsonb;
  v_role text;
  v_event_at timestamptz;
  v_location_id uuid;
BEGIN
  SELECT role INTO v_role FROM public.users
  WHERE user_id = p_actor_user_id AND is_active;
  IF v_role IS NULL OR v_role NOT IN ('CASHIER', 'MANAGER', 'ADMIN') THEN
    RAISE EXCEPTION 'An active staff account is required';
  END IF;
  IF p_operation_type = 'invoice.finalize' AND v_role = 'CASHIER' THEN
    v_record := p_payload->'invoice';
    v_location_id := (v_record->>'location_id')::uuid;
    v_event_at := COALESCE(NULLIF(v_record->>'created_at', '')::timestamptz, now());
    IF NOT EXISTS (
      SELECT 1 FROM public.cash_drawer_sessions
      WHERE location_id = v_location_id AND opened_by_id = p_actor_user_id
        AND opened_at <= v_event_at AND (closed_at IS NULL OR closed_at >= v_event_at)
    ) THEN
      RAISE EXCEPTION 'Open a cash shift before completing cashier sales';
    END IF;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', p_actor_user_id::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', p_actor_user_id::text, 'role', 'authenticated')::text, true);
  v_result := public.sync_offline_operation(p_operation_id, p_device_id, p_outlet_id, p_operation_type, p_payload);

  IF COALESCE((v_result->>'accepted')::boolean, false)
    AND NOT COALESCE((v_result->>'review_needed')::boolean, false) THEN
    IF p_operation_type IN ('product.create', 'product.quick_add') THEN
      v_record := p_payload->'product';
      UPDATE public.products SET price_tiers = COALESCE(v_record->'price_tiers', '[]'::jsonb)
      WHERE id = (v_record->>'id')::uuid;
    ELSIF p_operation_type = 'product.update' THEN
      v_record := p_payload->'product';
      IF v_record ? 'price_tiers' THEN
        UPDATE public.products SET price_tiers = v_record->'price_tiers'
        WHERE id = (v_record->>'id')::uuid;
      END IF;
    ELSIF p_operation_type = 'invoice.finalize' THEN
      v_record := p_payload->'invoice';
      UPDATE public.invoices SET
        customer_segment = COALESCE(NULLIF(v_record->>'customer_segment', ''), customer_segment),
        order_type = COALESCE(NULLIF(v_record->>'order_type', ''), order_type)
      WHERE id = (v_record->>'id')::uuid;
      UPDATE public.invoice_items target SET unit_cost_snapshot = NULLIF(source->>'unit_cost_snapshot', '')::numeric
      FROM jsonb_array_elements(COALESCE(p_payload->'items', '[]'::jsonb)) source
      WHERE target.id = (source->>'id')::uuid AND source ? 'unit_cost_snapshot';
    ELSIF p_operation_type LIKE 'purchase.%' THEN
      v_record := p_payload->'receipt';
      IF v_record IS NOT NULL THEN
        UPDATE public.purchase_receipts SET source_total = NULLIF(v_record->>'source_total', '')::numeric
        WHERE id = (v_record->>'id')::uuid AND v_record ? 'source_total';
        UPDATE public.purchase_receipt_items target SET source_total = NULLIF(source->>'source_total', '')::numeric
        FROM jsonb_array_elements(COALESCE(v_record->'items', '[]'::jsonb)) source
        WHERE target.id = (source->>'id')::uuid AND source ? 'source_total';
      END IF;
    ELSIF p_operation_type = 'inventory.adjustment.create' THEN
      UPDATE public.stock_adjustments SET created_by = p_actor_user_id
      WHERE id = (p_payload->'adjustment'->>'id')::uuid;
    END IF;
  END IF;
  RETURN v_result;
END
$$;

REVOKE ALL ON FUNCTION public.app_sync_offline_operation_as_staff(uuid, uuid, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_sync_offline_operation_as_staff(uuid, uuid, text, uuid, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.log_inventory_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_delta numeric;
  v_type text;
BEGIN
  IF current_setting('app.importing_movement', true) = 'true' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    v_delta := NEW.quantity_on_hand;
  ELSE
    v_delta := NEW.quantity_on_hand - OLD.quantity_on_hand;
    IF NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.location_id IS DISTINCT FROM OLD.location_id THEN
      RETURN NEW;
    END IF;
  END IF;
  IF v_delta IS NULL OR v_delta = 0 THEN RETURN NEW; END IF;
  v_type := NULLIF(current_setting('app.movement_type', true), '');
  IF v_type IS NULL THEN v_type := CASE WHEN v_delta > 0 THEN 'OPENING' ELSE 'CORRECTION' END; END IF;
  INSERT INTO public.stock_movements (product_id, location_id, movement_type, quantity_delta, quantity_on_hand)
  VALUES (NEW.product_id, NEW.location_id, v_type, v_delta, NEW.quantity_on_hand);
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.app_import_retailflow_workbook_batch(
  p_actor_user_id uuid,
  p_batch_key text,
  p_source_file_name text,
  p_location_mapping jsonb,
  p_summary jsonb,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_role text;
  v_location_id uuid;
  v_batch_id uuid;
  v_record jsonb;
  v_line jsonb;
  v_row jsonb;
  v_product_id uuid;
  v_invoice_id uuid;
  v_receipt_id uuid;
  v_adjustment_id uuid;
  v_quantity numeric;
  v_on_hand numeric;
BEGIN
  IF p_batch_key IS NULL OR p_batch_key !~ '^[0-9a-fA-F]{64}$' THEN RAISE EXCEPTION 'Invalid workbook fingerprint'; END IF;
  IF jsonb_typeof(p_location_mapping) <> 'object' OR jsonb_typeof(p_payload) <> 'object' THEN RAISE EXCEPTION 'Invalid workbook import payload'; END IF;
  v_location_id := (p_location_mapping->>'business_location_id')::uuid;
  SELECT role INTO v_role FROM public.users WHERE user_id = p_actor_user_id AND is_active;
  IF v_role IS NULL OR v_role NOT IN ('MANAGER', 'ADMIN') THEN RAISE EXCEPTION 'Manager or Admin access is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.locations WHERE id = v_location_id AND is_active) THEN RAISE EXCEPTION 'Choose an active destination location'; END IF;
  IF v_role = 'MANAGER' AND NOT EXISTS (
    SELECT 1 FROM public.staff_location_access WHERE user_id = p_actor_user_id AND location_id = v_location_id
  ) THEN RAISE EXCEPTION 'Manager is not assigned to the destination location'; END IF;

  SELECT id INTO v_batch_id FROM public.retail_import_batches WHERE batch_key = p_batch_key;
  IF v_batch_id IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'duplicate', true, 'batch_id', v_batch_id); END IF;
  IF EXISTS (
    SELECT 1
    FROM public.inventory existing
    JOIN jsonb_array_elements(COALESCE(p_payload->'products', '[]'::jsonb)) source
      ON existing.product_id = (source->>'id')::uuid
    WHERE existing.location_id = v_location_id AND abs(existing.quantity_on_hand) > 0.001
  ) THEN
    RAISE EXCEPTION 'The destination already has stock for one or more workbook SKUs. Reconcile the stock source before importing this historical batch.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.invoices existing
    JOIN jsonb_array_elements(COALESCE(p_payload->'sales', '[]'::jsonb)) source
      ON existing.invoice_number = source->>'invoice_number'
    WHERE existing.location_id = v_location_id
  ) THEN
    RAISE EXCEPTION 'The destination already has one or more workbook bill numbers. Review existing sales before importing.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.purchase_receipts existing
    JOIN jsonb_array_elements(COALESCE(p_payload->'purchases', '[]'::jsonb)) source
      ON lower(btrim(existing.supplier_invoice_number)) = lower(btrim(source->>'supplier_invoice_number'))
      AND lower(btrim(existing.supplier_name)) = lower(btrim(source->>'supplier_name'))
    WHERE existing.warehouse_location_id = v_location_id
  ) THEN
    RAISE EXCEPTION 'The destination already has one or more workbook supplier invoices. Review existing purchases before importing.';
  END IF;
  IF jsonb_typeof(COALESCE(p_payload->'products', '[]'::jsonb)) <> 'array'
    OR jsonb_typeof(COALESCE(p_payload->'customers', '[]'::jsonb)) <> 'array'
    OR jsonb_typeof(COALESCE(p_payload->'purchases', '[]'::jsonb)) <> 'array'
    OR jsonb_typeof(COALESCE(p_payload->'sales', '[]'::jsonb)) <> 'array'
    OR jsonb_typeof(COALESCE(p_payload->'movements', '[]'::jsonb)) <> 'array'
    OR jsonb_typeof(COALESCE(p_payload->'adjustments', '[]'::jsonb)) <> 'array'
    OR jsonb_typeof(COALESCE(p_payload->'source_rows', '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Workbook batch collections must be JSON arrays';
  END IF;
  IF jsonb_typeof(p_summary) <> 'object' THEN
    RAISE EXCEPTION 'Workbook summary and review acknowledgements are required';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_payload->'products', '[]'::jsonb)) product_row
    WHERE NULLIF(btrim(product_row->>'name'), '') IS NULL
      OR NULLIF(btrim(product_row->>'sku'), '') IS NULL
      OR COALESCE((product_row->>'sale_price')::numeric, 0) <= 0
  ) THEN
    RAISE EXCEPTION 'Every imported catalog item needs a SKU, name, and retail price';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_payload->'purchases', '[]'::jsonb)) receipt
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(receipt->'items', '[]'::jsonb)) item
    WHERE COALESCE((item->>'quantity')::numeric, 0) <= 0
      OR COALESCE((item->>'unit_cost')::numeric, -1) < 0
  ) THEN
    RAISE EXCEPTION 'Purchase lines need a positive quantity and a valid unit cost';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_payload->'sales', '[]'::jsonb)) sale
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(sale->'items', '[]'::jsonb)) item
    WHERE COALESCE((item->>'quantity')::numeric, 0) <= 0
      OR COALESCE((item->>'unit_price')::numeric, 0) <= 0
  ) THEN
    RAISE EXCEPTION 'Sale lines need a positive quantity and sell price';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_payload->'sales', '[]'::jsonb)) sale
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(sale->'payments', '[]'::jsonb)) payment
    WHERE payment->>'mode' IS NULL OR payment->>'mode' NOT IN ('CASH', 'UPI', 'CREDIT')
  ) THEN
    RAISE EXCEPTION 'Imported payments must be mapped to CASH, UPI, or CREDIT';
  END IF;
  IF EXISTS (
    SELECT sale->>'id'
    FROM jsonb_array_elements(COALESCE(p_payload->'sales', '[]'::jsonb)) sale
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(sale->'payments', '[]'::jsonb)) payment
    GROUP BY sale->>'id'
    HAVING count(DISTINCT payment->>'mode') > 1
  ) AND NOT COALESCE((p_summary->>'mixed_payment_reviewed')::boolean, false) THEN
    RAISE EXCEPTION 'Review and acknowledge bills with mixed payment modes';
  END IF;
  IF jsonb_array_length(COALESCE(p_payload->'adjustments', '[]'::jsonb)) > 0
    AND NOT COALESCE((p_summary->>'stock_adjustments_approved')::boolean, false) THEN
    RAISE EXCEPTION 'Approve the audited stock adjustment before importing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_payload->'source_rows', '[]'::jsonb)) src
    JOIN public.retail_import_source_rows existing
      ON existing.sheet_name = src->>'sheet_name' AND existing.source_key = src->>'source_key'
  ) THEN RAISE EXCEPTION 'One or more workbook source rows were already imported'; END IF;

  INSERT INTO public.retail_import_batches (batch_key, source_file_name, imported_by, location_mapping, summary)
  VALUES (p_batch_key, left(p_source_file_name, 255), p_actor_user_id, p_location_mapping, p_summary)
  RETURNING id INTO v_batch_id;

  FOR v_record IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'products', '[]'::jsonb)) LOOP
    INSERT INTO public.products (
      id, name, name_hi, search_aliases, sku, barcode, hsn, category, variant, rack_location,
      preferred_supplier, purchase_cost, mrp, sale_price, min_sale_price, price_tiers,
      uom_purchase, uom_stock, uom_sale, conversion_factor, min_stock, is_loose, enrichment_status
    ) VALUES (
      (v_record->>'id')::uuid, v_record->>'name', NULLIF(v_record->>'name_hi', ''),
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_record->'search_aliases', '[]'::jsonb))),
      NULLIF(v_record->>'sku', ''), NULLIF(v_record->>'barcode', ''), NULLIF(v_record->>'hsn', ''),
      NULLIF(v_record->>'category', ''), NULLIF(v_record->>'variant', ''), NULLIF(v_record->>'rack_location', ''),
      NULLIF(v_record->>'preferred_supplier', ''), COALESCE((v_record->>'purchase_cost')::numeric, 0),
      COALESCE((v_record->>'mrp')::numeric, 0), (v_record->>'sale_price')::numeric,
      COALESCE((v_record->>'min_sale_price')::numeric, 0), COALESCE(v_record->'price_tiers', '[]'::jsonb),
      COALESCE(NULLIF(v_record->>'uom_purchase', ''), 'Pcs'), COALESCE(NULLIF(v_record->>'uom_stock', ''), 'Pcs'),
      COALESCE(NULLIF(v_record->>'uom_sale', ''), 'Pcs'), COALESCE((v_record->>'conversion_factor')::numeric, 1),
      COALESCE((v_record->>'min_stock')::numeric, 0), COALESCE((v_record->>'is_loose')::boolean, false),
      'PENDING'
    ) ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, name_hi = EXCLUDED.name_hi, search_aliases = EXCLUDED.search_aliases,
      sku = EXCLUDED.sku, barcode = EXCLUDED.barcode, category = EXCLUDED.category,
      variant = EXCLUDED.variant, rack_location = EXCLUDED.rack_location,
      preferred_supplier = EXCLUDED.preferred_supplier, purchase_cost = EXCLUDED.purchase_cost,
      mrp = EXCLUDED.mrp, sale_price = EXCLUDED.sale_price, min_sale_price = EXCLUDED.min_sale_price,
      price_tiers = EXCLUDED.price_tiers, uom_purchase = EXCLUDED.uom_purchase,
      uom_stock = EXCLUDED.uom_stock, uom_sale = EXCLUDED.uom_sale,
      conversion_factor = EXCLUDED.conversion_factor, min_stock = EXCLUDED.min_stock,
      enrichment_status = 'PENDING';
  END LOOP;

  FOR v_record IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'customers', '[]'::jsonb)) LOOP
    INSERT INTO public.customers (id, name, mobile, age_group, gender, credit_limit, outstanding_balance, visits, segment)
    VALUES (
      (v_record->>'id')::uuid, v_record->>'name', NULLIF(v_record->>'mobile', ''),
      NULLIF(v_record->>'age_group', ''), NULLIF(v_record->>'gender', ''),
      COALESCE((v_record->>'credit_limit')::numeric, 0), COALESCE((v_record->>'outstanding_balance')::numeric, 0),
      COALESCE((v_record->>'visits')::integer, 0), NULLIF(v_record->>'segment', '')
    ) ON CONFLICT (id) DO NOTHING;
  END LOOP;

  FOR v_record IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'purchases', '[]'::jsonb)) LOOP
    v_receipt_id := (v_record->>'id')::uuid;
    INSERT INTO public.purchase_receipts (
      id, supplier_name, supplier_invoice_number, invoice_date, warehouse_location_id, status,
      attachment_path, ocr_text, received_at, created_at, source_total
    ) VALUES (
      v_receipt_id, v_record->>'supplier_name', v_record->>'supplier_invoice_number',
      (v_record->>'invoice_date')::date, v_location_id, 'RECEIVED',
      NULL, NULL, NULLIF(v_record->>'received_at', '')::timestamptz,
      NULLIF(v_record->>'created_at', '')::timestamptz, (v_record->>'source_total')::numeric
    );
    FOR v_line IN SELECT value FROM jsonb_array_elements(COALESCE(v_record->'items', '[]'::jsonb)) LOOP
      INSERT INTO public.purchase_receipt_items (id, receipt_id, product_id, quantity, unit_cost, source_total)
      VALUES ((v_line->>'id')::uuid, v_receipt_id, (v_line->>'product_id')::uuid,
        (v_line->>'quantity')::numeric, (v_line->>'unit_cost')::numeric, (v_line->>'source_total')::numeric);
    END LOOP;
  END LOOP;

  FOR v_record IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'sales', '[]'::jsonb)) LOOP
    v_invoice_id := (v_record->>'id')::uuid;
    INSERT INTO public.invoices (
      id, invoice_number, location_id, customer_id, total_amount, discount_amount, paid_amount,
      balance_amount, payment_status, invoice_status, business_date, cashier_id, cashier_name,
      created_at, updated_at, customer_segment, order_type
    ) VALUES (
      v_invoice_id, v_record->>'invoice_number', v_location_id, NULLIF(v_record->>'customer_id', '')::uuid,
      (v_record->>'total_amount')::numeric, COALESCE((v_record->>'discount_amount')::numeric, 0),
      COALESCE((v_record->>'paid_amount')::numeric, 0), COALESCE((v_record->>'balance_amount')::numeric, 0),
      v_record->>'payment_status', 'COMPLETED', (v_record->>'business_date')::date,
      NULL, COALESCE(v_record->>'cashier_name', 'Workbook import'),
      NULLIF(v_record->>'created_at', '')::timestamptz, NULLIF(v_record->>'updated_at', '')::timestamptz,
      NULLIF(v_record->>'customer_segment', ''), NULLIF(v_record->>'order_type', '')
    );
    FOR v_line IN SELECT value FROM jsonb_array_elements(COALESCE(v_record->'items', '[]'::jsonb)) LOOP
      INSERT INTO public.invoice_items (id, invoice_id, product_id, quantity, unit_price, uom, discount, total, unit_cost_snapshot)
      VALUES ((v_line->>'id')::uuid, v_invoice_id, (v_line->>'product_id')::uuid,
        (v_line->>'quantity')::numeric, (v_line->>'unit_price')::numeric, COALESCE(v_line->>'uom', 'Pcs'),
        COALESCE((v_line->>'discount')::numeric, 0), (v_line->>'total')::numeric,
        NULLIF(v_line->>'unit_cost_snapshot', '')::numeric);
    END LOOP;
    FOR v_line IN SELECT value FROM jsonb_array_elements(COALESCE(v_record->'payments', '[]'::jsonb)) LOOP
      INSERT INTO public.payments (id, invoice_id, customer_id, amount, mode, created_at)
      VALUES ((v_line->>'id')::uuid, v_invoice_id, NULLIF(v_record->>'customer_id', '')::uuid,
        (v_line->>'amount')::numeric, v_line->>'mode', NULLIF(v_line->>'created_at', '')::timestamptz);
    END LOOP;
  END LOOP;

  FOR v_record IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'adjustments', '[]'::jsonb)) LOOP
    INSERT INTO public.stock_adjustments (id, product_id, location_id, quantity, reason, returnable_to_vendor, cost_loss, created_by, import_batch_id)
    VALUES ((v_record->>'id')::uuid, (v_record->>'product_id')::uuid, v_location_id,
      (v_record->>'quantity')::numeric, 'IMPORT_VARIANCE_APPROVED', false, 0, p_actor_user_id, v_batch_id);
  END LOOP;

  PERFORM set_config('app.importing_movement', 'true', true);
  FOR v_record IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_payload->'movements', '[]'::jsonb))
    ORDER BY
      CASE
        WHEN value->>'movement_type' = 'OPENING' THEN 0
        WHEN value->>'movement_type' = 'ADJUSTMENT' THEN 2
        ELSE 1
      END,
      value->>'created_at',
      CASE value->>'movement_type'
        WHEN 'PURCHASE' THEN 0
        WHEN 'SALE' THEN 1
        ELSE 2
      END
  LOOP
    v_product_id := (v_record->>'product_id')::uuid;
    v_quantity := (v_record->>'quantity_delta')::numeric;
    INSERT INTO public.inventory (product_id, location_id, quantity_on_hand)
    VALUES (v_product_id, v_location_id, v_quantity)
    ON CONFLICT (product_id, location_id) DO UPDATE
      SET quantity_on_hand = public.inventory.quantity_on_hand + EXCLUDED.quantity_on_hand
    RETURNING quantity_on_hand INTO v_on_hand;
    INSERT INTO public.stock_movements (id, product_id, location_id, movement_type, quantity_delta, quantity_on_hand, reference, created_at)
    VALUES ((v_record->>'id')::uuid, v_product_id, v_location_id, v_record->>'movement_type', v_quantity,
      v_on_hand, NULLIF(v_record->>'reference', ''), COALESCE(NULLIF(v_record->>'created_at', '')::timestamptz, now()));
  END LOOP;
  PERFORM set_config('app.importing_movement', 'false', true);

  FOR v_row IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'source_rows', '[]'::jsonb)) LOOP
    INSERT INTO public.retail_import_source_rows (batch_id, sheet_name, source_key, source_row_number, entity_type, entity_id, source_payload)
    VALUES (v_batch_id, v_row->>'sheet_name', v_row->>'source_key', (v_row->>'row_number')::integer,
      v_row->>'entity_type', (v_row->>'entity_id')::uuid, v_row->'source_payload');
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'batch_id', v_batch_id);
END
$$;

REVOKE ALL ON FUNCTION public.app_import_retailflow_workbook_batch(uuid, text, text, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_import_retailflow_workbook_batch(uuid, text, text, jsonb, jsonb, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.app_override_cash_session_close(
  p_session_id uuid,
  p_manager_user_id uuid,
  p_counted_cash numeric,
  p_closing_denominations jsonb,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_session public.cash_drawer_sessions%ROWTYPE;
  v_role text;
  v_cash_sales numeric(12,2);
  v_cash_in numeric(12,2);
  v_cash_out numeric(12,2);
  v_expected numeric(12,2);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE user_id = p_manager_user_id AND is_active) THEN
    RAISE EXCEPTION 'Active Manager or Admin access is required';
  END IF;
  SELECT role INTO v_role FROM public.users WHERE user_id = p_manager_user_id;
  SELECT * INTO v_session FROM public.cash_drawer_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR v_session.status <> 'OPEN' THEN RAISE EXCEPTION 'Cash shift is not open'; END IF;
  IF v_role = 'MANAGER' AND NOT EXISTS (
    SELECT 1 FROM public.staff_location_access
    WHERE user_id = p_manager_user_id AND location_id = v_session.location_id
  ) THEN RAISE EXCEPTION 'Manager is not assigned to this location'; END IF;
  IF v_role IS NULL OR v_role NOT IN ('MANAGER', 'ADMIN') THEN RAISE EXCEPTION 'Manager or Admin access is required'; END IF;
  IF p_counted_cash < 0 OR length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Counted cash and a variance reason are required';
  END IF;

  SELECT COALESCE(sum(p.amount), 0) INTO v_cash_sales
  FROM public.payments p JOIN public.invoices i ON i.id = p.invoice_id
  WHERE i.location_id = v_session.location_id
    AND p.created_at >= v_session.opened_at AND p.created_at <= now() AND p.mode = 'CASH';
  SELECT COALESCE(sum(amount) FILTER (WHERE direction = 'IN'), 0),
         COALESCE(sum(amount) FILTER (WHERE direction = 'OUT'), 0)
    INTO v_cash_in, v_cash_out
  FROM public.cash_transactions WHERE session_id = v_session.id;
  v_expected := v_session.opening_cash + v_cash_sales + v_cash_in - v_cash_out;

  PERFORM set_config('request.jwt.claim.sub', p_manager_user_id::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', p_manager_user_id::text, 'role', 'authenticated')::text, true);
  UPDATE public.cash_drawer_sessions SET
    status = 'CLOSED',
    cash_sales = v_cash_sales,
    cash_in = v_cash_in,
    cash_out = v_cash_out,
    closing_cash = p_counted_cash,
    closing_denominations = p_closing_denominations,
    closed_at = now(),
    closed_by_id = p_manager_user_id,
    override_by_id = p_manager_user_id,
    override_reason = btrim(p_reason),
    override_difference = p_counted_cash - v_expected
  WHERE id = p_session_id AND status = 'OPEN';
  IF NOT FOUND THEN RAISE EXCEPTION 'Cash shift was closed by another request'; END IF;
END
$$;

REVOKE ALL ON FUNCTION public.app_override_cash_session_close(uuid, uuid, numeric, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_override_cash_session_close(uuid, uuid, numeric, jsonb, text) TO service_role;
