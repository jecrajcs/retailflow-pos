-- RetailFlow staff credentials and sessions are managed by the app, not Supabase Auth.
-- The existing users.user_id values are preserved so audit/history rows keep their identity.

CREATE TABLE IF NOT EXISTS public.auth_users (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expires_at timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  user_id uuid NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx ON public.auth_sessions(user_id);

CREATE TABLE IF NOT EXISTS public.auth_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, account_id)
);
CREATE INDEX IF NOT EXISTS auth_accounts_user_id_idx ON public.auth_accounts(user_id);

CREATE TABLE IF NOT EXISTS public.auth_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_verifications_identifier_idx ON public.auth_verifications(identifier);

CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
  key text PRIMARY KEY,
  count integer NOT NULL DEFAULT 0,
  last_request bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.auth_login_identifiers (
  normalized_identifier text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('email', 'phone')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind)
);
CREATE INDEX IF NOT EXISTS auth_login_identifiers_user_id_idx
  ON public.auth_login_identifiers(user_id);

CREATE TABLE IF NOT EXISTS public.auth_bootstrap_tokens (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  consumed_at timestamptz,
  consumed_by uuid REFERENCES public.users(user_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (
    WITH identifiers AS (
      SELECT 'email:' || lower(btrim(email)) AS identifier, user_id
      FROM public.users
      WHERE NULLIF(btrim(email), '') IS NOT NULL
      UNION ALL
      SELECT 'phone:+' || CASE
        WHEN digits ~ '^91[0-9]{10}$' THEN digits
        WHEN digits ~ '^[0-9]{10}$' THEN '91' || digits
        WHEN digits ~ '^[1-9][0-9]{7,14}$' THEN digits
        ELSE NULL
      END AS identifier,
      user_id
      FROM (
        SELECT user_id, regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') AS digits
        FROM public.users
      ) source
    )
    SELECT 1
    FROM identifiers
    WHERE identifier IS NOT NULL
    GROUP BY identifier
    HAVING count(DISTINCT user_id) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate staff login identifiers exist; resolve them before applying this migration';
  END IF;
END $$;

ALTER TABLE public.auth_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_login_identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_bootstrap_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_users, public.auth_sessions, public.auth_accounts,
  public.auth_verifications, public.auth_rate_limits, public.auth_login_identifiers,
  public.auth_bootstrap_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.auth_users, public.auth_sessions, public.auth_accounts,
  public.auth_verifications, public.auth_rate_limits, public.auth_login_identifiers,
  public.auth_bootstrap_tokens TO service_role;

-- Existing staff IDs are retained, but their credential rows must be reset because
-- Supabase Auth password hashes cannot be read or reused by the app.
INSERT INTO public.auth_users (id, name, email, email_verified, created_at, updated_at)
SELECT user_id, COALESCE(NULLIF(display_name, ''), 'Staff'),
  'staff-' || replace(user_id::text, '-', '') || '@accounts.retailflow.invalid',
  false, COALESCE(created_at, now()), COALESCE(updated_at, now())
FROM public.users
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.auth_login_identifiers (normalized_identifier, user_id, kind)
SELECT 'email:' || lower(btrim(email)), user_id, 'email'
FROM public.users
WHERE NULLIF(btrim(email), '') IS NOT NULL
ON CONFLICT (normalized_identifier) DO NOTHING;

INSERT INTO public.auth_login_identifiers (normalized_identifier, user_id, kind)
SELECT 'phone:+' || normalized.phone_digits, normalized.user_id, 'phone'
FROM (
  SELECT user_id,
    CASE
      WHEN digits ~ '^91[0-9]{10}$' THEN digits
      WHEN digits ~ '^[0-9]{10}$' THEN '91' || digits
      WHEN digits ~ '^[1-9][0-9]{7,14}$' THEN digits
      ELSE NULL
    END AS phone_digits
  FROM (
    SELECT user_id, regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') AS digits
    FROM public.users
  ) source
) normalized
WHERE normalized.phone_digits IS NOT NULL
ON CONFLICT (normalized_identifier) DO NOTHING;

-- Remove FKs to auth.users so staff profiles and audit attribution can use app-owned IDs.
DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT conrelid::regclass AS relation_name, conname
    FROM pg_constraint
    WHERE contype = 'f'
      AND confrelid = 'auth.users'::regclass
      AND connamespace = 'public'::regnamespace
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', item.relation_name, item.conname);
  END LOOP;
END $$;

ALTER TABLE public.offline_sync_operations
  ADD CONSTRAINT offline_sync_operations_user_id_app_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(user_id);
ALTER TABLE public.purchase_receipts
  ADD CONSTRAINT purchase_receipts_reviewed_by_app_fkey
  FOREIGN KEY (reviewed_by) REFERENCES public.users(user_id);
ALTER TABLE public.cashier_shortcuts
  ADD CONSTRAINT cashier_shortcuts_updated_by_app_fkey
  FOREIGN KEY (updated_by) REFERENCES public.users(user_id);
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_cashier_id_app_fkey
  FOREIGN KEY (cashier_id) REFERENCES public.users(user_id);

CREATE OR REPLACE FUNCTION public.app_save_staff_profile(
  p_actor_user_id uuid,
  p_user_id uuid,
  p_display_name text,
  p_email text,
  p_phone text,
  p_email_identifier text,
  p_phone_identifier text,
  p_role text,
  p_location_ids uuid[],
  p_is_active boolean,
  p_must_change_password boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE user_id = p_actor_user_id AND role = 'ADMIN' AND is_active = true
  ) THEN RAISE EXCEPTION 'Only an active Admin can manage staff accounts'; END IF;
  IF p_user_id IS NULL OR NULLIF(btrim(p_display_name), '') IS NULL THEN
    RAISE EXCEPTION 'A staff ID and display name are required';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('CASHIER', 'MANAGER', 'ADMIN') THEN
    RAISE EXCEPTION 'Invalid staff role';
  END IF;
  IF p_user_id = p_actor_user_id AND p_role <> 'ADMIN' THEN
    RAISE EXCEPTION 'An Admin cannot remove their own Admin access';
  END IF;
  IF p_role <> 'ADMIN' AND COALESCE(cardinality(p_location_ids), 0) = 0 THEN
    RAISE EXCEPTION 'Assign at least one location to this staff member';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_location_ids, '{}'::uuid[])) requested(id)
    LEFT JOIN public.locations location ON location.id = requested.id
    WHERE location.id IS NULL
  ) THEN RAISE EXCEPTION 'One or more assigned locations do not exist'; END IF;
  IF p_email_identifier IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.auth_login_identifiers
    WHERE normalized_identifier = p_email_identifier AND user_id <> p_user_id
  ) THEN RAISE EXCEPTION 'That email is already assigned to another staff member'; END IF;
  IF p_phone_identifier IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.auth_login_identifiers
    WHERE normalized_identifier = p_phone_identifier AND user_id <> p_user_id
  ) THEN RAISE EXCEPTION 'That mobile number is already assigned to another staff member'; END IF;

  INSERT INTO public.users
    (user_id, display_name, email, phone, role, is_active, must_change_password)
  VALUES
    (p_user_id, btrim(p_display_name), NULLIF(lower(btrim(p_email)), ''),
      NULLIF(btrim(p_phone), ''), p_role, COALESCE(p_is_active, true),
      COALESCE(p_must_change_password, false))
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
  SELECT p_user_id, location_id
  FROM unnest(COALESCE(p_location_ids, '{}'::uuid[])) locations(location_id)
  ON CONFLICT DO NOTHING;

  DELETE FROM public.auth_login_identifiers WHERE user_id = p_user_id;
  IF p_email_identifier IS NOT NULL THEN
    INSERT INTO public.auth_login_identifiers (normalized_identifier, user_id, kind)
    VALUES (p_email_identifier, p_user_id, 'email');
  END IF;
  IF p_phone_identifier IS NOT NULL THEN
    INSERT INTO public.auth_login_identifiers (normalized_identifier, user_id, kind)
    VALUES (p_phone_identifier, p_user_id, 'phone');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.app_complete_first_admin_bootstrap(
  p_token_hash text,
  p_user_id uuid,
  p_display_name text,
  p_email text,
  p_phone text,
  p_email_identifier text,
  p_phone_identifier text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE
  v_existing_admin uuid;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid setup token';
  END IF;
  PERFORM 1 FROM public.auth_bootstrap_tokens
  WHERE token_hash = p_token_hash AND consumed_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Setup token is invalid or has already been used'; END IF;

  SELECT user_id INTO v_existing_admin
  FROM public.users
  WHERE role = 'ADMIN' AND is_active = true
    AND (
      (p_email IS NOT NULL AND lower(email) = lower(p_email))
      OR (p_phone IS NOT NULL AND phone = p_phone)
    )
  LIMIT 1
  FOR UPDATE;

  IF v_existing_admin IS NOT NULL AND v_existing_admin <> p_user_id THEN
    RAISE EXCEPTION 'The selected login belongs to a different Admin profile';
  END IF;
  IF v_existing_admin IS NULL AND EXISTS (
    SELECT 1 FROM public.users WHERE role = 'ADMIN' AND is_active = true
  ) THEN RAISE EXCEPTION 'An active Admin already exists; ask that Admin to provision staff'; END IF;

  INSERT INTO public.users
    (user_id, display_name, email, phone, role, is_active, must_change_password)
  VALUES
    (p_user_id, btrim(p_display_name), NULLIF(lower(btrim(p_email)), ''),
      NULLIF(btrim(p_phone), ''), 'ADMIN', true, false)
  ON CONFLICT (user_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    role = 'ADMIN',
    is_active = true,
    must_change_password = false,
    updated_at = now();

  DELETE FROM public.auth_login_identifiers WHERE user_id = p_user_id;
  IF p_email_identifier IS NOT NULL THEN
    INSERT INTO public.auth_login_identifiers (normalized_identifier, user_id, kind)
    VALUES (p_email_identifier, p_user_id, 'email');
  END IF;
  IF p_phone_identifier IS NOT NULL THEN
    INSERT INTO public.auth_login_identifiers (normalized_identifier, user_id, kind)
    VALUES (p_phone_identifier, p_user_id, 'phone');
  END IF;

  UPDATE public.auth_bootstrap_tokens
  SET consumed_at = now(), consumed_by = p_user_id
  WHERE token_hash = p_token_hash AND consumed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Setup token has already been used'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.app_sync_offline_operation_as_staff(
  p_actor_user_id uuid,
  p_operation_id uuid,
  p_device_id text,
  p_outlet_id uuid,
  p_operation_type text,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE user_id = p_actor_user_id AND is_active = true
      AND role IN ('CASHIER', 'MANAGER', 'ADMIN')
  ) THEN RAISE EXCEPTION 'An active staff account is required'; END IF;
  PERFORM set_config('request.jwt.claim.sub', p_actor_user_id::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_actor_user_id::text, 'role', 'authenticated'
  )::text, true);
  RETURN public.sync_offline_operation(
    p_operation_id, p_device_id, p_outlet_id, p_operation_type, p_payload
  );
