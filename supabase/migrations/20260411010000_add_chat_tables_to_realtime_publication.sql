DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'public_chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.public_chat_messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'private_chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.private_chat_messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chat_reports'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_reports;
  END IF;
END
$$;
