ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS contest_code TEXT;

UPDATE public.promotions
SET contest_code = COALESCE(NULLIF(BTRIM(contest_code), ''), id::text);

ALTER TABLE public.promotions
  ALTER COLUMN contest_code SET NOT NULL;

CREATE INDEX IF NOT EXISTS promotions_contest_code_idx
  ON public.promotions (contest_code);

ALTER TABLE public.draws
  ADD COLUMN IF NOT EXISTS contest_code TEXT;

UPDATE public.draws AS draws
SET contest_code = COALESCE(
  NULLIF(BTRIM(draws.contest_code), ''),
  NULLIF(BTRIM(promotions.contest_code), ''),
  draws.promotion_id::text,
  draws.id::text
)
FROM public.promotions AS promotions
WHERE promotions.id = draws.promotion_id;

UPDATE public.draws
SET contest_code = COALESCE(
  NULLIF(BTRIM(contest_code), ''),
  promotion_id::text,
  id::text
)
WHERE contest_code IS NULL
   OR BTRIM(contest_code) = '';

ALTER TABLE public.draws
  ALTER COLUMN contest_code SET NOT NULL;

CREATE INDEX IF NOT EXISTS draws_contest_code_idx
  ON public.draws (contest_code, draw_date DESC);

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS contest_code TEXT;

UPDATE public.payments AS payments
SET contest_code = COALESCE(
  NULLIF(BTRIM(payments.contest_code), ''),
  NULLIF(BTRIM(promotions.contest_code), ''),
  payments.promotion_id::text,
  payments.draw_id::text,
  payments.id::text
)
FROM public.promotions AS promotions
WHERE promotions.id = payments.promotion_id;

UPDATE public.payments
SET contest_code = COALESCE(
  NULLIF(BTRIM(contest_code), ''),
  promotion_id::text,
  draw_id::text,
  id::text
)
WHERE contest_code IS NULL
   OR BTRIM(contest_code) = '';

ALTER TABLE public.payments
  ALTER COLUMN contest_code SET NOT NULL;

CREATE INDEX IF NOT EXISTS payments_contest_status_idx
  ON public.payments (contest_code, status, payment_date, created_at);

ALTER TABLE public.promotion_numbers
  ADD COLUMN IF NOT EXISTS contest_code TEXT;

UPDATE public.promotion_numbers AS promotion_numbers
SET contest_code = COALESCE(
  NULLIF(BTRIM(promotion_numbers.contest_code), ''),
  NULLIF(BTRIM(payments.contest_code), ''),
  NULLIF(BTRIM(promotions.contest_code), ''),
  promotion_numbers.promotion_id::text,
  promotion_numbers.payment_id::text
)
FROM public.payments AS payments
LEFT JOIN public.promotions AS promotions
  ON promotions.id = payments.promotion_id
WHERE payments.id = promotion_numbers.payment_id;

UPDATE public.promotion_numbers
SET contest_code = COALESCE(
  NULLIF(BTRIM(contest_code), ''),
  promotion_id::text,
  payment_id::text
)
WHERE contest_code IS NULL
   OR BTRIM(contest_code) = '';

ALTER TABLE public.promotion_numbers
  ALTER COLUMN contest_code SET NOT NULL;

DROP INDEX IF EXISTS promotion_numbers_promotion_ticket_idx;

CREATE UNIQUE INDEX IF NOT EXISTS promotion_numbers_contest_ticket_idx
  ON public.promotion_numbers (contest_code, ticket_number);

CREATE INDEX IF NOT EXISTS promotion_numbers_contest_idx
  ON public.promotion_numbers (contest_code, created_at DESC);

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
  NEW.number_package_size := COALESCE(NEW.number_package_size, 10);
  NEW.contest_code := COALESCE(NULLIF(BTRIM(NEW.contest_code), ''), COALESCE(NEW.id::text, gen_random_uuid()::text));
  NEW.file_url := NULLIF(BTRIM(COALESCE(NEW.file_url, '')), '');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_promotion_numbers(_payment_id UUID)
RETURNS TABLE(ticket_number INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  available_numbers INTEGER := 0;
  contest_ref TEXT;
  current_count INTEGER := 0;
  generated_number INTEGER;
  inserted_rows INTEGER := 0;
  max_attempts INTEGER := 50000;
  numbers_needed INTEGER := 0;
  payment_status_value TEXT;
  payment_user_id UUID;
  promotion_number_count INTEGER := 10;
  promotion_ref UUID;
  try_count INTEGER := 0;
BEGIN
  SELECT
    payments.contest_code,
    payments.promotion_id,
    COALESCE(promotions.number_package_size, 10),
    COALESCE(payments.status, ''),
    payments.user_id
  INTO
    contest_ref,
    promotion_ref,
    promotion_number_count,
    payment_status_value,
    payment_user_id
  FROM public.payments AS payments
  JOIN public.promotions AS promotions
    ON promotions.id = payments.promotion_id
  WHERE payments.id = _payment_id
  FOR UPDATE;

  contest_ref := COALESCE(NULLIF(BTRIM(contest_ref), ''), promotion_ref::text, _payment_id::text);

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
    WHEN promotion_number_count BETWEEN 1 AND 9999 THEN promotion_number_count
    ELSE 10
  END;

  SELECT COUNT(*)
  INTO current_count
  FROM public.promotion_numbers
  WHERE payment_id = _payment_id;

  numbers_needed := promotion_number_count - current_count;

  IF numbers_needed <= 0 THEN
    RETURN QUERY
    SELECT assigned.ticket_number
    FROM public.promotion_numbers AS assigned
    WHERE assigned.payment_id = _payment_id
    ORDER BY assigned.ticket_number;
    RETURN;
  END IF;

  SELECT 9999 - COUNT(*)
  INTO available_numbers
  FROM public.promotion_numbers
  WHERE contest_code = contest_ref;

  IF available_numbers < numbers_needed THEN
    RAISE EXCEPTION 'Nao ha numeros promocionais suficientes disponiveis para este concurso.';
  END IF;

  max_attempts := GREATEST(numbers_needed * 200, max_attempts);

  WHILE current_count < promotion_number_count LOOP
    IF try_count >= max_attempts THEN
      RAISE EXCEPTION 'Nao foi possivel reservar numeros suficientes para o concurso.';
    END IF;

    try_count := try_count + 1;
    generated_number := FLOOR(RANDOM() * 9999 + 1)::INTEGER;

    INSERT INTO public.promotion_numbers (
      contest_code,
      payment_id,
      promotion_id,
      ticket_number,
      user_id
    )
    VALUES (
      contest_ref,
      _payment_id,
      promotion_ref,
      generated_number,
      payment_user_id
    )
    ON CONFLICT (contest_code, ticket_number) DO NOTHING;

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