END $$;

CREATE OR REPLACE FUNCTION public.app_resolve_inventory_sync_alert(
  p_actor_user_id uuid,
  p_alert_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE user_id = p_actor_user_id AND role IN ('MANAGER', 'ADMIN') AND is_active = true
  ) THEN RAISE EXCEPTION 'Manager access is required'; END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.inventory_sync_alerts alert
    JOIN public.staff_location_access access
      ON access.location_id = alert.location_id
    WHERE alert.id = p_alert_id
      AND access.user_id = p_actor_user_id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE user_id = p_actor_user_id AND role = 'ADMIN' AND is_active = true
  ) THEN RAISE EXCEPTION 'Location access denied for this inventory alert'; END IF;
  PERFORM set_config('request.jwt.claim.sub', p_actor_user_id::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_actor_user_id::text, 'role', 'authenticated'
  )::text, true);
  PERFORM public.resolve_inventory_sync_alert(p_alert_id);
END $$;

CREATE OR REPLACE FUNCTION public.app_set_product_price_tiers(
  p_actor_user_id uuid,
  p_product_id uuid,
  p_price_tiers jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE user_id = p_actor_user_id AND role IN ('MANAGER', 'ADMIN') AND is_active = true
  ) THEN RAISE EXCEPTION 'Manager access is required'; END IF;
  PERFORM set_config('request.jwt.claim.sub', p_actor_user_id::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_actor_user_id::text, 'role', 'authenticated'
  )::text, true);
  PERFORM public.set_product_price_tiers(p_product_id, p_price_tiers);
END $$;

REVOKE ALL ON FUNCTION public.app_save_staff_profile(uuid, uuid, text, text, text, text, text, text, uuid[], boolean, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_complete_first_admin_bootstrap(text, uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_sync_offline_operation_as_staff(uuid, uuid, text, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_resolve_inventory_sync_alert(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_set_product_price_tiers(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_save_staff_profile(uuid, uuid, text, text, text, text, text, text, uuid[], boolean, boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.app_complete_first_admin_bootstrap(text, uuid, text, text, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.app_sync_offline_operation_as_staff(uuid, uuid, text, uuid, text, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.app_resolve_inventory_sync_alert(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.app_set_product_price_tiers(uuid, uuid, jsonb)
  TO service_role;
