-- Additive POS runtime support. Published migrations are intentionally unchanged.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS upi_vpa text;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('CASHIER', 'MANAGER', 'ADMIN', 'WAREHOUSE'));

UPDATE public.users
SET username = lower(regexp_replace(
  COALESCE(NULLIF(split_part(email, '@', 1), ''), 'staff') || '_' || left(user_id::text, 5),
  '[^a-zA-Z0-9._-]', '', 'g'
))
WHERE username IS NULL OR btrim(username) = '';

ALTER TABLE public.users ALTER COLUMN username SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique ON public.users (lower(username));

CREATE OR REPLACE FUNCTION public.set_staff_username()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_base text;
  v_candidate text;
  v_suffix integer := 1;
BEGIN
  IF NEW.username IS NOT NULL AND btrim(NEW.username) <> '' THEN
    NEW.username := lower(btrim(NEW.username));
    RETURN NEW;
  END IF;
  v_base := lower(regexp_replace(COALESCE(NULLIF(split_part(NEW.email, '@', 1), ''), 'staff'), '[^a-zA-Z0-9._-]', '', 'g'));
  IF length(v_base) < 3 THEN v_base := 'staff' || left(NEW.user_id::text, 6); END IF;
  v_candidate := v_base;
  WHILE EXISTS (
    SELECT 1 FROM public.users u
    WHERE lower(u.username) = v_candidate AND u.user_id IS DISTINCT FROM NEW.user_id
  ) LOOP
    v_suffix := v_suffix + 1;
    v_candidate := v_base || v_suffix::text;
  END LOOP;
  NEW.username := v_candidate;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS staff_username_before_write ON public.users;
CREATE TRIGGER staff_username_before_write
BEFORE INSERT OR UPDATE OF username, email ON public.users
FOR EACH ROW EXECUTE FUNCTION public.set_staff_username();

ALTER TABLE public.customers ALTER COLUMN name DROP NOT NULL;
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_name_or_mobile_check;
ALTER TABLE public.customers ADD CONSTRAINT customers_name_or_mobile_check
  CHECK (NULLIF(btrim(name), '') IS NOT NULL OR NULLIF(regexp_replace(COALESCE(mobile, ''), '[^0-9]', '', 'g'), '') IS NOT NULL);

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS subcategory text,
  ADD COLUMN IF NOT EXISTS barcode_type text,
  ADD COLUMN IF NOT EXISTS quantity_precision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN IF NOT EXISTS review_reason text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES public.users(user_id);
UPDATE public.products SET barcode_type = 'UNVERIFIED' WHERE barcode IS NOT NULL AND barcode_type IS NULL;
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_barcode_type_check;
ALTER TABLE public.products ADD CONSTRAINT products_barcode_type_check
  CHECK (barcode_type IS NULL OR barcode_type IN ('MANUFACTURER', 'INTERNAL', 'UNVERIFIED'));
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_quantity_precision_check;
ALTER TABLE public.products ADD CONSTRAINT products_quantity_precision_check
  CHECK (quantity_precision BETWEEN 0 AND 3);
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_review_status_check;
ALTER TABLE public.products ADD CONSTRAINT products_review_status_check
  CHECK (review_status IN ('PENDING', 'APPROVED', 'REJECTED'));

CREATE TABLE IF NOT EXISTS public.location_product_assignments (
  id text PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  stock_count_status text NOT NULL DEFAULT 'AWAITING_COUNT'
    CHECK (stock_count_status IN ('AWAITING_COUNT', 'TRACKED')),
  review_status text NOT NULL DEFAULT 'PENDING'
    CHECK (review_status IN ('PENDING', 'APPROVED', 'REJECTED')),
  review_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, location_id)
);
CREATE INDEX IF NOT EXISTS location_product_assignments_location_idx
  ON public.location_product_assignments (location_id, stock_count_status);

CREATE OR REPLACE FUNCTION public.mark_location_product_stock_tracked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.location_product_assignments
    (id, product_id, location_id, stock_count_status, review_status)
  VALUES (NEW.product_id::text || ':' || NEW.location_id::text, NEW.product_id, NEW.location_id, 'TRACKED', 'APPROVED')
  ON CONFLICT (product_id, location_id) DO UPDATE
    SET stock_count_status = 'TRACKED';
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS inventory_marks_location_product_tracked ON public.inventory;
CREATE TRIGGER inventory_marks_location_product_tracked
AFTER INSERT OR UPDATE OF quantity_on_hand ON public.inventory
FOR EACH ROW EXECUTE FUNCTION public.mark_location_product_stock_tracked();
INSERT INTO public.location_product_assignments
  (id, product_id, location_id, stock_count_status, review_status)
SELECT i.product_id::text || ':' || i.location_id::text, i.product_id, i.location_id, 'TRACKED', 'APPROVED'
FROM public.inventory i
ON CONFLICT (product_id, location_id) DO UPDATE SET stock_count_status = 'TRACKED';

CREATE TABLE IF NOT EXISTS public.uncounted_sales (
  id text PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  location_id uuid NOT NULL REFERENCES public.locations(id),
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid REFERENCES public.users(user_id)
);
CREATE INDEX IF NOT EXISTS uncounted_sales_product_location_idx
  ON public.uncounted_sales (product_id, location_id, created_at);

