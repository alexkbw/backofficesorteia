CREATE TABLE IF NOT EXISTS public.chat_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reported_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  public_message_id UUID REFERENCES public.public_chat_messages(id) ON DELETE SET NULL,
  reported_message_body TEXT NOT NULL,
  reported_message_created_at TIMESTAMPTZ,
  report_reason TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chat_reports_status_check CHECK (status IN ('open', 'reviewed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_reports_reporter_message_unique_idx
  ON public.chat_reports (reporter_id, public_message_id)
  WHERE public_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS chat_reports_reported_user_created_at_idx
  ON public.chat_reports (reported_user_id, created_at DESC);

ALTER TABLE public.chat_reports ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_reports'
      AND policyname = 'Admins can manage chat_reports'
  ) THEN
    CREATE POLICY "Admins can manage chat_reports"
      ON public.chat_reports
      FOR ALL
      TO authenticated
      USING (public.has_role(auth.uid(), 'admin'))
      WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_reports'
      AND policyname = 'Users can create own chat reports'
  ) THEN
    CREATE POLICY "Users can create own chat reports"
      ON public.chat_reports
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = reporter_id);
  END IF;
END
$$;

DROP TRIGGER IF EXISTS update_chat_reports_updated_at ON public.chat_reports;
CREATE TRIGGER update_chat_reports_updated_at
BEFORE UPDATE ON public.chat_reports
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
