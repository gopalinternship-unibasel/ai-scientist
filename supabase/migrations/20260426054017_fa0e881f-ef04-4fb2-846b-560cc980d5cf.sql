-- Bootstrap helper: lets the very first user claim the admin role.
-- Refuses once any admin already exists, so this is a one-time door.
CREATE OR REPLACE FUNCTION public.bootstrap_first_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  existing_admins int;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'must be signed in';
  END IF;

  SELECT count(*) INTO existing_admins
    FROM public.user_roles
   WHERE role = 'admin';

  IF existing_admins > 0 THEN
    RETURN false;
  END IF;

  INSERT INTO public.user_roles (user_id, role)
       VALUES (uid, 'admin')
  ON CONFLICT DO NOTHING;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_first_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.bootstrap_first_admin() TO authenticated;