CREATE TABLE IF NOT EXISTS public.barcode_candidates (
  id text PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  code text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VERIFIED', 'REJECTED')),
  source text NOT NULL DEFAULT 'POS_SCAN',
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES public.users(user_id),
  reviewed_at timestamptz,
  review_reason text,
  UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS public.category_reviews (
  id text PRIMARY KEY,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('CATEGORY', 'SUBCATEGORY')),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES public.users(user_id),
  reviewed_at timestamptz,
  review_reason text
);
CREATE UNIQUE INDEX IF NOT EXISTS category_reviews_location_kind_name_idx
  ON public.category_reviews (location_id, kind, lower(name));

CREATE TABLE IF NOT EXISTS public.product_archive_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id),
  archived_by uuid NOT NULL REFERENCES public.users(user_id),
  reason text NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS change_denominations jsonb;
ALTER TABLE public.cash_drawer_sessions ADD COLUMN IF NOT EXISTS close_block_reason text;

ALTER TABLE public.location_product_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uncounted_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barcode_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_archive_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.location_product_assignments, public.uncounted_sales,
  public.barcode_candidates, public.category_reviews, public.product_archive_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.location_product_assignments,
  public.uncounted_sales, public.barcode_candidates, public.category_reviews TO service_role;
GRANT SELECT, INSERT ON public.product_archive_audit TO service_role;

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
      RAISE EXCEPTION 'The signed-in cashier must open the cash shift';
    END IF;
    SELECT role INTO v_role FROM public.users WHERE user_id = NEW.opened_by_id AND is_active;
    IF v_role IS DISTINCT FROM 'CASHIER' THEN
      RAISE EXCEPTION 'Only an assigned Cashier may open a cash shift';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.locations WHERE id = NEW.location_id AND is_active) THEN
      RAISE EXCEPTION 'Cash shifts can only open at an active location';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.staff_location_access WHERE user_id = NEW.opened_by_id AND location_id = NEW.location_id) THEN
      RAISE EXCEPTION 'The cashier is not assigned to this cash drawer';
    END IF;
    IF EXISTS (SELECT 1 FROM public.cash_drawer_sessions WHERE location_id = NEW.location_id AND status = 'OPEN') THEN
      RAISE EXCEPTION 'This location already has an open cash shift';
    END IF;
    IF NEW.opening_denominations IS NULL OR jsonb_typeof(NEW.opening_denominations) <> 'object' THEN
      RAISE EXCEPTION 'Opening denominations must be provided';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_each_text(COALESCE(NEW.opening_denominations, '{}'::jsonb)) denomination
      WHERE denomination.key NOT IN ('500', '200', '100', '50', '20', '10', '5', '2', '1')
        OR denomination.value !~ '^[0-9]+$'
    ) THEN RAISE EXCEPTION 'Opening denominations contain an unsupported value'; END IF;
    SELECT COALESCE(sum(key::numeric * value::numeric), 0) INTO v_denom_total
    FROM jsonb_each_text(COALESCE(NEW.opening_denominations, '{}'::jsonb));
    IF abs(v_denom_total - NEW.opening_cash) > 0.01 THEN
      RAISE EXCEPTION 'Opening denomination total (%) does not match opening cash (%)', v_denom_total, NEW.opening_cash;
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'OPEN' AND NEW.status = 'CLOSED' THEN
    IF NEW.override_by_id IS NOT NULL THEN
      SELECT role INTO v_role FROM public.users WHERE user_id = NEW.override_by_id AND is_active;
      IF v_actor IS DISTINCT FROM NEW.override_by_id OR v_role IS DISTINCT FROM 'MANAGER' OR
         NOT EXISTS (SELECT 1 FROM public.staff_location_access WHERE user_id = NEW.override_by_id AND location_id = OLD.location_id) OR
         NEW.closed_by_id IS DISTINCT FROM NEW.override_by_id OR length(btrim(COALESCE(NEW.override_reason, ''))) < 5 THEN
        RAISE EXCEPTION 'A location-authorized Manager and a variance reason are required';
      END IF;
    ELSE
      NEW.closed_by_id := COALESCE(NEW.closed_by_id, v_actor);
      IF v_actor IS NULL OR NEW.closed_by_id <> v_actor OR OLD.opened_by_id IS DISTINCT FROM v_actor THEN
        RAISE EXCEPTION 'Only the cashier who opened this shift can close it';
      END IF;
    END IF;

    SELECT COALESCE(sum(p.amount), 0) INTO v_cash_sales
    FROM public.payments p JOIN public.invoices i ON i.id = p.invoice_id
    WHERE i.location_id = OLD.location_id AND p.created_at >= OLD.opened_at
      AND p.created_at <= COALESCE(NEW.closed_at, now()) AND p.mode = 'CASH';
    SELECT COALESCE(sum(amount) FILTER (WHERE direction = 'IN'), 0),
           COALESCE(sum(amount) FILTER (WHERE direction = 'OUT'), 0)
      INTO v_cash_in, v_cash_out FROM public.cash_transactions WHERE session_id = OLD.id;
    v_expected := OLD.opening_cash + v_cash_sales + v_cash_in - v_cash_out;
    NEW.cash_sales := v_cash_sales;
    NEW.cash_in := v_cash_in;
    NEW.cash_out := v_cash_out;
    NEW.close_block_reason := NULL;
    IF NEW.override_by_id IS NULL AND abs(COALESCE(NEW.closing_cash, -1) - v_expected) > 0.01 THEN
      RAISE EXCEPTION 'Counted cash (%) differs from expected cash (%). Review cash sales, cash-in, cash-out and returned change.', COALESCE(NEW.closing_cash, 0), v_expected;
    END IF;
    IF NEW.override_by_id IS NOT NULL THEN
      NEW.override_difference := COALESCE(NEW.closing_cash, 0) - v_expected;
    END IF;
    IF NEW.closing_denominations IS NULL OR jsonb_typeof(NEW.closing_denominations) <> 'object' THEN
      RAISE EXCEPTION 'Closing denominations must be provided';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_each_text(COALESCE(NEW.closing_denominations, '{}'::jsonb)) denomination
      WHERE denomination.key NOT IN ('500', '200', '100', '50', '20', '10', '5', '2', '1')
        OR denomination.value !~ '^[0-9]+$'
    ) THEN RAISE EXCEPTION 'Closing denominations contain an unsupported value'; END IF;
    SELECT COALESCE(sum(key::numeric * value::numeric), 0) INTO v_denom_total
    FROM jsonb_each_text(COALESCE(NEW.closing_denominations, '{}'::jsonb));
    IF abs(v_denom_total - COALESCE(NEW.closing_cash, 0)) > 0.01 THEN
      RAISE EXCEPTION 'Closing denomination total (%) does not match counted cash (%)', v_denom_total, NEW.closing_cash;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Warehouse staff may maintain stock. Keep purchase/catalog work manager-only
