-- Run after the baseline migration and replace these values for your store.
DO $$
DECLARE
  v_name text := 'Main Store';
  v_code text := 'MAIN';
  v_type text := 'RETAIL';
BEGIN
  IF NULLIF(btrim(v_name), '') IS NULL OR NULLIF(btrim(v_code), '') IS NULL THEN
    RAISE EXCEPTION 'A location name and code are required';
  END IF;
  IF EXISTS (SELECT 1 FROM public.locations WHERE code = upper(btrim(v_code))) THEN
    RAISE EXCEPTION 'A location with code % already exists', upper(btrim(v_code));
  END IF;

  INSERT INTO public.locations (name, code, type)
  VALUES (btrim(v_name), upper(btrim(v_code)), upper(btrim(v_type)));
END $$;
