CREATE OR REPLACE FUNCTION public.get_chat_participant_identities(requested_user_ids UUID[])
RETURNS TABLE (
  user_id UUID,
  display_name TEXT,
  avatar_url TEXT
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
    profiles.avatar_url
  FROM public.profiles AS profiles
  WHERE profiles.user_id = ANY(COALESCE(requested_user_ids, ARRAY[]::UUID[]));
$$;

REVOKE ALL ON FUNCTION public.get_chat_participant_identities(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_chat_participant_identities(UUID[]) TO authenticated;