-- by replacing the legacy operation gate in the published sync function.
DO $migration$
DECLARE
  v_definition text;
  v_updated text;
  v_gate_matches integer;
BEGIN
  SELECT pg_get_functiondef(
    'public.sync_offline_operation(uuid,text,uuid,text,jsonb)'::regprocedure
  ) INTO v_definition;
  IF position(
    'v_role = ''WAREHOUSE'' AND p_operation_type LIKE ''inventory.%''' IN v_definition
  ) = 0 THEN
    SELECT count(*) INTO v_gate_matches
    FROM regexp_matches(v_definition, $gate$
      [[:space:]]*IF[[:space:]]+v_role[[:space:]]+NOT[[:space:]]+IN[[:space:]]*\([[:space:]]*'MANAGER'[[:space:]]*,[[:space:]]*'ADMIN'[[:space:]]*\)[[:space:]]+THEN[[:space:]]+RAISE[[:space:]]+EXCEPTION[[:space:]]+'Manager access is required for this operation';
    $gate$, 'g');
    IF v_gate_matches <> 1 THEN
      RAISE EXCEPTION 'Expected one manager inventory permission check in sync_offline_operation, found %', v_gate_matches;
    END IF;
    v_updated := regexp_replace(
      v_definition,
      $gate$
        [[:space:]]*IF[[:space:]]+v_role[[:space:]]+NOT[[:space:]]+IN[[:space:]]*\([[:space:]]*'MANAGER'[[:space:]]*,[[:space:]]*'ADMIN'[[:space:]]*\)[[:space:]]+THEN[[:space:]]+RAISE[[:space:]]+EXCEPTION[[:space:]]+'Manager access is required for this operation';
      $gate$,
      $new$
    IF v_role NOT IN ('MANAGER', 'ADMIN')
      AND NOT (v_role = 'WAREHOUSE' AND p_operation_type LIKE 'inventory.%') THEN
      RAISE EXCEPTION 'Manager access is required for this operation';
      $new$,
      'g'
    );
    EXECUTE v_updated;
  END IF;
