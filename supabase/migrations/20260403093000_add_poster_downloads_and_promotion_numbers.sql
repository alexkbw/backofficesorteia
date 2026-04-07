ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS file_url TEXT,
  ADD COLUMN IF NOT EXISTS file_type TEXT NOT NULL DEFAULT 'pdf',
  ADD COLUMN IF NOT EXISTS number_package_size INTEGER NOT NULL DEFAULT 10;

UPDATE public.promotions
SET
  file_type = COALESCE(NULLIF(LOWER(file_type), ''), 'pdf'),
  number_package_size = CASE
    WHEN number_package_size IN (10, 20, 30) THEN number_package_size
    ELSE 10
  END,
  file_url = NULLIF(BTRIM(COALESCE(file_url, '')), '');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'promotions_file_type_check'
      AND connamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE public.promotions
      ADD CONSTRAINT promotions_file_type_check
      CHECK (LOWER(file_type) = 'pdf');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'promotions_number_package_size_check'
      AND connamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE public.promotions
      ADD CONSTRAINT promotions_number_package_size_check
      CHECK (number_package_size IN (10, 20, 30));
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.sync_promotion_active_flags()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.is_active := COALESCE(NEW.is_active, NEW.active, TRUE);
  NEW.active := COALESCE(NEW.active, NEW.is_active, TRUE);
  NEW.entry_amount := COALESCE(NEW.entry_amount, 10.00);
  NEW.image_url := COALESCE(NULLIF(NEW.image_url, ''), '/placeholder.svg');
  NEW.file_type := COALESCE(NULLIF(LOWER(NEW.file_type), ''), 'pdf');
  NEW.number_package_size := CASE
    WHEN COALESCE(NEW.number_package_size, 10) IN (10, 20, 30) THEN COALESCE(NEW.number_package_size, 10)
    ELSE 10
  END;
  NEW.file_url := NULLIF(BTRIM(COALESCE(NEW.file_url, '')), '');
  RETURN NEW;
END;
$$;

ALTER TABLE public.draws
  ADD COLUMN IF NOT EXISTS federal_contest TEXT,
  ADD COLUMN IF NOT EXISTS federal_first_prize TEXT,
  ADD COLUMN IF NOT EXISTS official_winning_number INTEGER,
  ADD COLUMN IF NOT EXISTS result_source TEXT NOT NULL DEFAULT 'manual';

DO $$
DECLARE
  draw_user_constraint TEXT;
BEGIN
  SELECT constraints.constraint_name
  INTO draw_user_constraint
  FROM information_schema.constraint_column_usage AS usage
  JOIN information_schema.table_constraints AS constraints
    ON constraints.constraint_name = usage.constraint_name
   AND constraints.table_schema = usage.table_schema
  JOIN information_schema.key_column_usage AS key_usage
    ON key_usage.constraint_name = constraints.constraint_name
   AND key_usage.table_schema = constraints.table_schema
  WHERE constraints.table_schema = 'public'
    AND constraints.table_name = 'draw_participants'
    AND constraints.constraint_type = 'UNIQUE'
  GROUP BY constraints.constraint_name
  HAVING COUNT(*) FILTER (WHERE key_usage.column_name = 'draw_id') > 0
     AND COUNT(*) FILTER (WHERE key_usage.column_name = 'user_id') > 0;

  IF draw_user_constraint IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.draw_participants DROP CONSTRAINT %I',
      draw_user_constraint
    );
  END IF;
END
$$;

ALTER TABLE public.draw_participants
  ADD COLUMN IF NOT EXISTS ticket_number INTEGER;

CREATE TABLE IF NOT EXISTS public.promotion_numbers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  promotion_id UUID NOT NULL REFERENCES public.promotions(id) ON DELETE CASCADE,
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  ticket_number INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.promotion_numbers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'promotion_numbers_ticket_range_check'
      AND connamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE public.promotion_numbers
      ADD CONSTRAINT promotion_numbers_ticket_range_check
      CHECK (ticket_number BETWEEN 1 AND 9999);
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS promotion_numbers_promotion_ticket_idx
  ON public.promotion_numbers (promotion_id, ticket_number);

