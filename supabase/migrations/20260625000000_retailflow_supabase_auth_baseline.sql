-- Destructive baseline reset. This drops only app-owned public objects
-- from the previous SQL migrations; Supabase-managed auth.*, storage, and
-- system schemas are preserved.
BEGIN;

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
    IF v_role NOT IN ('MANAGER', 'ADMIN') THEN
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

COMMIT;