END
$migration$;

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
  v_payment_total numeric(12,2);
  v_payment_collected numeric(12,2);
  v_credit_allocated numeric(12,2);
  v_payment_count integer;
  v_payment_mode_count integer;
  v_existing public.offline_sync_operations%ROWTYPE;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE user_id = p_actor_user_id AND is_active;
  IF v_role IS NULL OR v_role NOT IN ('CASHIER', 'MANAGER', 'ADMIN', 'WAREHOUSE') THEN
    RAISE EXCEPTION 'An active staff account is required';
  END IF;
  SELECT * INTO v_existing
  FROM public.offline_sync_operations
  WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF v_existing.user_id IS DISTINCT FROM p_actor_user_id
      OR v_existing.device_id IS DISTINCT FROM p_device_id
      OR v_existing.outlet_id IS DISTINCT FROM p_outlet_id
      OR v_existing.operation_type IS DISTINCT FROM p_operation_type
      OR v_existing.payload IS DISTINCT FROM COALESCE(p_payload, '{}'::jsonb) THEN
      RAISE EXCEPTION 'This sync operation ID was already used for different POS data';
    END IF;
    RETURN jsonb_build_object(
      'accepted', true,
      'duplicate', true,
      'review_needed', v_existing.sync_status = 'REVIEW',
      'message', v_existing.sync_message
    );
  END IF;
  IF p_operation_type IN ('invoice.draft.save', 'invoice.draft.void', 'invoice.finalize', 'payment.add')
    AND v_role <> 'CASHIER' THEN
    RAISE EXCEPTION 'Only a Cashier may bill or collect payments';
  ELSIF p_operation_type = 'customer.create' AND v_role = 'WAREHOUSE' THEN
    RAISE EXCEPTION 'Warehouse access is limited to stock and barcodes';
  ELSIF p_operation_type = 'customer.update' AND v_role NOT IN ('MANAGER', 'ADMIN') THEN
    RAISE EXCEPTION 'Manager access is required to update customer profiles';
  ELSIF p_operation_type = 'product.quick_add' AND v_role <> 'CASHIER' THEN
    RAISE EXCEPTION 'Only a Cashier may quick-add a billing SKU';
  ELSIF p_operation_type IN ('product.create', 'product.update', 'shortcut.update')
    AND v_role NOT IN ('MANAGER', 'ADMIN') THEN
    RAISE EXCEPTION 'Manager access is required for catalog changes';
  ELSIF p_operation_type LIKE 'purchase.%' AND v_role NOT IN ('MANAGER', 'ADMIN') THEN
    RAISE EXCEPTION 'Manager access is required for purchase operations';
  ELSIF p_operation_type LIKE 'inventory.%' AND v_role NOT IN ('MANAGER', 'ADMIN', 'WAREHOUSE') THEN
    RAISE EXCEPTION 'Manager or Warehouse access is required for stock operations';
  ELSIF p_operation_type IN ('cash.session.open', 'cash.session.close', 'cash.transaction.create')
    AND v_role <> 'CASHIER' THEN
    RAISE EXCEPTION 'Only a Cashier may manage a cash shift';
  END IF;
  IF p_operation_type IN ('invoice.finalize', 'payment.add') THEN
    IF p_operation_type = 'invoice.finalize' THEN
      v_record := p_payload->'invoice';
    ELSE
      SELECT to_jsonb(i) INTO v_record
      FROM public.invoices i
      WHERE i.id = ((p_payload->'invoice'->>'id')::uuid);
    END IF;
    v_location_id := (v_record->>'location_id')::uuid;
    IF p_outlet_id IS DISTINCT FROM v_location_id THEN
      RAISE EXCEPTION 'The bill location does not match the signed-in POS location';
    END IF;
    IF p_operation_type = 'payment.add' AND (
      upper(COALESCE(p_payload->'payment'->>'mode', '')) NOT IN ('CASH', 'UPI', 'CARD')
      OR COALESCE((p_payload->'payment'->>'amount')::numeric, 0) <= 0
      OR (p_payload->'payment'->>'amount')::numeric > COALESCE((v_record->>'balance_amount')::numeric, 0)
    ) THEN RAISE EXCEPTION 'Enter a valid collection that does not exceed the bill balance'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.staff_location_access
      WHERE user_id = p_actor_user_id AND location_id = v_location_id
    ) THEN RAISE EXCEPTION 'Location access denied for this bill'; END IF;
    IF p_operation_type = 'invoice.finalize' AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(p_payload->'items', '[]'::jsonb)) item
      JOIN public.products product ON product.id = (item->>'product_id')::uuid
      WHERE NOT product.is_active OR product.review_status = 'REJECTED'
        OR NOT EXISTS (
          SELECT 1 FROM public.location_product_assignments assignment
          WHERE assignment.product_id = product.id AND assignment.location_id = v_location_id
        )
    ) THEN RAISE EXCEPTION 'A SKU is inactive, rejected, or not assigned to this store'; END IF;
    IF v_role = 'CASHIER' THEN
      v_event_at := CASE
        WHEN p_operation_type = 'payment.add'
          THEN COALESCE(NULLIF(p_payload->'payment'->>'created_at', '')::timestamptz, now())
        ELSE COALESCE(NULLIF(v_record->>'created_at', '')::timestamptz, now())
      END;
      IF NOT EXISTS (
        SELECT 1 FROM public.cash_drawer_sessions
        WHERE location_id = v_location_id AND opened_by_id = p_actor_user_id
          AND opened_at <= v_event_at AND (closed_at IS NULL OR closed_at >= v_event_at)
      ) THEN RAISE EXCEPTION 'Open your cash shift before recording sales or collecting a bill balance'; END IF;
    END IF;
  END IF;
  IF p_operation_type = 'cash.transaction.create' THEN
    v_record := p_payload->'transaction';
    v_location_id := (v_record->>'location_id')::uuid;
    IF p_outlet_id IS DISTINCT FROM v_location_id OR NOT EXISTS (
      SELECT 1 FROM public.cash_drawer_sessions
      WHERE id = NULLIF(v_record->>'session_id', '')::uuid
        AND location_id = v_location_id AND opened_by_id = p_actor_user_id AND status = 'OPEN'
    ) THEN RAISE EXCEPTION 'Cash movements require your own open shift at this location'; END IF;
  END IF;
  IF p_operation_type = 'product.quick_add' THEN
    v_record := p_payload->'product';
    v_location_id := NULLIF(p_payload->>'location_id', '')::uuid;
    IF p_outlet_id IS DISTINCT FROM v_location_id OR NOT EXISTS (
      SELECT 1 FROM public.staff_location_access
      WHERE user_id = p_actor_user_id AND location_id = v_location_id
    ) THEN RAISE EXCEPTION 'Quick-add the SKU at an assigned store'; END IF;
  END IF;
  IF p_operation_type = 'product.quick_add' THEN
    v_record := p_payload->'product';
    IF EXISTS (SELECT 1 FROM public.products WHERE id = (v_record->>'id')::uuid) AND (
      COALESCE((p_payload->>'correction')::boolean, false) IS DISTINCT FROM true OR
      NOT EXISTS (SELECT 1 FROM public.products WHERE id = (v_record->>'id')::uuid AND review_status = 'REJECTED')
    ) THEN RAISE EXCEPTION 'This SKU already exists and is not awaiting correction'; END IF;
    IF COALESCE((p_payload->>'correction')::boolean, false) AND NOT EXISTS (
      SELECT 1 FROM public.location_product_assignments
      WHERE product_id = (v_record->>'id')::uuid AND location_id = (p_payload->>'location_id')::uuid
    ) THEN RAISE EXCEPTION 'This SKU is not assigned to the selected location'; END IF;
  END IF;
  IF p_operation_type = 'invoice.finalize' THEN
    v_record := p_payload->'invoice';
    IF NULLIF(v_record->>'customer_id', '') IS NULL THEN RAISE EXCEPTION 'Select a customer before completing the bill'; END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_payload->'items', '[]'::jsonb)) item
      JOIN public.products product ON product.id = (item->>'product_id')::uuid
      WHERE (item->>'quantity')::numeric <= 0 OR
        (NOT product.is_loose AND (item->>'quantity')::numeric <> trunc((item->>'quantity')::numeric)) OR
        (product.is_loose AND abs((item->>'quantity')::numeric * power(10, product.quantity_precision) -
          round((item->>'quantity')::numeric * power(10, product.quantity_precision))) > 0.0001)
    ) THEN RAISE EXCEPTION 'One or more item quantities do not match their configured sale unit precision'; END IF;
    SELECT
      COALESCE(sum((payment->>'amount')::numeric), 0),
      COALESCE(sum((payment->>'amount')::numeric) FILTER (WHERE upper(payment->>'mode') <> 'CREDIT'), 0),
      COALESCE(sum((payment->>'amount')::numeric) FILTER (WHERE upper(payment->>'mode') = 'CREDIT'), 0),
      count(*), count(DISTINCT upper(payment->>'mode'))
    INTO v_payment_total, v_payment_collected, v_credit_allocated, v_payment_count, v_payment_mode_count
    FROM jsonb_array_elements(COALESCE(p_payload->'payments', '[]'::jsonb)) AS payment;
    IF v_payment_count = 0 OR v_payment_count <> v_payment_mode_count OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_payload->'payments', '[]'::jsonb)) AS payment
      WHERE upper(payment->>'mode') NOT IN ('CASH', 'UPI', 'CARD', 'CREDIT')
        OR COALESCE((payment->>'amount')::numeric, 0) <= 0
    ) THEN RAISE EXCEPTION 'Use one positive amount for each selected payment mode'; END IF;
    IF abs(v_payment_total - COALESCE((v_record->>'total_amount')::numeric, 0)) > 0.01
       OR abs(v_payment_collected - COALESCE((v_record->>'paid_amount')::numeric, 0)) > 0.01
       OR abs(v_credit_allocated - COALESCE((v_record->>'balance_amount')::numeric, 0)) > 0.01 THEN
      RAISE EXCEPTION 'Allocate the full bill to collected payments and customer credit';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(p_payload->'payments', '[]'::jsonb)) AS payment
      CROSS JOIN LATERAL (
        SELECT COALESCE(sum(denomination.key::numeric * denomination.value::numeric), 0) AS total
        FROM jsonb_each_text(
          CASE WHEN jsonb_typeof(payment->'change_denominations') = 'object'
            THEN payment->'change_denominations' ELSE '{}'::jsonb END
        ) AS denomination
      ) AS change_count
      WHERE upper(payment->>'mode') = 'CASH' AND (
        NULLIF(payment->>'tendered', '') IS NULL OR NULLIF(payment->>'change_given', '') IS NULL
        OR abs((payment->>'tendered')::numeric - (payment->>'change_given')::numeric - (payment->>'amount')::numeric) > 0.01
        OR (payment->'change_denominations' IS NOT NULL AND
          jsonb_typeof(payment->'change_denominations') NOT IN ('object', 'null'))
        OR ((payment->>'change_given')::numeric > 0 AND
          jsonb_typeof(payment->'change_denominations') <> 'object')
        OR change_count.total <> COALESCE((payment->>'change_given')::numeric, 0)
        OR EXISTS (
          SELECT 1 FROM jsonb_each_text(
            CASE WHEN jsonb_typeof(payment->'change_denominations') = 'object'
              THEN payment->'change_denominations' ELSE '{}'::jsonb END
          ) denomination
          WHERE denomination.key NOT IN ('500', '200', '100', '50', '20', '10', '5', '2', '1')
            OR denomination.value !~ '^[0-9]+$'
        )
      )
    ) THEN RAISE EXCEPTION 'Cash tender and returned denominations do not match the bill'; END IF;
    IF v_credit_allocated > 0 AND NOT EXISTS (
      SELECT 1 FROM public.customers customer
      WHERE customer.id = NULLIF(v_record->>'customer_id', '')::uuid
        AND customer.outstanding_balance + v_credit_allocated <= customer.credit_limit
    ) THEN RAISE EXCEPTION 'Customer credit limit would be exceeded'; END IF;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', p_actor_user_id::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', p_actor_user_id::text, 'role', 'authenticated')::text, true);
  v_result := public.sync_offline_operation(p_operation_id, p_device_id, p_outlet_id, p_operation_type, p_payload);

  IF COALESCE((v_result->>'accepted')::boolean, false)
    AND NOT COALESCE((v_result->>'review_needed')::boolean, false) THEN
    IF p_operation_type IN ('product.create', 'product.quick_add', 'product.update') THEN
      v_record := p_payload->'product';
      IF COALESCE((p_payload->>'correction')::boolean, false) THEN
        UPDATE public.products SET
          name = v_record->>'name', sku = v_record->>'sku', category = NULLIF(v_record->>'category', ''),
          subcategory = NULLIF(v_record->>'subcategory', ''), variant = NULLIF(v_record->>'variant', ''),
          sale_price = (v_record->>'sale_price')::numeric, uom_sale = v_record->>'uom_sale',
          review_status = 'PENDING', review_reason = NULL, enrichment_status = 'PENDING'
        WHERE id = (v_record->>'id')::uuid;
        UPDATE public.location_product_assignments SET review_status = 'PENDING', review_reason = NULL
        WHERE product_id = (v_record->>'id')::uuid AND location_id = (p_payload->>'location_id')::uuid;
      ELSE
        UPDATE public.products SET
          price_tiers = COALESCE(v_record->'price_tiers', price_tiers),
          subcategory = COALESCE(NULLIF(v_record->>'subcategory', ''), subcategory),
          barcode_type = COALESCE(NULLIF(v_record->>'barcode_type', ''), barcode_type),
          quantity_precision = COALESCE((v_record->>'quantity_precision')::integer, quantity_precision),
          review_status = COALESCE(NULLIF(v_record->>'review_status', ''), review_status),
          review_reason = COALESCE(v_record->>'review_reason', review_reason)
        WHERE id = (v_record->>'id')::uuid;
        IF p_operation_type = 'product.update' AND v_record ? 'review_status' THEN
          UPDATE public.location_product_assignments SET
            review_status = v_record->>'review_status', review_reason = v_record->>'review_reason'
          WHERE product_id = (v_record->>'id')::uuid;
        END IF;
      END IF;
      IF p_operation_type IN ('product.create', 'product.quick_add') AND p_payload->'location_product' IS NOT NULL THEN
        v_record := p_payload->'location_product';
        INSERT INTO public.location_product_assignments
          (id, product_id, location_id, stock_count_status, review_status, review_reason)
        VALUES (v_record->>'id', (v_record->>'product_id')::uuid, (v_record->>'location_id')::uuid,
          COALESCE(v_record->>'stock_count_status', 'AWAITING_COUNT'), COALESCE(v_record->>'review_status', 'PENDING'), v_record->>'review_reason')
        ON CONFLICT (product_id, location_id) DO NOTHING;
      END IF;
      IF p_payload->'barcode_candidate' IS NOT NULL AND p_payload->'barcode_candidate' <> 'null'::jsonb THEN
        v_record := p_payload->'barcode_candidate';
        INSERT INTO public.barcode_candidates (id, product_id, location_id, code)
        VALUES (v_record->>'id', (v_record->>'product_id')::uuid, (v_record->>'location_id')::uuid, v_record->>'code')
        ON CONFLICT (code) DO NOTHING;
      END IF;
      FOR v_record IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'category_reviews', '[]'::jsonb)) LOOP
        INSERT INTO public.category_reviews (id, location_id, kind, name)
        VALUES (v_record->>'id', (v_record->>'location_id')::uuid, v_record->>'kind', v_record->>'name')
        ON CONFLICT (id) DO UPDATE SET status = 'PENDING', review_reason = NULL,
          reviewed_by = NULL, reviewed_at = NULL
        WHERE public.category_reviews.status = 'REJECTED';
      END LOOP;
    ELSIF p_operation_type = 'invoice.finalize' THEN
      v_record := p_payload->'invoice';
      UPDATE public.invoices SET
        customer_segment = COALESCE(NULLIF(v_record->>'customer_segment', ''), customer_segment),
        order_type = COALESCE(NULLIF(v_record->>'order_type', ''), order_type)
      WHERE id = (v_record->>'id')::uuid;
      UPDATE public.invoice_items target SET unit_cost_snapshot = NULLIF(source->>'unit_cost_snapshot', '')::numeric
      FROM jsonb_array_elements(COALESCE(p_payload->'items', '[]'::jsonb)) source
      WHERE target.id = (source->>'id')::uuid AND source ? 'unit_cost_snapshot';
      UPDATE public.payments target SET change_denominations = source->'change_denominations'
      FROM jsonb_array_elements(COALESCE(p_payload->'payments', '[]'::jsonb)) source
      WHERE target.id = (source->>'id')::uuid AND source ? 'change_denominations';
      FOR v_record IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'uncounted_sales', '[]'::jsonb)) LOOP
        IF NOT EXISTS (
          SELECT 1 FROM public.location_product_assignments a
          WHERE a.product_id = (v_record->>'product_id')::uuid
            AND a.location_id = (v_record->>'location_id')::uuid
            AND a.stock_count_status = 'AWAITING_COUNT'
        ) THEN RAISE EXCEPTION 'An uncounted sale does not match an awaiting-count SKU at this location'; END IF;
        INSERT INTO public.uncounted_sales (id, invoice_id, product_id, location_id, quantity, created_at, recorded_by)
        VALUES (v_record->>'id', (v_record->>'invoice_id')::uuid, (v_record->>'product_id')::uuid,
          (v_record->>'location_id')::uuid, (v_record->>'quantity')::numeric,
          COALESCE((v_record->>'created_at')::timestamptz, now()), p_actor_user_id)
        ON CONFLICT (id) DO NOTHING;
      END LOOP;
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

