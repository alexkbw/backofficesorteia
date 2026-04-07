ALTER TABLE public.promotions
  ALTER COLUMN number_package_size SET DEFAULT 10;

UPDATE public.promotions
SET number_package_size = 10
WHERE number_package_size IS NULL
   OR number_package_size < 1
   OR number_package_size > 9999;

ALTER TABLE public.promotions
  ALTER COLUMN number_package_size SET NOT NULL;

ALTER TABLE public.promotions
  DROP CONSTRAINT IF EXISTS promotions_number_package_size_check;

ALTER TABLE public.promotions
  ADD CONSTRAINT promotions_number_package_size_check
  CHECK (number_package_size BETWEEN 1 AND 9999);

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
  WHERE promotion_id = promotion_ref;

  IF available_numbers < numbers_needed THEN
    RAISE EXCEPTION 'Nao ha numeros promocionais suficientes disponiveis para esta campanha.';
  END IF;

  max_attempts := GREATEST(numbers_needed * 200, max_attempts);

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
