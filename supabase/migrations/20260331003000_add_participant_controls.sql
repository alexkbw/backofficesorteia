CREATE TABLE IF NOT EXISTS public.participant_controls (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  checkout_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  public_chat_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  block_reason TEXT,
  internal_notes TEXT,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.participant_controls ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'participant_controls'
      AND policyname = 'Admins can manage participant_controls'
  ) THEN
    CREATE POLICY "Admins can manage participant_controls"
      ON public.participant_controls
      FOR ALL
      TO authenticated
      USING (public.has_role(auth.uid(), 'admin'))
      WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.is_checkout_blocked(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT checkout_blocked FROM public.participant_controls WHERE user_id = _user_id),
    FALSE
  )
$$;

CREATE OR REPLACE FUNCTION public.is_public_chat_blocked(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT public_chat_blocked FROM public.participant_controls WHERE user_id = _user_id),
    FALSE
  )
$$;

CREATE OR REPLACE FUNCTION public.get_my_participant_controls()
RETURNS TABLE (
  checkout_blocked BOOLEAN,
  public_chat_blocked BOOLEAN,
  block_reason TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(controls.checkout_blocked, FALSE) AS checkout_blocked,
    COALESCE(controls.public_chat_blocked, FALSE) AS public_chat_blocked,
    controls.block_reason
  FROM (SELECT auth.uid() AS current_user_id) AS auth_context
  LEFT JOIN public.participant_controls AS controls
    ON controls.user_id = auth_context.current_user_id
$$;

REVOKE ALL ON FUNCTION public.get_my_participant_controls() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_participant_controls() TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_checkout_block()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  requester_id UUID := auth.uid();
BEGIN
  IF requester_id IS NOT NULL AND public.has_role(requester_id, 'admin') THEN
    RETURN NEW;
  END IF;

  IF public.is_checkout_blocked(NEW.user_id) THEN
    RAISE EXCEPTION 'Seu acesso a novos checkouts foi temporariamente bloqueado pela equipe.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_public_chat_block()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  requester_id UUID := auth.uid();
BEGIN
  IF requester_id IS NOT NULL AND public.has_role(requester_id, 'admin') THEN
    RETURN NEW;
  END IF;

  IF public.is_public_chat_blocked(NEW.user_id) THEN
    RAISE EXCEPTION 'Seu acesso ao chat publico foi temporariamente bloqueado pela equipe.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_participant_controls_updated_at ON public.participant_controls;
CREATE TRIGGER update_participant_controls_updated_at
BEFORE UPDATE ON public.participant_controls
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS enforce_checkout_block_on_payments ON public.payments;
CREATE TRIGGER enforce_checkout_block_on_payments
BEFORE INSERT ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.guard_checkout_block();

DROP TRIGGER IF EXISTS enforce_public_chat_block_on_messages ON public.public_chat_messages;
CREATE TRIGGER enforce_public_chat_block_on_messages
BEFORE INSERT ON public.public_chat_messages
FOR EACH ROW EXECUTE FUNCTION public.guard_public_chat_block();
