ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS week_reference TEXT;

UPDATE public.payments
SET week_reference = TO_CHAR(COALESCE(payment_date, created_at, NOW()), 'IYYY-"W"IW')
WHERE week_reference IS NULL;

ALTER TABLE public.payments
  ALTER COLUMN week_reference SET DEFAULT TO_CHAR(NOW(), 'IYYY-"W"IW');

ALTER TABLE public.payments
  ALTER COLUMN week_reference SET NOT NULL;
