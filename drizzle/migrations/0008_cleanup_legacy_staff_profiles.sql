-- The app now uses public.users for staff profiles. A fresh migration chain
-- renames staff_profiles to users in 0006, so this is normally a no-op.
-- Refuse to remove any legacy profile data or unreviewed foreign-key dependencies.
DO $$
DECLARE
  legacy_profiles regclass := to_regclass('public.staff_profiles');
  dependency record;
  has_users_fk boolean;
BEGIN
  IF legacy_profiles IS NULL THEN
    RETURN;
  END IF;

  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'Cannot clean up public.staff_profiles before public.users exists';
  END IF;

  IF EXISTS (SELECT 1 FROM public.staff_profiles LIMIT 1) THEN
    RAISE EXCEPTION
      'public.staff_profiles still contains data; reconcile it with public.users before cleanup';
  END IF;

  FOR dependency IN
    SELECT conname, conrelid
    FROM pg_constraint
    WHERE contype = 'f' AND confrelid = legacy_profiles
  LOOP
    IF dependency.conrelid <> to_regclass('public.staff_location_access') THEN
      RAISE EXCEPTION
        'public.staff_profiles has an unreviewed foreign-key dependency; cleanup was stopped';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.staff_location_access access
      LEFT JOIN public.users staff ON staff.user_id = access.user_id
      WHERE staff.user_id IS NULL
    ) THEN
      RAISE EXCEPTION
        'Some staff location assignments have no matching public.users record; cleanup was stopped';
    END IF;

    EXECUTE format(
      'ALTER TABLE public.staff_location_access DROP CONSTRAINT %I',
      dependency.conname
    );
  END LOOP;

  IF to_regclass('public.staff_location_access') IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint constraint_row
      WHERE constraint_row.contype = 'f'
        AND constraint_row.conrelid = 'public.staff_location_access'::regclass
        AND constraint_row.confrelid = 'public.users'::regclass
        AND constraint_row.conkey = ARRAY[
          (
            SELECT attribute.attnum
            FROM pg_attribute attribute
            WHERE attribute.attrelid = 'public.staff_location_access'::regclass
              AND attribute.attname = 'user_id'
              AND NOT attribute.attisdropped
          )
        ]::smallint[]
    ) INTO has_users_fk;

    IF NOT has_users_fk THEN
      ALTER TABLE public.staff_location_access
        ADD CONSTRAINT staff_location_access_users_cleanup_fkey
        FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;
    END IF;
  END IF;

  DROP TABLE public.staff_profiles RESTRICT;
END $$;
