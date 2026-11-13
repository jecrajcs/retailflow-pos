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
