ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS poster_quantity INTEGER;

UPDATE public.payments AS payments
SET poster_quantity = COALESCE(
  NULLIF((
    SELECT COUNT(*)::INTEGER
    FROM public.promotion_numbers AS promotion_numbers
    WHERE promotion_numbers.payment_id = payments.id
  ), 0),
  (
    SELECT CASE
      WHEN promotions.number_package_size BETWEEN 1 AND 9999 THEN promotions.number_package_size
      ELSE 1
    END
    FROM public.promotions AS promotions
    WHERE promotions.id = payments.promotion_id
  ),
  1
)
WHERE payments.poster_quantity IS NULL;

UPDATE public.payments
SET poster_quantity = 1
WHERE poster_quantity IS NULL
   OR poster_quantity < 1
   OR poster_quantity > 9999;

ALTER TABLE public.payments
  ALTER COLUMN poster_quantity SET DEFAULT 1;

ALTER TABLE public.payments
  ALTER COLUMN poster_quantity SET NOT NULL;

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_poster_quantity_check;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_poster_quantity_check
  CHECK (poster_quantity BETWEEN 1 AND 9999);

CREATE OR REPLACE FUNCTION public.assign_promotion_numbers(_payment_id UUID)
RETURNS TABLE(ticket_number INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
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
  poster_quantity_value INTEGER := 1;
  promotion_ref UUID;
  try_count INTEGER := 0;
BEGIN
  SELECT
    payments.contest_code,
    payments.promotion_id,
    COALESCE(payments.poster_quantity, 1),
    COALESCE(payments.status, ''),
    payments.user_id
  INTO
    contest_ref,
    promotion_ref,
    poster_quantity_value,
    payment_status_value,
    payment_user_id
  FROM public.payments AS payments
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

  poster_quantity_value := CASE
    WHEN poster_quantity_value BETWEEN 1 AND 9999 THEN poster_quantity_value
    ELSE 1
  END;

  SELECT COUNT(*)
  INTO current_count
  FROM public.promotion_numbers
  WHERE payment_id = _payment_id;

  numbers_needed := poster_quantity_value - current_count;

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

  WHILE current_count < poster_quantity_value LOOP
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

DO $$
DECLARE
  payment_row RECORD;
BEGIN
  FOR payment_row IN
    SELECT payments.id
    FROM public.payments AS payments
    LEFT JOIN public.promotion_numbers AS promotion_numbers
      ON promotion_numbers.payment_id = payments.id
    WHERE LOWER(COALESCE(payments.status, '')) IN ('paid', 'completed', 'approved')
    GROUP BY payments.id
    HAVING COUNT(promotion_numbers.id) = 0
  LOOP
    PERFORM public.assign_promotion_numbers(payment_row.id);
  END LOOP;
END;
$$;
