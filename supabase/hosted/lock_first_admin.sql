-- Switches the "Claim first admin" door off, for the HOSTED Supabase project only.
--
-- bootstrap_first_admin() gives the admin role to the first signed-in account that asks while no
-- admin exists. That is convenient on a private local stack. On a public site it means any
-- visitor could take the role before the owner does. Run this file once on the hosted project
-- (SQL Editor, or `supabase db query --remote -f supabase/hosted/lock_first_admin.sql`).
-- It is not a migration, so the local stack keeps the claim button.
--
-- Safe to run twice.

revoke execute on function public.bootstrap_first_admin() from authenticated;
revoke execute on function public.bootstrap_first_admin() from anon;
revoke execute on function public.bootstrap_first_admin() from public;

-- Check: all three must be false.
select has_function_privilege('authenticated', 'public.bootstrap_first_admin()', 'execute') as authenticated_may_claim,
       has_function_privilege('anon', 'public.bootstrap_first_admin()', 'execute') as anon_may_claim,
       (select count(*) from public.user_roles where role = 'admin') as admins;

-- To make one account admin afterwards (the account must exist: sign up on the site first), run
-- this as the project owner with the account's address in place of the placeholder:
--
--   insert into public.user_roles (user_id, role)
--   select id, 'admin' from auth.users where email = 'ADDRESS_OF_THE_ACCOUNT'
--   on conflict (user_id, role) do nothing;
