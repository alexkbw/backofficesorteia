ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS cpf TEXT,
  ADD COLUMN IF NOT EXISTS birth_date DATE;

CREATE OR REPLACE FUNCTION public.normalize_cpf(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(regexp_replace(COALESCE(value, ''), '[^0-9]', '', 'g'), '')
$$;

CREATE OR REPLACE FUNCTION public.prepare_profile_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.email := COALESCE(NEW.email, '');
  NEW.display_name := COALESCE(NULLIF(NEW.display_name, ''), NULLIF(NEW.full_name, ''), split_part(NEW.email, '@', 1));
  NEW.full_name := COALESCE(NULLIF(NEW.full_name, ''), NULLIF(NEW.display_name, ''), split_part(NEW.email, '@', 1));
  NEW.cpf := public.normalize_cpf(NEW.cpf);

  IF NEW.birth_date IS NOT NULL AND NEW.birth_date > CURRENT_DATE - INTERVAL '18 years' THEN
    RAISE EXCEPTION 'Usuário deve ter pelo menos 18 anos.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prepare_profile_fields ON public.profiles;
CREATE TRIGGER prepare_profile_fields
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prepare_profile_fields();

UPDATE public.profiles
SET
  display_name = COALESCE(NULLIF(display_name, ''), NULLIF(full_name, ''), split_part(COALESCE(email, ''), '@', 1)),
  full_name = COALESCE(NULLIF(full_name, ''), NULLIF(display_name, ''), split_part(COALESCE(email, ''), '@', 1)),
  cpf = public.normalize_cpf(cpf);

CREATE UNIQUE INDEX IF NOT EXISTS profiles_user_id_unique_idx ON public.profiles (user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_cpf_unique_idx ON public.profiles (cpf) WHERE cpf IS NOT NULL;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    user_id,
    display_name,
    full_name,
    email,
    cpf,
    birth_date
  )
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'display_name', ''),
      NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
      split_part(COALESCE(NEW.email, ''), '@', 1)
    ),
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
      NULLIF(NEW.raw_user_meta_data->>'display_name', ''),
      split_part(COALESCE(NEW.email, ''), '@', 1)
    ),
    COALESCE(NEW.email, ''),
    public.normalize_cpf(NEW.raw_user_meta_data->>'cpf'),
    NULLIF(NEW.raw_user_meta_data->>'birth_date', '')::DATE
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    display_name = EXCLUDED.display_name,
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    cpf = COALESCE(EXCLUDED.cpf, public.profiles.cpf),
    birth_date = COALESCE(EXCLUDED.birth_date, public.profiles.birth_date),
    updated_at = CASE
      WHEN EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'profiles'
          AND column_name = 'updated_at'
      )
      THEN NOW()
      ELSE public.profiles.updated_at
    END;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'on_auth_user_created'
  ) THEN
    CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END
$$;

ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS active BOOLEAN,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN,
  ADD COLUMN IF NOT EXISTS entry_amount NUMERIC(10, 2) NOT NULL DEFAULT 10.00;

CREATE OR REPLACE FUNCTION public.sync_promotion_active_flags()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.is_active := COALESCE(NEW.is_active, NEW.active, TRUE);
  NEW.active := COALESCE(NEW.active, NEW.is_active, TRUE);
  NEW.entry_amount := COALESCE(NEW.entry_amount, 10.00);
  NEW.image_url := COALESCE(NULLIF(NEW.image_url, ''), '/placeholder.svg');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_promotion_active_flags ON public.promotions;
CREATE TRIGGER sync_promotion_active_flags
BEFORE INSERT OR UPDATE ON public.promotions
FOR EACH ROW EXECUTE FUNCTION public.sync_promotion_active_flags();

UPDATE public.promotions
SET
  active = COALESCE(active, is_active, TRUE),
  is_active = COALESCE(is_active, active, TRUE),
  entry_amount = COALESCE(entry_amount, 10.00),
  image_url = COALESCE(NULLIF(image_url, ''), '/placeholder.svg');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typnamespace = 'public'::regnamespace
      AND typname = 'payment_status'
  ) THEN
    ALTER TYPE public.payment_status ADD VALUE IF NOT EXISTS 'paid';
  END IF;
END
$$;

ALTER TABLE public.draws
  ADD COLUMN IF NOT EXISTS promotion_id UUID REFERENCES public.promotions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sequence_number INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS winner_count INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS drawn_numbers INTEGER[],
  ADD COLUMN IF NOT EXISTS winner_user_ids UUID[],
  ADD COLUMN IF NOT EXISTS total_pot NUMERIC(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS platform_cut NUMERIC(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prize_pool NUMERIC(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prize_per_winner NUMERIC(10, 2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS draws_promotion_id_idx ON public.draws (promotion_id, draw_date DESC);

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS draw_id UUID REFERENCES public.draws(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promotion_id UUID REFERENCES public.promotions(id) ON DELETE SET NULL;

UPDATE public.payments
SET payment_date = COALESCE(payment_date, created_at, NOW());

UPDATE public.payments AS payments
SET promotion_id = draws.promotion_id
FROM public.draws AS draws
WHERE payments.promotion_id IS NULL
  AND payments.draw_id = draws.id
  AND draws.promotion_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payments_promotion_status_idx
  ON public.payments (promotion_id, status, payment_date, created_at);

ALTER TABLE public.draw_participants
  ADD COLUMN IF NOT EXISTS position INTEGER,
  ADD COLUMN IF NOT EXISTS is_winner BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS prize_amount NUMERIC(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL;

WITH ranked_participants AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY draw_id ORDER BY created_at, id) AS next_position
  FROM public.draw_participants
)
UPDATE public.draw_participants AS participants
SET position = ranked_participants.next_position
FROM ranked_participants
WHERE participants.id = ranked_participants.id
  AND participants.position IS NULL;

ALTER TABLE public.draw_participants
  ALTER COLUMN position SET NOT NULL;

CREATE INDEX IF NOT EXISTS draw_participants_draw_position_idx
  ON public.draw_participants (draw_id, position);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'Users can insert own profile'
  ) THEN
    CREATE POLICY "Users can insert own profile"
      ON public.profiles
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'Users can view own profile'
  ) THEN
    CREATE POLICY "Users can view own profile"
      ON public.profiles
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'Users can update own profile'
  ) THEN
    CREATE POLICY "Users can update own profile"
      ON public.profiles
      FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'draws'
      AND policyname = 'Anyone can view draws'
  ) THEN
    CREATE POLICY "Anyone can view draws"
      ON public.draws
      FOR SELECT
      USING (TRUE);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'promotions'
      AND policyname = 'Anyone can view promotions'
  ) THEN
    CREATE POLICY "Anyone can view promotions"
      ON public.promotions
      FOR SELECT
      USING (active = TRUE OR is_active = TRUE);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'payments'
      AND policyname = 'Users can view own payments'
  ) THEN
    CREATE POLICY "Users can view own payments"
      ON public.payments
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'payments'
      AND policyname = 'Users can create own payments'
  ) THEN
    CREATE POLICY "Users can create own payments"
      ON public.payments
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'draw_participants'
      AND policyname = 'Users can view own participation'
  ) THEN
    CREATE POLICY "Users can view own participation"
      ON public.draw_participants
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
  END IF;
END
$$;
