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
