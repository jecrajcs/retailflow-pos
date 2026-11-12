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
