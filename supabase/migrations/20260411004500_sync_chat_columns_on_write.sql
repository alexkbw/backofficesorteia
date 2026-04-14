CREATE OR REPLACE FUNCTION public.sync_public_chat_message_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.user_id := COALESCE(NEW.user_id, NEW.sender_id);
  NEW.sender_id := COALESCE(NEW.sender_id, NEW.user_id);
  NEW.message := COALESCE(NEW.message, NEW.content);
  NEW.content := COALESCE(NEW.content, NEW.message);
  NEW.sent_at := COALESCE(NEW.sent_at, NEW.created_at, NOW());
  NEW.created_at := COALESCE(NEW.created_at, NEW.sent_at, NOW());

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_private_chat_message_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.message := COALESCE(NEW.message, NEW.content);
  NEW.content := COALESCE(NEW.content, NEW.message);
  NEW.read := COALESCE(NEW.read, FALSE);
  NEW.sent_at := COALESCE(NEW.sent_at, NEW.created_at, NOW());
  NEW.created_at := COALESCE(NEW.created_at, NEW.sent_at, NOW());

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_public_chat_message_columns_on_write ON public.public_chat_messages;
CREATE TRIGGER sync_public_chat_message_columns_on_write
BEFORE INSERT OR UPDATE ON public.public_chat_messages
FOR EACH ROW EXECUTE FUNCTION public.sync_public_chat_message_columns();

DROP TRIGGER IF EXISTS sync_private_chat_message_columns_on_write ON public.private_chat_messages;
CREATE TRIGGER sync_private_chat_message_columns_on_write
BEFORE INSERT OR UPDATE ON public.private_chat_messages
FOR EACH ROW EXECUTE FUNCTION public.sync_private_chat_message_columns();
