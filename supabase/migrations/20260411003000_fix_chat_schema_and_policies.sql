ALTER TABLE public.public_chat_messages
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS sender_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS content TEXT,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.private_chat_messages
  ADD COLUMN IF NOT EXISTS sender_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS receiver_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS content TEXT,
  ADD COLUMN IF NOT EXISTS read BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

UPDATE public.public_chat_messages
SET
  user_id = COALESCE(user_id, sender_id),
  sender_id = COALESCE(sender_id, user_id),
  message = COALESCE(message, content),
  content = COALESCE(content, message),
  sent_at = COALESCE(sent_at, created_at, NOW()),
  created_at = COALESCE(created_at, sent_at, NOW())
WHERE
  user_id IS NULL
  OR sender_id IS NULL
  OR message IS NULL
  OR content IS NULL
  OR sent_at IS NULL
  OR created_at IS NULL;

UPDATE public.private_chat_messages
SET
  message = COALESCE(message, content),
  content = COALESCE(content, message),
  read = COALESCE(read, FALSE),
  sent_at = COALESCE(sent_at, created_at, NOW()),
  created_at = COALESCE(created_at, sent_at, NOW())
WHERE
  message IS NULL
  OR content IS NULL
  OR read IS NULL
  OR sent_at IS NULL
  OR created_at IS NULL;

ALTER TABLE public.public_chat_messages
  ALTER COLUMN sent_at SET DEFAULT NOW(),
  ALTER COLUMN created_at SET DEFAULT NOW();

ALTER TABLE public.private_chat_messages
  ALTER COLUMN read SET DEFAULT FALSE,
  ALTER COLUMN sent_at SET DEFAULT NOW(),
  ALTER COLUMN created_at SET DEFAULT NOW();

DROP POLICY IF EXISTS "Authenticated can view public chat" ON public.public_chat_messages;
CREATE POLICY "Authenticated can view public chat"
  ON public.public_chat_messages
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated can send public chat" ON public.public_chat_messages;
CREATE POLICY "Authenticated can send public chat"
  ON public.public_chat_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = COALESCE(user_id, sender_id));

DROP POLICY IF EXISTS "Users can view own private messages" ON public.private_chat_messages;
CREATE POLICY "Users can view own private messages"
  ON public.private_chat_messages
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = sender_id
    OR auth.uid() = receiver_id
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "Authenticated can send private messages" ON public.private_chat_messages;
CREATE POLICY "Authenticated can send private messages"
  ON public.private_chat_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = sender_id);

DROP POLICY IF EXISTS "Users can mark own messages read" ON public.private_chat_messages;
CREATE POLICY "Users can mark own messages read"
  ON public.private_chat_messages
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = receiver_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = receiver_id OR public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.guard_public_chat_block()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  requester_id UUID := auth.uid();
  target_user_id UUID := COALESCE(
    NULLIF(to_jsonb(NEW) ->> 'user_id', '')::UUID,
    NULLIF(to_jsonb(NEW) ->> 'sender_id', '')::UUID
  );
BEGIN
  IF requester_id IS NOT NULL AND public.has_role(requester_id, 'admin') THEN
    RETURN NEW;
  END IF;

  IF target_user_id IS NOT NULL AND public.is_public_chat_blocked(target_user_id) THEN
    RAISE EXCEPTION 'Seu acesso ao chat publico foi temporariamente bloqueado pela equipe.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;