REVOKE ALL ON FUNCTION public.app_sync_offline_operation_as_staff(uuid, uuid, text, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_sync_offline_operation_as_staff(uuid, uuid, text, uuid, text, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.app_review_barcode_candidate(
  p_actor_user_id uuid,
  p_candidate_id text,
  p_status text,
  p_barcode_type text,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_role text;
  v_candidate public.barcode_candidates%ROWTYPE;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE user_id = p_actor_user_id AND is_active;
  IF v_role NOT IN ('MANAGER', 'ADMIN', 'WAREHOUSE') THEN RAISE EXCEPTION 'Manager, Admin or Warehouse barcode access is required'; END IF;
  IF p_status NOT IN ('VERIFIED', 'REJECTED') THEN RAISE EXCEPTION 'Choose verified or rejected'; END IF;
  SELECT * INTO v_candidate FROM public.barcode_candidates WHERE id = p_candidate_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Barcode candidate not found'; END IF;
  IF v_role <> 'ADMIN' AND NOT EXISTS (
    SELECT 1 FROM public.staff_location_access WHERE user_id = p_actor_user_id AND location_id = v_candidate.location_id
  ) THEN RAISE EXCEPTION 'You are not assigned to this location'; END IF;
  IF p_status = 'VERIFIED' THEN
    IF p_barcode_type NOT IN ('MANUFACTURER', 'INTERNAL') THEN RAISE EXCEPTION 'Choose a barcode type'; END IF;
    UPDATE public.products SET barcode = v_candidate.code, barcode_type = p_barcode_type
    WHERE id = v_candidate.product_id;
  ELSE
    UPDATE public.products SET barcode = NULL, barcode_type = NULL
    WHERE id = v_candidate.product_id AND barcode = v_candidate.code AND barcode_type = 'UNVERIFIED';
  END IF;
  UPDATE public.barcode_candidates SET status = p_status, reviewed_by = p_actor_user_id,
    reviewed_at = now(), review_reason = NULLIF(btrim(p_reason), '')
  WHERE id = p_candidate_id;
END
$$;
REVOKE ALL ON FUNCTION public.app_review_barcode_candidate(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_review_barcode_candidate(uuid, text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.app_assign_product_barcode(
  p_actor_user_id uuid,
  p_product_id uuid,
  p_location_id uuid,
  p_code text,
  p_barcode_type text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_role text;
  v_sku text;
  v_expected_internal text;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE user_id = p_actor_user_id AND is_active;
  IF v_role NOT IN ('MANAGER', 'ADMIN', 'WAREHOUSE') THEN RAISE EXCEPTION 'Manager, Admin or Warehouse barcode access is required'; END IF;
  IF v_role <> 'ADMIN' AND NOT EXISTS (
    SELECT 1 FROM public.staff_location_access WHERE user_id = p_actor_user_id AND location_id = p_location_id
  ) THEN RAISE EXCEPTION 'You are not assigned to this location'; END IF;
  IF p_barcode_type NOT IN ('MANUFACTURER', 'INTERNAL') OR NULLIF(btrim(p_code), '') IS NULL THEN RAISE EXCEPTION 'Enter a barcode and its type'; END IF;
  SELECT sku INTO v_sku FROM public.products WHERE id = p_product_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active SKU not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.location_product_assignments WHERE product_id = p_product_id AND location_id = p_location_id) THEN
    RAISE EXCEPTION 'This SKU is not assigned to the selected location';
  END IF;
  IF EXISTS (SELECT 1 FROM public.products WHERE lower(barcode) = lower(btrim(p_code)) AND id <> p_product_id) THEN
    RAISE EXCEPTION 'This barcode is already assigned to another SKU';
  END IF;
  IF p_barcode_type = 'INTERNAL' THEN
    v_expected_internal := left('RF' || regexp_replace(upper(COALESCE(v_sku, '')), '[^A-Z0-9]', '', 'g'), 80);
    IF btrim(p_code) <> v_expected_internal THEN RAISE EXCEPTION 'Internal labels must use the generated RF SKU code'; END IF;
  END IF;
  UPDATE public.products SET barcode = btrim(p_code), barcode_type = p_barcode_type WHERE id = p_product_id;
END
$$;
REVOKE ALL ON FUNCTION public.app_assign_product_barcode(uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_assign_product_barcode(uuid, uuid, uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.app_archive_product_as_admin(
  p_actor_user_id uuid,
  p_product_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE user_id = p_actor_user_id AND role = 'ADMIN' AND is_active) THEN
    RAISE EXCEPTION 'Only a signed-in Admin may archive a SKU';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 5 THEN RAISE EXCEPTION 'Enter an archive reason'; END IF;
  UPDATE public.products SET is_active = false, archived_at = now(), archived_by = p_actor_user_id
  WHERE id = p_product_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active SKU not found'; END IF;
  INSERT INTO public.product_archive_audit (product_id, archived_by, reason)
  VALUES (p_product_id, p_actor_user_id, btrim(p_reason));
END
$$;
REVOKE ALL ON FUNCTION public.app_archive_product_as_admin(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_archive_product_as_admin(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.app_update_own_username(
  p_actor_user_id uuid,
  p_username text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE v_username text := lower(btrim(COALESCE(p_username, '')));
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE user_id = p_actor_user_id AND is_active) THEN
    RAISE EXCEPTION 'Active staff profile not found';
  END IF;
  IF v_username !~ '^[a-z0-9][a-z0-9._-]{2,31}$' THEN RAISE EXCEPTION 'Use 3–32 letters, numbers, dots, underscores or hyphens'; END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE lower(username) = v_username AND user_id <> p_actor_user_id) THEN
    RAISE EXCEPTION 'That username is already in use';
  END IF;
  UPDATE public.users SET username = v_username, updated_at = now() WHERE user_id = p_actor_user_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active staff profile not found'; END IF;
  RETURN v_username;
END
$$;
REVOKE ALL ON FUNCTION public.app_update_own_username(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_update_own_username(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.app_review_category_suggestion(
  p_actor_user_id uuid,
  p_category_id text,
  p_status text,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_role text;
  v_location_id uuid;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE user_id = p_actor_user_id AND is_active;
  IF v_role IS DISTINCT FROM 'ADMIN' AND v_role IS DISTINCT FROM 'MANAGER' THEN
    RAISE EXCEPTION 'Only a Manager or Admin may review category suggestions';
  END IF;
  IF p_status NOT IN ('APPROVED', 'REJECTED') THEN RAISE EXCEPTION 'Choose approve or return'; END IF;
  IF p_status = 'REJECTED' AND length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Enter a clear rejection reason';
  END IF;
  SELECT location_id INTO v_location_id FROM public.category_reviews
  WHERE id = p_category_id AND status = 'PENDING' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This category is no longer waiting for review'; END IF;
  IF v_role = 'MANAGER' AND NOT EXISTS (
    SELECT 1 FROM public.staff_location_access
    WHERE user_id = p_actor_user_id AND location_id = v_location_id
  ) THEN RAISE EXCEPTION 'This category belongs to a location outside your assignment'; END IF;
  UPDATE public.category_reviews SET status = p_status,
    review_reason = CASE WHEN p_status = 'REJECTED' THEN btrim(p_reason) ELSE NULL END,
    reviewed_by = p_actor_user_id, reviewed_at = now()
  WHERE id = p_category_id;
END
$$;
REVOKE ALL ON FUNCTION public.app_review_category_suggestion(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_review_category_suggestion(uuid, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.app_save_staff_profile(
  p_actor_user_id uuid,
  p_user_id uuid,
  p_display_name text,
  p_email text,
  p_phone text,
  p_role text,
  p_location_ids uuid[],
  p_is_active boolean,
  p_must_change_password boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_actor_role text;
  v_existing_role text;
BEGIN
  SELECT role INTO v_actor_role FROM public.users WHERE user_id = p_actor_user_id AND is_active;
  IF v_actor_role NOT IN ('ADMIN', 'MANAGER') THEN RAISE EXCEPTION 'Active Admin or Manager access is required'; END IF;
  IF p_user_id IS NULL OR NULLIF(btrim(p_display_name), '') IS NULL THEN RAISE EXCEPTION 'Staff ID and display name are required'; END IF;
  IF p_role NOT IN ('CASHIER', 'MANAGER', 'ADMIN', 'WAREHOUSE') THEN RAISE EXCEPTION 'Unsupported staff role'; END IF;
  IF p_role = 'WAREHOUSE' AND v_actor_role <> 'ADMIN' THEN RAISE EXCEPTION 'Only an Admin may manage Warehouse accounts'; END IF;
  IF p_user_id = p_actor_user_id AND p_role <> v_actor_role THEN RAISE EXCEPTION 'You cannot change your own staff role'; END IF;
  IF p_role <> 'ADMIN' AND p_is_active AND COALESCE(cardinality(p_location_ids), 0) = 0 THEN
    RAISE EXCEPTION 'Assign at least one active location to an active staff member';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN RAISE EXCEPTION 'Supabase Auth user does not exist'; END IF;

  IF v_actor_role = 'MANAGER' THEN
    IF p_role <> 'CASHIER' THEN RAISE EXCEPTION 'Managers may only manage Cashier accounts'; END IF;
    SELECT role INTO v_existing_role FROM public.users WHERE user_id = p_user_id;
    IF v_existing_role IS NOT NULL AND v_existing_role <> 'CASHIER' THEN RAISE EXCEPTION 'Managers may only manage Cashier accounts'; END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(COALESCE(p_location_ids, '{}'::uuid[])) requested(location_id)
      WHERE NOT EXISTS (SELECT 1 FROM public.staff_location_access own_access
        WHERE own_access.user_id = p_actor_user_id AND own_access.location_id = requested.location_id)
    ) THEN RAISE EXCEPTION 'Managers may assign Cashiers only to their assigned locations'; END IF;
    IF EXISTS (
      SELECT 1 FROM public.staff_location_access existing_access WHERE existing_access.user_id = p_user_id
      AND NOT EXISTS (SELECT 1 FROM public.staff_location_access own_access
        WHERE own_access.user_id = p_actor_user_id AND own_access.location_id = existing_access.location_id)
    ) THEN RAISE EXCEPTION 'This Cashier has access outside your locations; ask an Admin to update the account'; END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_location_ids, '{}'::uuid[])) requested(location_id)
    WHERE NOT EXISTS (SELECT 1 FROM public.locations WHERE id = requested.location_id)
  ) THEN RAISE EXCEPTION 'One or more assigned locations do not exist'; END IF;
  IF p_is_active AND p_role <> 'ADMIN' AND EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_location_ids, '{}'::uuid[])) requested(location_id)
    WHERE NOT EXISTS (SELECT 1 FROM public.locations WHERE id = requested.location_id AND is_active)
  ) THEN RAISE EXCEPTION 'Active staff must be assigned only to active locations'; END IF;

  INSERT INTO public.users (user_id, display_name, email, phone, role, is_active, must_change_password)
  VALUES (p_user_id, btrim(p_display_name), NULLIF(lower(btrim(p_email)), ''), NULLIF(btrim(p_phone), ''),
    p_role, p_is_active, p_must_change_password)
  ON CONFLICT (user_id) DO UPDATE SET
    display_name = EXCLUDED.display_name, email = EXCLUDED.email, phone = EXCLUDED.phone,
    role = EXCLUDED.role, is_active = EXCLUDED.is_active,
    must_change_password = EXCLUDED.must_change_password, updated_at = now();
  DELETE FROM public.staff_location_access WHERE user_id = p_user_id;
  INSERT INTO public.staff_location_access (user_id, location_id)
  SELECT p_user_id, requested.location_id FROM unnest(COALESCE(p_location_ids, '{}'::uuid[])) requested(location_id)
  ON CONFLICT DO NOTHING;
END
$$;
REVOKE ALL ON FUNCTION public.app_save_staff_profile(uuid, uuid, text, text, text, text, uuid[], boolean, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_save_staff_profile(uuid, uuid, text, text, text, text, uuid[], boolean, boolean)
  TO service_role;
