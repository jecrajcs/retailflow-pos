CREATE TABLE public.staff_offline_pin_verifiers (
  user_id uuid PRIMARY KEY REFERENCES public.users(user_id) ON DELETE CASCADE,
  salt text NOT NULL CHECK (salt ~ '^[a-f0-9]{32}$'),
  verifier text NOT NULL CHECK (verifier ~ '^[a-f0-9]{64}$'),
  iterations integer NOT NULL CHECK (iterations = 310000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.staff_offline_pin_verifiers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_offline_pin_verifiers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_offline_pin_verifiers TO service_role;
