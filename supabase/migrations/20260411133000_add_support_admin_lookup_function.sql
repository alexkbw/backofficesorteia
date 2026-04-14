CREATE OR REPLACE FUNCTION public.get_support_admin_user_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT user_id
  FROM public.user_roles
  WHERE role = 'admin'
  ORDER BY user_id
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.get_support_admin_user_id() TO authenticated;
