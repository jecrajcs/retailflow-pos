-- Consolidated DailyPlazaa POS baseline. Run once only against the intentionally reset application schema.
-- The Supabase-managed auth, storage, and system schemas are preserved.
BEGIN;
-- Destructive baseline reset. This drops only app-owned public objects
-- from the previous SQL migrations; Supabase-managed auth.*, storage, and
-- system schemas are preserved.

DROP POLICY IF EXISTS supplier_invoice_scoped_read ON storage.objects;
DROP POLICY IF EXISTS supplier_invoice_scoped_insert ON storage.objects;
DROP POLICY IF EXISTS supplier_invoice_scoped_update ON storage.objects;
DROP POLICY IF EXISTS supplier_invoice_scoped_delete ON storage.objects;

DROP FUNCTION IF EXISTS public.set_invoice_number() CASCADE;
DROP FUNCTION IF EXISTS public.create_pos_invoice(uuid, uuid, numeric, jsonb, jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.create_pos_invoice(uuid, uuid, numeric, jsonb, jsonb, date) CASCADE;
DROP FUNCTION IF EXISTS public.add_payment(uuid, numeric, text) CASCADE;
DROP FUNCTION IF EXISTS public.receive_stock_transfer(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.create_stock_adjustment(uuid, uuid, numeric, text, boolean) CASCADE;
DROP FUNCTION IF EXISTS public.open_cash_session(uuid, text, numeric) CASCADE;
DROP FUNCTION IF EXISTS public.open_cash_session(uuid, text, numeric, jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.close_cash_session(uuid, numeric, numeric, numeric) CASCADE;
DROP FUNCTION IF EXISTS public.close_cash_session(uuid, numeric, numeric, numeric, jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.log_cash_txn(uuid, uuid, text, numeric, text) CASCADE;
DROP FUNCTION IF EXISTS public.log_inventory_movement() CASCADE;
DROP FUNCTION IF EXISTS public.current_staff_role() CASCADE;
DROP FUNCTION IF EXISTS public.can_access_location(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.can_manage_retail_data() CASCADE;
DROP FUNCTION IF EXISTS public.sync_offline_operation(uuid, text, uuid, text, jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.admin_set_staff_access(uuid, text, text, uuid[], boolean) CASCADE;
DROP FUNCTION IF EXISTS public.complete_first_login_password_change() CASCADE;
DROP FUNCTION IF EXISTS public.resolve_inventory_sync_alert(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.set_product_price_tiers(uuid, jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.app_save_staff_profile(uuid, uuid, text, text, text, text, text, text, uuid[], boolean, boolean) CASCADE;
DROP FUNCTION IF EXISTS public.app_save_staff_profile(uuid, uuid, text, text, text, text, uuid[], boolean, boolean) CASCADE;
DROP FUNCTION IF EXISTS public.app_complete_first_admin_bootstrap(text, uuid, text, text, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.app_sync_offline_operation_as_staff(uuid, uuid, text, uuid, text, jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.app_resolve_inventory_sync_alert(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.app_set_product_price_tiers(uuid, uuid, jsonb) CASCADE;

DROP TABLE IF EXISTS
  public.auth_bootstrap_tokens,
  public.auth_login_identifiers,
  public.auth_rate_limits,
  public.auth_verifications,
  public.auth_accounts,
  public.auth_sessions,
  public.auth_users,
  public.inventory_sync_alerts,
  public.offline_sync_operations,
  public.purchase_receipt_items,
  public.purchase_receipts,
  public.cashier_shortcuts,
  public.stock_movements,
  public.cash_transactions,
  public.stock_adjustments,
  public.cash_drawer_sessions,
  public.stock_transfer_items,
  public.stock_transfers,
  public.payments,
  public.invoice_items,
  public.invoices,
  public.customers,
  public.inventory,
  public.products,
  public.staff_location_access,
  public.users,
  public.staff_profiles,
  public.locations
CASCADE;

DROP SEQUENCE IF EXISTS public.invoice_number_seq CASCADE;

CREATE TABLE public.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  type text NOT NULL DEFAULT 'RETAIL',
  address text,
  phone text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  name_hi text,
  search_aliases text[] NOT NULL DEFAULT '{}',
  sku text,
  barcode text,
  hsn text,
  category text,
  variant text,
  rack_location text,
  preferred_supplier text,
  purchase_cost numeric(12,2) NOT NULL DEFAULT 0,
  mrp numeric(12,2) NOT NULL DEFAULT 0,
  sale_price numeric(12,2) NOT NULL DEFAULT 0,
  min_sale_price numeric(12,2) NOT NULL DEFAULT 0,
  price_tiers jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(price_tiers) = 'array'),
  uom_purchase text NOT NULL DEFAULT 'UNIT',
  uom_stock text NOT NULL DEFAULT 'UNIT',
  uom_sale text NOT NULL DEFAULT 'UNIT',
  conversion_factor numeric(12,4) NOT NULL DEFAULT 1,
  min_stock numeric(12,2) NOT NULL DEFAULT 0,
  is_loose boolean NOT NULL DEFAULT false,
  enrichment_status text NOT NULL DEFAULT 'COMPLETE',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  quantity_on_hand numeric(14,3) NOT NULL DEFAULT 0,
  reserved_qty numeric(14,3) NOT NULL DEFAULT 0,
  UNIQUE (product_id, location_id)
);

CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  mobile text,
  age_group text,
  gender text,
  credit_limit numeric(12,2) NOT NULL DEFAULT 0,
  outstanding_balance numeric(12,2) NOT NULL DEFAULT 0,
  notes text,
  visits integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  email text,
  phone text,
  role text NOT NULL CHECK (role IN ('CASHIER', 'MANAGER', 'ADMIN')),
  is_active boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.staff_location_access (
  user_id uuid NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, location_id)
);

CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text UNIQUE,
  location_id uuid NOT NULL REFERENCES public.locations(id),
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  paid_amount numeric(12,2) NOT NULL DEFAULT 0,
  balance_amount numeric(12,2) NOT NULL DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'UNPAID'
    CHECK (payment_status IN ('PAID', 'PARTIALLY_PAID', 'UNPAID')),
  invoice_status text NOT NULL DEFAULT 'COMPLETED',
  business_date date NOT NULL DEFAULT CURRENT_DATE,
  draft_payload jsonb,
  cashier_id uuid CONSTRAINT invoices_cashier_id_app_fkey REFERENCES public.users(user_id),
  cashier_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  quantity numeric(14,3) NOT NULL DEFAULT 1,
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  uom text NOT NULL DEFAULT 'UNIT',
  discount numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL,
  mode text NOT NULL DEFAULT 'CASH',
  tendered numeric(12,2),
  change_given numeric(12,2),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_location_id uuid NOT NULL REFERENCES public.locations(id),
  to_location_id uuid NOT NULL REFERENCES public.locations(id),
  status text NOT NULL DEFAULT 'REQUESTED',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.stock_transfer_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES public.stock_transfers(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  quantity numeric(14,3) NOT NULL DEFAULT 1
);

CREATE TABLE public.cash_drawer_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.locations(id),
  opened_by text NOT NULL DEFAULT 'Operator',
  opening_cash numeric(12,2) NOT NULL DEFAULT 0,
  closing_cash numeric(12,2),
  cash_sales numeric(12,2) NOT NULL DEFAULT 0,
  cash_in numeric(12,2) NOT NULL DEFAULT 0,
  cash_out numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'OPEN',
  opening_denominations jsonb,
  closing_denominations jsonb,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE TABLE public.stock_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  quantity numeric(14,3) NOT NULL,
  reason text NOT NULL DEFAULT 'SPOILAGE',
  returnable_to_vendor boolean NOT NULL DEFAULT false,
  cost_loss numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id),
  location_id uuid NOT NULL REFERENCES public.locations(id),
  movement_type text NOT NULL DEFAULT 'STOCK CHANGE',
  quantity_delta numeric NOT NULL,
  quantity_on_hand numeric NOT NULL,
  reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.cash_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.cash_drawer_sessions(id) ON DELETE SET NULL,
  location_id uuid NOT NULL REFERENCES public.locations(id),
  direction text NOT NULL CHECK (direction IN ('IN', 'OUT')),
  amount numeric NOT NULL,
  reason text NOT NULL DEFAULT 'OTHER',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.offline_sync_operations (
  operation_id uuid PRIMARY KEY,
  user_id uuid NOT NULL CONSTRAINT offline_sync_operations_user_id_app_fkey
    REFERENCES public.users(user_id),
  device_id text NOT NULL,
  outlet_id uuid REFERENCES public.locations(id),
  operation_type text NOT NULL,
  payload jsonb NOT NULL,
  sync_status text NOT NULL DEFAULT 'SYNCED' CHECK (sync_status IN ('SYNCED', 'REVIEW')),
  sync_message text,
  created_at timestamptz NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.inventory_sync_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES public.offline_sync_operations(operation_id),
  product_id uuid NOT NULL REFERENCES public.products(id),
  location_id uuid NOT NULL REFERENCES public.locations(id),
  resulting_quantity numeric NOT NULL,
  message text NOT NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.purchase_receipts (
  id uuid PRIMARY KEY,
  supplier_name text NOT NULL,
  supplier_invoice_number text NOT NULL,
  invoice_date date NOT NULL,
  warehouse_location_id uuid NOT NULL REFERENCES public.locations(id),
  status text NOT NULL,
  attachment_path text,
  ocr_text text,
  reviewed_by uuid CONSTRAINT purchase_receipts_reviewed_by_app_fkey
    REFERENCES public.users(user_id),
  reviewed_at timestamptz,
  received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_name, supplier_invoice_number)
);

CREATE TABLE public.purchase_receipt_items (
  id uuid PRIMARY KEY,
  receipt_id uuid NOT NULL REFERENCES public.purchase_receipts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  quantity numeric(14,3) NOT NULL,
  unit_cost numeric(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE public.cashier_shortcuts (
  location_id uuid PRIMARY KEY REFERENCES public.locations(id) ON DELETE CASCADE,
  product_ids uuid[] NOT NULL DEFAULT '{}',
  updated_by uuid CONSTRAINT cashier_shortcuts_updated_by_app_fkey
    REFERENCES public.users(user_id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE public.invoice_number_seq;

CREATE INDEX users_email_lower_unique ON public.users (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX users_phone_unique ON public.users (phone) WHERE phone IS NOT NULL;
CREATE INDEX customers_mobile_idx ON public.customers (mobile);
CREATE INDEX invoices_location_created_idx ON public.invoices (location_id, created_at DESC);
CREATE INDEX invoices_customer_idx ON public.invoices (customer_id);
CREATE INDEX invoice_items_invoice_idx ON public.invoice_items (invoice_id);
CREATE INDEX invoice_items_product_idx ON public.invoice_items (product_id);
CREATE INDEX payments_invoice_idx ON public.payments (invoice_id);
CREATE INDEX stock_transfers_from_location_idx ON public.stock_transfers (from_location_id);
CREATE INDEX stock_transfers_to_location_idx ON public.stock_transfers (to_location_id);
CREATE INDEX stock_movements_product_idx ON public.stock_movements (product_id, created_at DESC);
CREATE INDEX stock_movements_location_idx ON public.stock_movements (location_id, created_at DESC);
CREATE INDEX cash_transactions_location_idx ON public.cash_transactions (location_id, created_at DESC);
CREATE INDEX offline_sync_user_created_idx ON public.offline_sync_operations (user_id, created_at DESC);
CREATE INDEX inventory_sync_alerts_location_idx ON public.inventory_sync_alerts (location_id, created_at DESC);
CREATE INDEX purchase_receipts_location_idx ON public.purchase_receipts (warehouse_location_id, created_at DESC);
CREATE INDEX purchase_receipt_items_receipt_idx ON public.purchase_receipt_items (receipt_id);

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_location_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfer_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_drawer_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offline_sync_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_sync_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashier_shortcuts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON
  public.locations, public.products, public.inventory, public.customers, public.users,
  public.staff_location_access, public.invoices, public.invoice_items, public.payments,
  public.stock_transfers, public.stock_transfer_items, public.cash_drawer_sessions,
  public.stock_adjustments, public.stock_movements, public.cash_transactions,
  public.offline_sync_operations, public.inventory_sync_alerts, public.purchase_receipts,
  public.purchase_receipt_items, public.cashier_shortcuts
FROM PUBLIC, anon, authenticated;
GRANT ALL ON
  public.locations, public.products, public.inventory, public.customers, public.users,
  public.staff_location_access, public.invoices, public.invoice_items, public.payments,
  public.stock_transfers, public.stock_transfer_items, public.cash_drawer_sessions,
  public.stock_adjustments, public.stock_movements, public.cash_transactions,
  public.offline_sync_operations, public.inventory_sync_alerts, public.purchase_receipts,
  public.purchase_receipt_items, public.cashier_shortcuts
TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.invoice_number_seq TO service_role;

INSERT INTO storage.buckets (id, name, public)
VALUES ('supplier-invoices', 'supplier-invoices', false)
ON CONFLICT (id) DO UPDATE SET public = false;

CREATE OR REPLACE FUNCTION public.current_staff_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT role
  FROM public.users
  WHERE user_id = auth.uid() AND is_active = true
$$;

CREATE OR REPLACE FUNCTION public.can_access_location(p_location_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users staff
    WHERE staff.user_id = auth.uid()
      AND staff.is_active = true
      AND (
        staff.role = 'ADMIN'
        OR EXISTS (
          SELECT 1 FROM public.staff_location_access access
          WHERE access.user_id = staff.user_id
            AND access.location_id = p_location_id
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_manage_retail_data()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT COALESCE(public.current_staff_role() IN ('MANAGER', 'ADMIN'), false)
$$;

CREATE OR REPLACE FUNCTION public.set_invoice_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.invoice_number IS NULL OR btrim(NEW.invoice_number) = '' THEN
    NEW.invoice_number := 'BILL-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' ||
      lpad(nextval('public.invoice_number_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER invoices_set_invoice_number
BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.set_invoice_number();

CREATE OR REPLACE FUNCTION public.log_inventory_movement()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_delta numeric;
  v_type text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_delta := NEW.quantity_on_hand;
  ELSE
    v_delta := NEW.quantity_on_hand - OLD.quantity_on_hand;
    IF NEW.product_id IS DISTINCT FROM OLD.product_id
      OR NEW.location_id IS DISTINCT FROM OLD.location_id THEN
      RETURN NEW;
    END IF;
  END IF;

  IF v_delta IS NULL OR v_delta = 0 THEN
    RETURN NEW;
  END IF;

  v_type := NULLIF(current_setting('app.movement_type', true), '');
  IF v_type IS NULL THEN
    v_type := CASE WHEN v_delta > 0 THEN 'OPENING' ELSE 'CORRECTION' END;
  END IF;

  INSERT INTO public.stock_movements
    (product_id, location_id, movement_type, quantity_delta, quantity_on_hand)
  VALUES (NEW.product_id, NEW.location_id, v_type, v_delta, NEW.quantity_on_hand);
  RETURN NEW;
END
$$;

CREATE TRIGGER inventory_log_movement
AFTER INSERT OR UPDATE OF quantity_on_hand ON public.inventory
FOR EACH ROW EXECUTE FUNCTION public.log_inventory_movement();

CREATE OR REPLACE FUNCTION public.set_product_price_tiers(
  p_product_id uuid,
  p_price_tiers jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_floor numeric;
  v_retail numeric;
BEGIN
  IF NOT public.can_manage_retail_data() THEN
    RAISE EXCEPTION 'Manager access is required';
  END IF;
  IF p_price_tiers IS NULL OR jsonb_typeof(p_price_tiers) <> 'array' THEN
    RAISE EXCEPTION 'Price tiers must be a JSON array';
  END IF;

  SELECT min_sale_price, sale_price INTO v_floor, v_retail
  FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_price_tiers) tier
    WHERE COALESCE((tier->>'min_quantity')::numeric, 0) <= 0
      OR COALESCE((tier->>'unit_price')::numeric, 0) < v_floor
      OR COALESCE((tier->>'unit_price')::numeric, 0) > v_retail
  ) THEN
    RAISE EXCEPTION 'Quantity prices must be positive and between floor and retail price';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT
        (tier->>'min_quantity')::numeric AS min_quantity,
        (tier->>'unit_price')::numeric AS unit_price,
        lag((tier->>'unit_price')::numeric)
          OVER (ORDER BY (tier->>'min_quantity')::numeric) AS previous_price
      FROM jsonb_array_elements(p_price_tiers) tier
    ) ordered_tiers
    WHERE previous_price IS NOT NULL AND unit_price > previous_price
  ) OR EXISTS (
    SELECT (tier->>'min_quantity')::numeric
    FROM jsonb_array_elements(p_price_tiers) tier
    GROUP BY (tier->>'min_quantity')::numeric
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Quantity tiers must use distinct quantities and lower prices at higher quantities';
  END IF;

  UPDATE public.products SET price_tiers = p_price_tiers WHERE id = p_product_id;
END
$$;

CREATE OR REPLACE FUNCTION public.resolve_inventory_sync_alert(p_alert_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_location_id uuid;
BEGIN
  IF NOT public.can_manage_retail_data() THEN
    RAISE EXCEPTION 'Manager access is required';
  END IF;
  SELECT location_id INTO v_location_id
  FROM public.inventory_sync_alerts WHERE id = p_alert_id;
  IF v_location_id IS NULL OR NOT public.can_access_location(v_location_id) THEN
    RAISE EXCEPTION 'Location access denied';
  END IF;
  UPDATE public.inventory_sync_alerts
  SET resolved_at = now()
  WHERE id = p_alert_id AND resolved_at IS NULL;
END
$$;

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
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE user_id = p_actor_user_id AND role = 'ADMIN' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Active Admin access is required';
  END IF;
  IF p_user_id IS NULL OR p_display_name IS NULL OR btrim(p_display_name) = '' THEN
    RAISE EXCEPTION 'A staff ID and display name are required';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('CASHIER', 'MANAGER', 'ADMIN') THEN
    RAISE EXCEPTION 'Unsupported staff role';
  END IF;
  IF p_user_id = p_actor_user_id AND p_role <> 'ADMIN' THEN
    RAISE EXCEPTION 'An Admin cannot remove their own Admin access';
  END IF;
  IF p_role <> 'ADMIN' AND COALESCE(cardinality(p_location_ids), 0) = 0 THEN
    RAISE EXCEPTION 'Assign at least one location to this staff member';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Supabase Auth user does not exist';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_location_ids, '{}'::uuid[])) requested(location_id)
    WHERE NOT EXISTS (SELECT 1 FROM public.locations WHERE id = requested.location_id)
  ) THEN
    RAISE EXCEPTION 'One or more assigned locations do not exist';
  END IF;

  INSERT INTO public.users
    (user_id, display_name, email, phone, role, is_active, must_change_password)
  VALUES
    (p_user_id, btrim(p_display_name), NULLIF(lower(btrim(p_email)), ''),
      NULLIF(btrim(p_phone), ''), p_role, p_is_active, p_must_change_password)
  ON CONFLICT (user_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    role = EXCLUDED.role,
    is_active = EXCLUDED.is_active,
    must_change_password = EXCLUDED.must_change_password,
    updated_at = now();

  DELETE FROM public.staff_location_access WHERE user_id = p_user_id;
  INSERT INTO public.staff_location_access (user_id, location_id)
  SELECT p_user_id, requested.location_id
  FROM unnest(COALESCE(p_location_ids, '{}'::uuid[])) requested(location_id)
  ON CONFLICT DO NOTHING;
END
$$;

CREATE OR REPLACE FUNCTION public.sync_offline_operation(
  p_operation_id uuid, p_device_id text, p_outlet_id uuid, p_operation_type text, p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
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
  IF auth.uid() IS NULL OR v_role IS NULL THEN
    RAISE EXCEPTION 'An active staff account is required';
  END IF;
  IF p_outlet_id IS NOT NULL AND NOT public.can_access_location(p_outlet_id) THEN
    RAISE EXCEPTION 'Location access denied';
  END IF;
  IF p_operation_type LIKE 'inventory.transfer.%' AND (
    NOT public.can_access_location((p_payload->'transfer'->>'from_location_id')::uuid)
    OR NOT public.can_access_location((p_payload->'transfer'->>'to_location_id')::uuid)
  ) THEN
    RAISE EXCEPTION 'Location access denied for both transfer endpoints';
  END IF;
  IF p_operation_type LIKE 'purchase.%' OR p_operation_type LIKE 'inventory.%'
    OR p_operation_type IN ('product.create', 'product.update', 'shortcut.update') THEN
    IF v_role NOT IN ('MANAGER', 'ADMIN')
      AND NOT (v_role = 'WAREHOUSE' AND p_operation_type LIKE 'inventory.%') THEN
      RAISE EXCEPTION 'Manager access is required for this operation';
    END IF;
  END IF;
  IF p_operation_type IN ('customer.update', 'customer.import')
    AND v_role NOT IN ('MANAGER', 'ADMIN') THEN
    RAISE EXCEPTION 'Manager access is required to update customer profiles';
  END IF;
  IF p_operation_type NOT IN (
    'invoice.draft.save', 'invoice.draft.void', 'invoice.finalize',
    'customer.create', 'customer.update', 'product.create', 'product.quick_add',
    'product.update', 'shortcut.update', 'inventory.transfer.create',
    'inventory.transfer.status', 'inventory.transfer.receive',
    'inventory.adjustment.create', 'cash.session.open', 'cash.session.close',
    'cash.transaction.create', 'payment.add', 'purchase.draft.save',
    'purchase.review', 'purchase.receive'
  ) THEN
    RAISE EXCEPTION 'Unsupported operation type';
  END IF;

  INSERT INTO public.offline_sync_operations
    (operation_id, user_id, device_id, outlet_id, operation_type, payload, created_at)
  VALUES
    (p_operation_id, auth.uid(), p_device_id, p_outlet_id, p_operation_type,
      COALESCE(p_payload, '{}'::jsonb), now())
  ON CONFLICT (operation_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN (
      SELECT jsonb_build_object(
        'accepted', true, 'duplicate', true,
        'review_needed', sync_status = 'REVIEW', 'message', sync_message
      )
      FROM public.offline_sync_operations WHERE operation_id = p_operation_id
    );
  END IF;

  BEGIN
    IF p_operation_type = 'invoice.draft.save' THEN
      v_record := p_payload->'invoice';
      INSERT INTO public.invoices (
        id, invoice_number, location_id, customer_id, total_amount, discount_amount,
        paid_amount, balance_amount, payment_status, business_date, cashier_id,
        cashier_name, invoice_status, draft_payload, created_at, updated_at
      )
      VALUES (
        (v_record->>'id')::uuid, v_record->>'invoice_number',
        (v_record->>'location_id')::uuid, NULLIF(v_record->>'customer_id', '')::uuid,
        COALESCE((v_record->>'total_amount')::numeric, 0),
        COALESCE((v_record->>'discount_amount')::numeric, 0),
        COALESCE((v_record->>'paid_amount')::numeric, 0),
        COALESCE((v_record->>'balance_amount')::numeric, 0),
        COALESCE(v_record->>'payment_status', 'UNPAID'),
        (v_record->>'business_date')::date,
        NULLIF(v_record->>'cashier_id', '')::uuid, v_record->>'cashier_name',
        'DRAFT', p_payload,
        COALESCE((v_record->>'created_at')::timestamptz, now()),
        COALESCE((v_record->>'updated_at')::timestamptz, now())
      )
      ON CONFLICT (id) DO UPDATE SET
        customer_id = EXCLUDED.customer_id,
        discount_amount = EXCLUDED.discount_amount,
        business_date = EXCLUDED.business_date,
        invoice_status = 'DRAFT',
        draft_payload = EXCLUDED.draft_payload,
        updated_at = EXCLUDED.updated_at
      WHERE public.invoices.invoice_status = 'DRAFT';
    ELSIF p_operation_type = 'invoice.draft.void' THEN
      UPDATE public.invoices
      SET invoice_status = 'VOID', draft_payload = NULL, updated_at = now()
      WHERE id = ((p_payload->'invoice')->>'id')::uuid
        AND invoice_status = 'DRAFT';
    ELSIF p_operation_type = 'invoice.finalize' THEN
      v_record := p_payload->'invoice';
      INSERT INTO public.invoices (
        id, invoice_number, location_id, customer_id, total_amount, discount_amount,
        paid_amount, balance_amount, payment_status, business_date, cashier_id,
        cashier_name, invoice_status, draft_payload, created_at, updated_at
      )
      VALUES (
        (v_record->>'id')::uuid, v_record->>'invoice_number',
        (v_record->>'location_id')::uuid, NULLIF(v_record->>'customer_id', '')::uuid,
        (v_record->>'total_amount')::numeric, (v_record->>'discount_amount')::numeric,
        (v_record->>'paid_amount')::numeric, (v_record->>'balance_amount')::numeric,
        v_record->>'payment_status', (v_record->>'business_date')::date,
        NULLIF(v_record->>'cashier_id', '')::uuid, v_record->>'cashier_name',
        'COMPLETED', NULL, (v_record->>'created_at')::timestamptz,
        COALESCE((v_record->>'updated_at')::timestamptz, now())
      )
      ON CONFLICT (id) DO UPDATE SET
        customer_id = EXCLUDED.customer_id,
        total_amount = EXCLUDED.total_amount,
        discount_amount = EXCLUDED.discount_amount,
        paid_amount = EXCLUDED.paid_amount,
        balance_amount = EXCLUDED.balance_amount,
        payment_status = EXCLUDED.payment_status,
        business_date = EXCLUDED.business_date,
        invoice_status = 'COMPLETED',
        draft_payload = NULL,
        updated_at = EXCLUDED.updated_at
      WHERE public.invoices.invoice_status = 'DRAFT';

      FOR v_record IN
        SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'items', '[]'::jsonb))
      LOOP
        INSERT INTO public.invoice_items
          (id, invoice_id, product_id, quantity, unit_price, uom, discount, total)
        VALUES (
          (v_record->>'id')::uuid, (v_record->>'invoice_id')::uuid,
          (v_record->>'product_id')::uuid, (v_record->>'quantity')::numeric,
          (v_record->>'unit_price')::numeric, COALESCE(v_record->>'uom', 'UNIT'),
          COALESCE((v_record->>'discount')::numeric, 0),
          (v_record->>'total')::numeric
        ) ON CONFLICT (id) DO NOTHING;
      END LOOP;

      FOR v_record IN
        SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'payments', '[]'::jsonb))
      LOOP
        INSERT INTO public.payments
          (id, invoice_id, customer_id, amount, mode, tendered, change_given, created_at)
        VALUES (
          (v_record->>'id')::uuid, (v_record->>'invoice_id')::uuid,
          NULLIF(v_record->>'customer_id', '')::uuid, (v_record->>'amount')::numeric,
          v_record->>'mode', NULLIF(v_record->>'tendered', '')::numeric,
          NULLIF(v_record->>'change_given', '')::numeric,
          (v_record->>'created_at')::timestamptz
        ) ON CONFLICT (id) DO NOTHING;
      END LOOP;

      v_credit := COALESCE((p_payload->'invoice'->>'balance_amount')::numeric, 0);
      IF NULLIF((p_payload->'invoice')->>'customer_id', '') IS NOT NULL THEN
        UPDATE public.customers
        SET outstanding_balance = outstanding_balance + v_credit,
            visits = visits + 1
        WHERE id = ((p_payload->'invoice')->>'customer_id')::uuid;
      END IF;
    ELSIF p_operation_type = 'customer.create' THEN
      v_record := p_payload->'customer';
      INSERT INTO public.customers
        (id, name, mobile, age_group, gender, credit_limit, outstanding_balance, visits)
      VALUES (
        (v_record->>'id')::uuid, v_record->>'name',
        NULLIF(v_record->>'mobile', ''), v_record->>'age_group', v_record->>'gender',
        COALESCE((v_record->>'credit_limit')::numeric, 0),
        COALESCE((v_record->>'outstanding_balance')::numeric, 0), 0
      ) ON CONFLICT (id) DO NOTHING;
    ELSIF p_operation_type IN ('product.create', 'product.quick_add') THEN
      v_record := p_payload->'product';
      INSERT INTO public.products (
        id, name, name_hi, search_aliases, sku, barcode, category, variant,
        rack_location, purchase_cost, mrp, sale_price, min_sale_price, min_stock,
        uom_purchase, uom_stock, uom_sale, conversion_factor, enrichment_status
      )
      VALUES (
        (v_record->>'id')::uuid, v_record->>'name', v_record->>'name_hi',
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_record->'search_aliases', '[]'::jsonb))),
        v_record->>'sku', NULLIF(v_record->>'barcode', ''), v_record->>'category',
        v_record->>'variant', v_record->>'rack_location',
        COALESCE((v_record->>'purchase_cost')::numeric, 0),
        COALESCE((v_record->>'mrp')::numeric, 0),
        COALESCE((v_record->>'sale_price')::numeric, 0),
        COALESCE((v_record->>'min_sale_price')::numeric, 0),
        COALESCE((v_record->>'min_stock')::numeric, 0),
        COALESCE(v_record->>'uom_purchase', 'UNIT'),
        COALESCE(v_record->>'uom_stock', 'UNIT'),
        COALESCE(v_record->>'uom_sale', 'UNIT'), 1, 'PENDING'
      ) ON CONFLICT (id) DO NOTHING;
    ELSIF p_operation_type = 'product.update' THEN
      v_record := p_payload->'product';
      UPDATE public.products SET
        name = v_record->>'name',
        name_hi = v_record->>'name_hi',
        search_aliases = ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_record->'search_aliases', '[]'::jsonb))),
        sku = v_record->>'sku',
        barcode = NULLIF(v_record->>'barcode', ''),
        hsn = NULLIF(v_record->>'hsn', ''),
        category = v_record->>'category',
        variant = v_record->>'variant',
        rack_location = v_record->>'rack_location',
        purchase_cost = (v_record->>'purchase_cost')::numeric,
        mrp = (v_record->>'mrp')::numeric,
        sale_price = (v_record->>'sale_price')::numeric,
        min_sale_price = (v_record->>'min_sale_price')::numeric,
        min_stock = (v_record->>'min_stock')::numeric,
        enrichment_status = v_record->>'enrichment_status'
      WHERE id = (v_record->>'id')::uuid;
    ELSIF p_operation_type = 'customer.update' THEN
      v_record := p_payload->'customer';
      UPDATE public.customers SET
        name = v_record->>'name',
        mobile = NULLIF(v_record->>'mobile', ''),
        age_group = v_record->>'age_group',
        gender = v_record->>'gender',
        credit_limit = COALESCE((v_record->>'credit_limit')::numeric, 0)
      WHERE id = (v_record->>'id')::uuid;
    ELSIF p_operation_type = 'shortcut.update' THEN
      v_record := p_payload->'shortcut';
      INSERT INTO public.cashier_shortcuts (location_id, product_ids, updated_by, updated_at)
      VALUES (
        (v_record->>'location_id')::uuid,
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_record->'product_ids', '[]'::jsonb)))::uuid[],
        auth.uid(), now()
      )
      ON CONFLICT (location_id) DO UPDATE
      SET product_ids = EXCLUDED.product_ids,
          updated_by = auth.uid(),
          updated_at = now();
    ELSIF p_operation_type LIKE 'inventory.transfer.%' THEN
      v_record := p_payload->'transfer';
      INSERT INTO public.stock_transfers
        (id, from_location_id, to_location_id, status, notes, created_at)
      VALUES (
        (v_record->>'id')::uuid, (v_record->>'from_location_id')::uuid,
        (v_record->>'to_location_id')::uuid, v_record->>'status',
        v_record->>'notes', COALESCE((v_record->>'created_at')::timestamptz, now())
      )
      ON CONFLICT (id) DO UPDATE
      SET status = EXCLUDED.status, notes = EXCLUDED.notes;

      IF jsonb_typeof(p_payload->'items') = 'array' THEN
        DELETE FROM public.stock_transfer_items
        WHERE transfer_id = (v_record->>'id')::uuid;
        FOR v_record IN SELECT value FROM jsonb_array_elements(p_payload->'items')
        LOOP
          INSERT INTO public.stock_transfer_items
            (id, transfer_id, product_id, quantity)
          VALUES (
            COALESCE(NULLIF(v_record->>'id', '')::uuid, gen_random_uuid()),
            (v_record->>'transfer_id')::uuid,
            (v_record->>'product_id')::uuid,
            (v_record->>'quantity')::numeric
          );
        END LOOP;
      END IF;
    ELSIF p_operation_type = 'inventory.adjustment.create' THEN
      v_record := p_payload->'adjustment';
      INSERT INTO public.stock_adjustments (
        id, product_id, location_id, quantity, reason,
        returnable_to_vendor, cost_loss, created_at
      )
      VALUES (
        (v_record->>'id')::uuid, (v_record->>'product_id')::uuid,
        (v_record->>'location_id')::uuid, (v_record->>'quantity')::numeric,
        v_record->>'reason', COALESCE((v_record->>'returnable_to_vendor')::boolean, false),
        COALESCE((v_record->>'cost_loss')::numeric, 0),
        (v_record->>'created_at')::timestamptz
      ) ON CONFLICT (id) DO NOTHING;
    ELSIF p_operation_type = 'cash.session.open' THEN
      v_record := p_payload->'session';
      INSERT INTO public.cash_drawer_sessions (
        id, location_id, opened_by, opening_cash, status, opened_at, opening_denominations
      )
      VALUES (
        (v_record->>'id')::uuid, (v_record->>'location_id')::uuid,
        v_record->>'opened_by', (v_record->>'opening_cash')::numeric,
        'OPEN', (v_record->>'opened_at')::timestamptz,
        v_record->'opening_denominations'
      ) ON CONFLICT (id) DO NOTHING;
    ELSIF p_operation_type = 'cash.session.close' THEN
      v_record := p_payload->'session';
      UPDATE public.cash_drawer_sessions SET
        status = 'CLOSED',
        cash_sales = (v_record->>'cash_sales')::numeric,
        cash_in = (v_record->>'cash_in')::numeric,
        cash_out = (v_record->>'cash_out')::numeric,
        closing_cash = (v_record->>'closing_cash')::numeric,
        closed_at = (v_record->>'closed_at')::timestamptz,
        closing_denominations = v_record->'closing_denominations'
      WHERE id = (v_record->>'id')::uuid;
    ELSIF p_operation_type = 'cash.transaction.create' THEN
      v_record := p_payload->'transaction';
      INSERT INTO public.cash_transactions
        (id, session_id, location_id, direction, amount, reason, created_at)
      VALUES (
        (v_record->>'id')::uuid, NULLIF(v_record->>'session_id', '')::uuid,
        (v_record->>'location_id')::uuid, v_record->>'direction',
        (v_record->>'amount')::numeric, v_record->>'reason',
        (v_record->>'created_at')::timestamptz
      ) ON CONFLICT (id) DO NOTHING;
      v_record := p_payload->'session';
      IF jsonb_typeof(v_record) = 'object' THEN
        UPDATE public.cash_drawer_sessions SET
          cash_in = (v_record->>'cash_in')::numeric,
          cash_out = (v_record->>'cash_out')::numeric
        WHERE id = (v_record->>'id')::uuid;
      END IF;
    ELSIF p_operation_type = 'payment.add' THEN
      v_record := p_payload->'payment';
      INSERT INTO public.payments
        (id, invoice_id, customer_id, amount, mode, tendered, change_given, created_at)
      VALUES (
        (v_record->>'id')::uuid, (v_record->>'invoice_id')::uuid,
        NULLIF(v_record->>'customer_id', '')::uuid, (v_record->>'amount')::numeric,
        v_record->>'mode', (v_record->>'tendered')::numeric,
        (v_record->>'change_given')::numeric, (v_record->>'created_at')::timestamptz
      ) ON CONFLICT (id) DO NOTHING;
      v_record := p_payload->'invoice';
      UPDATE public.invoices SET
        paid_amount = (v_record->>'paid_amount')::numeric,
        balance_amount = (v_record->>'balance_amount')::numeric,
        payment_status = v_record->>'payment_status'
      WHERE id = (v_record->>'id')::uuid;
      IF NULLIF(v_record->>'customer_id', '') IS NOT NULL THEN
        UPDATE public.customers
        SET outstanding_balance = GREATEST(
          outstanding_balance - (p_payload->'payment'->>'amount')::numeric, 0
        )
        WHERE id = (v_record->>'customer_id')::uuid;
      END IF;
    ELSIF p_operation_type LIKE 'purchase.%' THEN
      v_record := p_payload->'receipt';
      INSERT INTO public.purchase_receipts (
        id, supplier_name, supplier_invoice_number, invoice_date,
        warehouse_location_id, status, attachment_path, ocr_text,
        reviewed_by, reviewed_at, received_at, created_at
      )
      VALUES (
        (v_record->>'id')::uuid, v_record->>'supplier_name',
        v_record->>'supplier_invoice_number', (v_record->>'invoice_date')::date,
        (v_record->>'warehouse_location_id')::uuid, v_record->>'status',
        v_record->>'attachment_path', v_record->>'ocr_text',
        CASE WHEN v_record->>'status' IN ('REVIEWED', 'RECEIVED') THEN auth.uid() ELSE NULL END,
        NULLIF(v_record->>'reviewed_at', '')::timestamptz,
        NULLIF(v_record->>'received_at', '')::timestamptz,
        COALESCE((v_record->>'created_at')::timestamptz, now())
      )
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        attachment_path = COALESCE(EXCLUDED.attachment_path, public.purchase_receipts.attachment_path),
        ocr_text = EXCLUDED.ocr_text,
        reviewed_at = COALESCE(EXCLUDED.reviewed_at, public.purchase_receipts.reviewed_at),
        received_at = COALESCE(EXCLUDED.received_at, public.purchase_receipts.received_at),
        reviewed_by = COALESCE(EXCLUDED.reviewed_by, public.purchase_receipts.reviewed_by);

      DELETE FROM public.purchase_receipt_items
      WHERE receipt_id = (v_record->>'id')::uuid;
      FOR v_record IN
        SELECT value
        FROM jsonb_array_elements(COALESCE(p_payload->'receipt'->'items', '[]'::jsonb))
      LOOP
        IF NULLIF(v_record->>'product_id', '') IS NOT NULL THEN
          INSERT INTO public.purchase_receipt_items
            (id, receipt_id, product_id, quantity, unit_cost)
          VALUES (
            COALESCE(NULLIF(v_record->>'id', '')::uuid, gen_random_uuid()),
            (p_payload->'receipt'->>'id')::uuid,
            (v_record->>'product_id')::uuid,
            (v_record->>'quantity')::numeric,
            COALESCE((v_record->>'unit_cost')::numeric, 0)
          );
        END IF;
      END LOOP;
    END IF;

    FOR v_stock IN
      SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'stock_movements', '[]'::jsonb))
      UNION ALL
      SELECT p_payload->'stock_movement'
      WHERE jsonb_typeof(p_payload->'stock_movement') = 'object'
    LOOP
      PERFORM set_config(
        'app.movement_type', COALESCE(v_stock->>'movement_type', 'STOCK CHANGE'), true
      );
      INSERT INTO public.inventory (product_id, location_id, quantity_on_hand)
      VALUES (
        (v_stock->>'product_id')::uuid,
        (v_stock->>'location_id')::uuid,
        (v_stock->>'quantity_delta')::numeric
      )
      ON CONFLICT (product_id, location_id) DO UPDATE
      SET quantity_on_hand = public.inventory.quantity_on_hand +
        (v_stock->>'quantity_delta')::numeric
      RETURNING id, quantity_on_hand INTO v_inventory_id, v_qty;

      IF v_qty < 0 THEN
        INSERT INTO public.inventory_sync_alerts
          (operation_id, product_id, location_id, resulting_quantity, message)
        VALUES (
          p_operation_id, (v_stock->>'product_id')::uuid,
          (v_stock->>'location_id')::uuid, v_qty,
          'Offline sales exceeded the stock snapshot available on this device. Review transfers/stock count.'
        );
      END IF;
    END LOOP;
  EXCEPTION
    WHEN unique_violation OR foreign_key_violation OR invalid_text_representation
      OR check_violation OR not_null_violation OR numeric_value_out_of_range THEN
      v_review := true;
      v_message := 'Operation saved locally but needs manager review before server records could be reconciled.';
  END;

  UPDATE public.offline_sync_operations
  SET sync_status = CASE WHEN v_review THEN 'REVIEW' ELSE 'SYNCED' END,
      sync_message = v_message
  WHERE operation_id = p_operation_id;

  RETURN jsonb_build_object(
    'accepted', true, 'duplicate', false,
    'review_needed', v_review, 'message', v_message
  );
END
$$;

CREATE OR REPLACE FUNCTION public.app_sync_offline_operation_as_staff(
  p_actor_user_id uuid,
  p_operation_id uuid,
  p_device_id text,
  p_outlet_id uuid,
  p_operation_type text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE user_id = p_actor_user_id
      AND is_active = true
      AND role IN ('CASHIER', 'MANAGER', 'ADMIN')
  ) THEN
    RAISE EXCEPTION 'An active staff account is required';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', p_actor_user_id::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_actor_user_id::text, 'role', 'authenticated')::text,
    true
  );
  RETURN public.sync_offline_operation(
    p_operation_id, p_device_id, p_outlet_id, p_operation_type, p_payload
  );
END
$$;

CREATE OR REPLACE FUNCTION public.app_set_product_price_tiers(
  p_actor_user_id uuid,
  p_product_id uuid,
  p_price_tiers jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE user_id = p_actor_user_id
      AND role IN ('MANAGER', 'ADMIN')
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Manager access is required';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', p_actor_user_id::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_actor_user_id::text, 'role', 'authenticated')::text,
    true
  );
  PERFORM public.set_product_price_tiers(p_product_id, p_price_tiers);
END
$$;

CREATE OR REPLACE FUNCTION public.app_resolve_inventory_sync_alert(
  p_actor_user_id uuid,
  p_alert_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE user_id = p_actor_user_id
      AND role IN ('MANAGER', 'ADMIN')
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Manager access is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.inventory_sync_alerts alert
    JOIN public.staff_location_access access
      ON access.location_id = alert.location_id
    WHERE alert.id = p_alert_id AND access.user_id = p_actor_user_id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE user_id = p_actor_user_id AND role = 'ADMIN' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Location access denied for this inventory alert';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', p_actor_user_id::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_actor_user_id::text, 'role', 'authenticated')::text,
    true
  );
  PERFORM public.resolve_inventory_sync_alert(p_alert_id);
