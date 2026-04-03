DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'promotions'
      AND column_name = 'active'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'promotions'
      AND column_name = 'is_active'
  ) THEN
    ALTER TABLE public.promotions RENAME COLUMN active TO is_active;
  END IF;
END $$;

ALTER TABLE public.promotions
ADD COLUMN IF NOT EXISTS entry_amount NUMERIC(10,2) NOT NULL DEFAULT 10.00;
