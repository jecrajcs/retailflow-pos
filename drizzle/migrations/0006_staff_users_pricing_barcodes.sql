-- Business-facing staff identity is kept in public.users. Supabase Auth remains
-- the credential/session provider; the browser never receives a service key.
DO $$
BEGIN
  IF to_regclass('public.users') IS NULL AND to_regclass('public.staff_profiles') IS NOT NULL THEN
    ALTER TABLE public.staff_profiles RENAME TO users;
  END IF;
END $$;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON public.users (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique ON public.users (phone) WHERE phone IS NOT NULL;
UPDATE public.users profile SET email = NULLIF(auth_user.email, ''), phone = NULLIF(auth_user.phone, '')
FROM auth.users auth_user WHERE auth_user.id = profile.user_id
  AND (profile.email IS NULL OR profile.phone IS NULL);

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS price_tiers jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_price_tiers_array_check;
ALTER TABLE public.products ADD CONSTRAINT products_price_tiers_array_check
  CHECK (jsonb_typeof(price_tiers) = 'array');

CREATE OR REPLACE FUNCTION public.current_staff_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.users WHERE user_id = auth.uid() AND is_active = true
$$;

CREATE OR REPLACE FUNCTION public.can_access_location(p_location_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(public.current_staff_role() = 'ADMIN', false)
    OR EXISTS (
      SELECT 1 FROM public.staff_location_access access
      JOIN public.users profile ON profile.user_id = access.user_id
      WHERE access.user_id = auth.uid() AND access.location_id = p_location_id AND profile.is_active = true
    )
$$;
REVOKE ALL ON FUNCTION public.current_staff_role(), public.can_access_location(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_staff_role(), public.can_access_location(uuid) TO authenticated;

-- Role/profile updates stay server-mediated by the RetailFlow API.
REVOKE INSERT, UPDATE, DELETE ON public.users, public.staff_location_access FROM authenticated;
GRANT SELECT ON public.users, public.staff_location_access TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_staff_access(
  p_user_id uuid, p_display_name text, p_role text, p_location_ids uuid[], p_is_active boolean DEFAULT true
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.current_staff_role() <> 'ADMIN' THEN RAISE EXCEPTION 'Admin access is required'; END IF;
  IF p_role IS NULL OR p_role NOT IN ('CASHIER', 'MANAGER', 'ADMIN') THEN RAISE EXCEPTION 'Invalid staff role'; END IF;
  IF p_user_id = auth.uid() AND p_role <> 'ADMIN' THEN RAISE EXCEPTION 'An Admin cannot remove their own Admin access'; END IF;
  IF p_role <> 'ADMIN' AND COALESCE(cardinality(p_location_ids), 0) = 0 THEN
    RAISE EXCEPTION 'Assign at least one location to this staff member';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_location_ids, '{}'::uuid[])) AS requested(id)
    LEFT JOIN public.locations location ON location.id = requested.id WHERE location.id IS NULL
  ) THEN RAISE EXCEPTION 'One or more assigned locations do not exist'; END IF;
  UPDATE public.users SET display_name = p_display_name, role = p_role,
    is_active = COALESCE(p_is_active, true), updated_at = now()
  WHERE user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Staff user not found'; END IF;
  DELETE FROM public.staff_location_access WHERE user_id = p_user_id;
  INSERT INTO public.staff_location_access (user_id, location_id)
  SELECT p_user_id, assigned.location_id FROM unnest(COALESCE(p_location_ids, '{}'::uuid[])) AS assigned(location_id);
END $$;
REVOKE ALL ON FUNCTION public.admin_set_staff_access(uuid, text, text, uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_staff_access(uuid, text, text, uuid[], boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_first_login_password_change()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in is required'; END IF;
  UPDATE public.users SET must_change_password = false, updated_at = now()
  WHERE user_id = auth.uid() AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active staff profile not found'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.complete_first_login_password_change() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_first_login_password_change() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_product_price_tiers(p_product_id uuid, p_price_tiers jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_floor numeric;
  v_retail numeric;
BEGIN
  IF NOT public.can_manage_retail_data() THEN RAISE EXCEPTION 'Manager access is required'; END IF;
  IF p_price_tiers IS NULL OR jsonb_typeof(p_price_tiers) <> 'array' THEN
    RAISE EXCEPTION 'Price tiers must be a JSON array';
  END IF;
  SELECT min_sale_price, sale_price INTO v_floor, v_retail FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_price_tiers) tier
    WHERE COALESCE((tier->>'min_quantity')::numeric, 0) <= 0
      OR COALESCE((tier->>'unit_price')::numeric, 0) < v_floor
      OR COALESCE((tier->>'unit_price')::numeric, 0) > v_retail
  ) THEN RAISE EXCEPTION 'Quantity prices must be positive and between floor and retail price'; END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT (tier->>'min_quantity')::numeric AS min_quantity, (tier->>'unit_price')::numeric AS unit_price,
        lag((tier->>'unit_price')::numeric) OVER (ORDER BY (tier->>'min_quantity')::numeric) AS previous_price
      FROM jsonb_array_elements(p_price_tiers) tier
    ) ordered_tiers
    WHERE previous_price IS NOT NULL AND unit_price > previous_price
  ) OR EXISTS (
    SELECT (tier->>'min_quantity')::numeric FROM jsonb_array_elements(p_price_tiers) tier
    GROUP BY (tier->>'min_quantity')::numeric HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'Quantity tiers must use distinct quantities and lower prices at higher quantities'; END IF;
  UPDATE public.products SET price_tiers = p_price_tiers WHERE id = p_product_id;
END $$;
REVOKE ALL ON FUNCTION public.set_product_price_tiers(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_product_price_tiers(uuid, jsonb) TO authenticated;
