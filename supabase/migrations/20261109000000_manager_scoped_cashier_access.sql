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