END
$$;

REVOKE ALL ON FUNCTION public.app_save_staff_profile(uuid, uuid, text, text, text, text, uuid[], boolean, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_sync_offline_operation_as_staff(uuid, uuid, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_set_product_price_tiers(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_resolve_inventory_sync_alert(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_offline_operation(uuid, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_product_price_tiers(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_inventory_sync_alert(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.current_staff_role() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_access_location(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_manage_retail_data() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_save_staff_profile(uuid, uuid, text, text, text, text, uuid[], boolean, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_sync_offline_operation_as_staff(uuid, uuid, text, uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_set_product_price_tiers(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_resolve_inventory_sync_alert(uuid, uuid) TO service_role;


-- Manager-scoped Cashier provisioning (20261109000000).
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
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_actor_role text;
  v_existing_role text;
BEGIN
  SELECT role INTO v_actor_role
  FROM public.users
  WHERE user_id = p_actor_user_id AND is_active = true;

  IF v_actor_role IS NULL OR v_actor_role NOT IN ('ADMIN', 'MANAGER') THEN
    RAISE EXCEPTION 'Active Admin or Manager access is required';
  END IF;
  IF p_user_id IS NULL OR p_display_name IS NULL OR btrim(p_display_name) = '' THEN
    RAISE EXCEPTION 'A staff ID and display name are required';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('CASHIER', 'MANAGER', 'ADMIN') THEN
    RAISE EXCEPTION 'Unsupported staff role';
  END IF;
  IF p_user_id = p_actor_user_id AND p_role <> v_actor_role THEN
    RAISE EXCEPTION 'You cannot change your own staff role';
  END IF;
  IF p_role <> 'ADMIN' AND p_is_active
     AND COALESCE(cardinality(p_location_ids), 0) = 0 THEN
    RAISE EXCEPTION 'Assign at least one location to an active staff member';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Supabase Auth user does not exist';
  END IF;

  IF v_actor_role = 'MANAGER' THEN
    IF p_role <> 'CASHIER' THEN
      RAISE EXCEPTION 'Managers may only manage Cashier accounts';
    END IF;
    SELECT role INTO v_existing_role
    FROM public.users
    WHERE user_id = p_user_id;
    IF v_existing_role IS NOT NULL AND v_existing_role <> 'CASHIER' THEN
      RAISE EXCEPTION 'Managers may only manage existing Cashier accounts';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM unnest(COALESCE(p_location_ids, '{}'::uuid[])) requested(location_id)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.staff_location_access own_access
        WHERE own_access.user_id = p_actor_user_id
          AND own_access.location_id = requested.location_id
      )
    ) THEN
      RAISE EXCEPTION 'Managers may assign Cashiers only to their assigned locations';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.staff_location_access existing_access
      WHERE existing_access.user_id = p_user_id
        AND NOT EXISTS (
          SELECT 1 FROM public.staff_location_access own_access
          WHERE own_access.user_id = p_actor_user_id
            AND own_access.location_id = existing_access.location_id
        )
    ) THEN
      RAISE EXCEPTION 'This Cashier also serves locations outside your access; ask an Admin to update this account';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_location_ids, '{}'::uuid[])) requested(location_id)
    WHERE NOT EXISTS (SELECT 1 FROM public.locations WHERE id = requested.location_id)
  ) THEN
    RAISE EXCEPTION 'One or more assigned locations do not exist';
  END IF;
  IF p_is_active AND p_role <> 'ADMIN' AND EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_location_ids, '{}'::uuid[])) requested(location_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.locations
      WHERE id = requested.location_id AND is_active = true
    )
  ) THEN
    RAISE EXCEPTION 'Active staff must be assigned only to active locations';
  END IF;

  INSERT INTO public.users
    (user_id, display_name, email, phone, role, is_active, must_change_password)
  VALUES
    (p_user_id, btrim(p_display_name), NULLIF(lower(btrim(p_email)), ''),
      NULLIF(btrim(p_phone), ''), p_role, p_is_active, p_must_change_password)
  ON CONFLICT (user_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    role = EXCLUDED.role,
    is_active = EXCLUDED.is_active,
    must_change_password = EXCLUDED.must_change_password,
    updated_at = now();

  DELETE FROM public.staff_location_access WHERE user_id = p_user_id;
  INSERT INTO public.staff_location_access (user_id, location_id)
  SELECT p_user_id, requested.location_id
  FROM unnest(COALESCE(p_location_ids, '{}'::uuid[])) requested(location_id)
  ON CONFLICT DO NOTHING;
END
$$;

REVOKE ALL ON FUNCTION public.app_save_staff_profile(uuid, uuid, text, text, text, text, uuid[], boolean, boolean)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_save_staff_profile(uuid, uuid, text, text, text, text, uuid[], boolean, boolean)
TO service_role;

-- POS stabilization (20261111000000).
-- Forward-only DailyPlazaa stabilization. Published migrations remain unchanged.

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

-- POS runtime completion (20261111120000).
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

-- Default Warehouse (20261112100000).
ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS is_default_warehouse boolean NOT NULL DEFAULT false;

ALTER TABLE public.locations
  DROP CONSTRAINT IF EXISTS locations_default_warehouse_type_check;
ALTER TABLE public.locations
  ADD CONSTRAINT locations_default_warehouse_type_check
  CHECK (NOT is_default_warehouse OR (type = 'WAREHOUSE' AND is_active));

CREATE UNIQUE INDEX IF NOT EXISTS locations_single_default_warehouse_idx
  ON public.locations (is_default_warehouse)
  WHERE is_default_warehouse;

CREATE OR REPLACE FUNCTION public.app_set_default_warehouse(
  p_actor_user_id uuid,
  p_location_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE user_id = p_actor_user_id AND role = 'ADMIN' AND is_active
  ) THEN
    RAISE EXCEPTION 'Only an active Admin may designate the default Warehouse';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('retailflow.default_warehouse')::bigint);
  IF NOT EXISTS (
    SELECT 1 FROM public.locations
    WHERE id = p_location_id AND type = 'WAREHOUSE' AND is_active
  ) THEN
    RAISE EXCEPTION 'Choose an active Warehouse location';
  END IF;
  UPDATE public.locations SET is_default_warehouse = false WHERE is_default_warehouse;
  UPDATE public.locations SET is_default_warehouse = true WHERE id = p_location_id;
END
$$;

REVOKE ALL ON FUNCTION public.app_set_default_warehouse(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_set_default_warehouse(uuid, uuid)
  TO service_role;

-- Catalog and purchase readiness (20261112220000).
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS brand text;

ALTER TABLE public.purchase_receipt_items
  ADD COLUMN IF NOT EXISTS manufactured_on date,
  ADD COLUMN IF NOT EXISTS expires_on date;

DO $migration$
DECLARE
  v_function regprocedure;
  v_definition text;
  v_updated text;
BEGIN
  v_function := to_regprocedure(
    'public.app_sync_offline_operation_as_staff(uuid,uuid,text,uuid,text,jsonb)'
  );
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'Offline staff sync function is missing';
  END IF;
  v_definition := pg_get_functiondef(v_function);
  v_updated := replace(
    v_definition,
    'ON CONFLICT (code) DO NOTHING;',
    'ON CONFLICT DO NOTHING;'
  );
  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'Could not remove the restrictive barcode candidate conflict target';
  END IF;
  v_definition := v_updated;
  v_updated := replace(
    v_definition,
    'WHERE target.id = (source->>''id'')::uuid AND source ? ''source_total'';',
    'WHERE target.id = (source->>''id'')::uuid AND source ? ''source_total'';
        UPDATE public.purchase_receipt_items target
        SET manufactured_on = NULLIF(source->>''manufactured_on'', '''')::date,
            expires_on = NULLIF(source->>''expires_on'', '''')::date
        FROM jsonb_array_elements(COALESCE(v_record->''items'', ''[]''::jsonb)) source
        WHERE target.id = (source->>''id'')::uuid
          AND (source ? ''manufactured_on'' OR source ? ''expires_on'');'
  );
  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'Could not extend the offline sync function with lot dates';
  END IF;
  EXECUTE v_updated;
END
$migration$;

ALTER TABLE public.barcode_candidates
  DROP CONSTRAINT IF EXISTS barcode_candidates_code_key;

DO $migration$
DECLARE
  v_function regprocedure;
  v_definition text;
  v_updated text;
BEGIN
  v_function := to_regprocedure(
    'public.app_assign_product_barcode(uuid,uuid,uuid,text,text)'
  );
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'Product barcode assignment function is missing';
  END IF;
  v_definition := pg_get_functiondef(v_function);
  v_updated := replace(
    v_definition,
    '  IF EXISTS (SELECT 1 FROM public.products WHERE lower(barcode) = lower(btrim(p_code)) AND id <> p_product_id) THEN
    RAISE EXCEPTION ''This barcode is already assigned to another SKU'';
  END IF;
',
    ''
  );
  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'Could not remove the restrictive barcode assignment check';
  END IF;
  EXECUTE v_updated;
END
$migration$;

DO $migration$
DECLARE
  v_function regprocedure;
  v_definition text;
  v_updated text;
BEGIN
  v_function := to_regprocedure(
    'public.sync_offline_operation(uuid,text,uuid,text,jsonb)'
  );
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'Offline sync function is missing';
  END IF;
  v_definition := pg_get_functiondef(v_function);
  v_updated := replace(
    v_definition,
    '        hsn = NULLIF(v_record->>''hsn'', ''''),
        category = v_record->>''category'',',
    '        hsn = NULLIF(v_record->>''hsn'', ''''),
        brand = NULLIF(v_record->>''brand'', ''''),
        category = v_record->>''category'','
  );
  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'Could not extend the product update sync function with brand';
  END IF;
  EXECUTE v_updated;
END
$migration$;

-- Cash denomination settings (20261113120000).
CREATE TABLE public.cash_denomination_settings (
  setting_key text PRIMARY KEY CHECK (setting_key = 'global'),
  enabled_denominations integer[] NOT NULL
    DEFAULT ARRAY[500, 200, 100, 50, 20, 10, 5]::integer[],
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(user_id) ON DELETE SET NULL,
  CONSTRAINT cash_denomination_settings_nonempty
    CHECK (cardinality(enabled_denominations) > 0),
  CONSTRAINT cash_denomination_settings_supported_values
    CHECK (enabled_denominations <@ ARRAY[500, 200, 100, 50, 20, 10, 5, 2, 1]::integer[])
);

INSERT INTO public.cash_denomination_settings (setting_key)
VALUES ('global')
ON CONFLICT (setting_key) DO NOTHING;

ALTER TABLE public.cash_denomination_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cash_denomination_settings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.cash_denomination_settings TO service_role;

-- Server-backed offline PIN verifiers (20261113130000).
CREATE TABLE public.staff_offline_pin_verifiers (
  user_id uuid PRIMARY KEY REFERENCES public.users(user_id) ON DELETE CASCADE,
  salt text NOT NULL CHECK (salt ~ '^[a-f0-9]{32}$'),
  verifier text NOT NULL CHECK (verifier ~ '^[a-f0-9]{64}$'),
  iterations integer NOT NULL CHECK (iterations = 310000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.staff_offline_pin_verifiers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_offline_pin_verifiers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_offline_pin_verifiers TO service_role;

COMMIT;
