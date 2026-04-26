-- 1) Fix tautological INSERT policy on plan_feedback (anonymous owners)
DROP POLICY IF EXISTS "Anonymous owners can add feedback" ON public.plan_feedback;

CREATE POLICY "Anonymous owners can add feedback"
ON public.plan_feedback
FOR INSERT
TO public
WITH CHECK (
  owner_token IS NOT NULL
  AND owner_token = ((current_setting('request.headers', true))::json ->> 'x-owner-token')
  AND EXISTS (
    SELECT 1 FROM public.runs r
     WHERE r.id = plan_feedback.run_id
       AND r.owner_token = plan_feedback.owner_token
  )
);

-- 2) Lock down owner_token column on runs: revoke from anon/authenticated.
-- Service role retains access. Existing client code never selects this column.
REVOKE SELECT (owner_token) ON public.runs FROM anon, authenticated;

-- 3) Harden Realtime authorization policies on realtime.messages.
-- Replace permissive ELSE true wildcards and verify owner_token for anon runs:%.
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT polname FROM pg_policy
     WHERE polrelid = 'realtime.messages'::regclass
  LOOP
    EXECUTE format('DROP POLICY %I ON realtime.messages', pol.polname);
  END LOOP;
END $$;

-- Anonymous: may subscribe to runs:<id> ONLY when the run's owner_token
-- matches the requester's x-owner-token header. Everything else: deny.
CREATE POLICY "Anonymous can subscribe to own run channels"
ON realtime.messages
FOR SELECT
TO anon
USING (
  CASE
    WHEN (realtime.topic()) LIKE 'runs:%' THEN EXISTS (
      SELECT 1 FROM public.runs r
       WHERE r.id::text = split_part(realtime.topic(), ':', 2)
         AND r.owner_token IS NOT NULL
         AND r.owner_token = ((current_setting('request.headers', true))::json ->> 'x-owner-token')
    )
    ELSE false
  END
);

-- Authenticated: may subscribe to runs:<id> when they own the run
-- (owner_user_id) OR they hold the matching anon owner_token. Else deny.
CREATE POLICY "Authenticated can subscribe to own run channels"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  CASE
    WHEN (realtime.topic()) LIKE 'runs:%' THEN EXISTS (
      SELECT 1 FROM public.runs r
       WHERE r.id::text = split_part(realtime.topic(), ':', 2)
         AND (
           r.owner_user_id = auth.uid()
           OR (
             r.owner_token IS NOT NULL
             AND r.owner_token = ((current_setting('request.headers', true))::json ->> 'x-owner-token')
           )
         )
    )
    ELSE false
  END
);