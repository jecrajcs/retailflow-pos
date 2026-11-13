-- Run only after creating the account in Supabase Auth.
-- Replace the UUID below with the user's ID from Supabase Auth > Users.
DO $$
DECLARE
  v_auth_user_id uuid := '00000000-0000-0000-0000-000000000000';
  v_display_name text := 'Store Admin';
BEGIN
  IF v_auth_user_id = '00000000-0000-0000-0000-000000000000' THEN
    RAISE EXCEPTION 'Replace the placeholder with the Supabase Auth user ID before running this script';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_auth_user_id) THEN
    RAISE EXCEPTION 'No Supabase Auth user exists with the supplied ID';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.users
    WHERE role = 'ADMIN' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'An active DailyPlazaa Admin profile already exists';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE user_id = v_auth_user_id) THEN
    RAISE EXCEPTION 'This Auth user already has a DailyPlazaa staff profile';
  END IF;

  INSERT INTO public.users (user_id, display_name, email, phone, role, is_active)
  SELECT
    auth_user.id,
    v_display_name,
    NULLIF(lower(auth_user.email), ''),
    NULLIF(auth_user.phone, ''),
    'ADMIN',
    true
  FROM auth.users auth_user
  WHERE auth_user.id = v_auth_user_id;
END $$;