CREATE INDEX IF NOT EXISTS promotion_numbers_user_idx
  ON public.promotion_numbers (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS promotion_numbers_payment_idx
  ON public.promotion_numbers (payment_id);

CREATE UNIQUE INDEX IF NOT EXISTS draw_participants_draw_ticket_number_idx
  ON public.draw_participants (draw_id, ticket_number)
  WHERE ticket_number IS NOT NULL;

CREATE OR REPLACE FUNCTION public.assign_promotion_numbers(_payment_id UUID)
RETURNS TABLE(ticket_number INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_count INTEGER := 0;
  generated_number INTEGER;
  inserted_rows INTEGER := 0;
  max_attempts INTEGER := 50000;
  promotion_number_count INTEGER := 10;
  promotion_ref UUID;
  payment_status_value TEXT;
  payment_user_id UUID;
  try_count INTEGER := 0;
BEGIN
  SELECT
    payments.promotion_id,
    COALESCE(promotions.number_package_size, 10),
    COALESCE(payments.status, ''),
    payments.user_id
  INTO
    promotion_ref,
    promotion_number_count,
    payment_status_value,
    payment_user_id
  FROM public.payments AS payments
  JOIN public.promotions AS promotions
    ON promotions.id = payments.promotion_id
  WHERE payments.id = _payment_id
  FOR UPDATE;

  IF promotion_ref IS NULL OR payment_user_id IS NULL THEN
    RAISE EXCEPTION 'Pagamento nao encontrado ou sem promocao vinculada.';
  END IF;

  IF LOWER(payment_status_value) NOT IN ('paid', 'completed', 'approved') THEN
    RETURN QUERY
    SELECT assigned.ticket_number
    FROM public.promotion_numbers AS assigned
    WHERE assigned.payment_id = _payment_id
    ORDER BY assigned.ticket_number;
    RETURN;
  END IF;

  promotion_number_count := CASE
    WHEN promotion_number_count IN (10, 20, 30) THEN promotion_number_count
    ELSE 10
  END;

  SELECT COUNT(*)
  INTO current_count
  FROM public.promotion_numbers
  WHERE payment_id = _payment_id;

  WHILE current_count < promotion_number_count LOOP
    IF try_count >= max_attempts THEN
      RAISE EXCEPTION 'Nao foi possivel reservar numeros suficientes para a promocao.';
    END IF;

    try_count := try_count + 1;
    generated_number := FLOOR(RANDOM() * 9999 + 1)::INTEGER;

    INSERT INTO public.promotion_numbers (
      payment_id,
      promotion_id,
      ticket_number,
      user_id
    )
    VALUES (
      _payment_id,
      promotion_ref,
      generated_number,
      payment_user_id
    )
    ON CONFLICT (promotion_id, ticket_number) DO NOTHING;

    GET DIAGNOSTICS inserted_rows = ROW_COUNT;

    IF inserted_rows > 0 THEN
      current_count := current_count + 1;
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT assigned.ticket_number
  FROM public.promotion_numbers AS assigned
  WHERE assigned.payment_id = _payment_id
  ORDER BY assigned.ticket_number;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'promotion_numbers'
      AND policyname = 'Admins can manage promotion numbers'
  ) THEN
    CREATE POLICY "Admins can manage promotion numbers"
      ON public.promotion_numbers
      FOR ALL
      TO authenticated
      USING (public.has_role(auth.uid(), 'admin'))
      WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'promotion_numbers'
      AND policyname = 'Users can view own promotion numbers'
  ) THEN
    CREATE POLICY "Users can view own promotion numbers"
      ON public.promotion_numbers
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
  END IF;
END
$$;
