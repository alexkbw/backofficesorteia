ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS attribution_source TEXT,
  ADD COLUMN IF NOT EXISTS attribution_medium TEXT,
  ADD COLUMN IF NOT EXISTS attribution_campaign TEXT,
  ADD COLUMN IF NOT EXISTS attribution_id TEXT,
  ADD COLUMN IF NOT EXISTS attribution_content TEXT,
  ADD COLUMN IF NOT EXISTS attribution_landing_path TEXT,
  ADD COLUMN IF NOT EXISTS attribution_referrer_host TEXT,
  ADD COLUMN IF NOT EXISTS attributed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS payments_attribution_source_created_at_idx
  ON public.payments (attribution_source, created_at DESC);

CREATE INDEX IF NOT EXISTS payments_attribution_campaign_created_at_idx
  ON public.payments (attribution_id, attribution_campaign, created_at DESC);
