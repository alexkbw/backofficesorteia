ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS chat_bubble_theme TEXT;

UPDATE public.profiles
SET chat_bubble_theme = COALESCE(NULLIF(chat_bubble_theme, ''), 'amber');

ALTER TABLE public.profiles
  ALTER COLUMN chat_bubble_theme SET DEFAULT 'amber';

ALTER TABLE public.profiles
  ALTER COLUMN chat_bubble_theme SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_chat_bubble_theme_check'
      AND connamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_chat_bubble_theme_check
      CHECK (
        chat_bubble_theme IN (
          'amber',
          'orange',
          'rose',
          'fuchsia',
          'emerald',
          'teal',
          'sky',
          'indigo',
          'slate'
        )
      );
  END IF;
END
$$;

DROP FUNCTION IF EXISTS public.get_chat_participant_identities(UUID[]);

CREATE FUNCTION public.get_chat_participant_identities(requested_user_ids UUID[])
RETURNS TABLE (
  user_id UUID,
  display_name TEXT,
  avatar_url TEXT,
  chat_bubble_theme TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    profiles.user_id,
    COALESCE(
      NULLIF(profiles.display_name, ''),
      NULLIF(profiles.full_name, ''),
      split_part(COALESCE(profiles.email, ''), '@', 1)
    ) AS display_name,
    profiles.avatar_url,
    COALESCE(NULLIF(profiles.chat_bubble_theme, ''), 'amber') AS chat_bubble_theme
  FROM public.profiles AS profiles
  WHERE profiles.user_id = ANY(COALESCE(requested_user_ids, ARRAY[]::UUID[]));
$$;

REVOKE ALL ON FUNCTION public.get_chat_participant_identities(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_chat_participant_identities(UUID[]) TO authenticated;
