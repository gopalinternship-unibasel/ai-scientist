-- QA round 1 (9 Nov 2026), two access-control defects.
--
-- 1. Cross-user plan-cache poisoning.
--    "Owners can update their runs" (migration 20260425205553) let a
--    signed-in owner UPDATE every column of their own runs. A second user
--    rewrote hypothesis, hypothesis_hash, plan and status of a run they
--    owned, and the next user who submitted that hypothesis was served the
--    injected plan as a cache hit (run-experiment reads any finished run
--    with a matching hash, whoever owns it). Only edge functions (service
--    role) create and fill runs; the browser's single legitimate write is
--    the share token (RunPage onShare). So clients keep UPDATE on
--    share_token only, and lose INSERT / UPDATE / DELETE on everything else
--    (RLS already denied INSERT and DELETE; this makes it explicit).
--
-- 2. A rotated anonymous owner token still read claimed runs.
--    claim_anonymous_runs set owner_user_id but left owner_token, and the
--    "Anonymous owners can view their runs" policy matched on the token
--    alone, so the pre-sign-up token kept reading the runs after they moved
--    to the account (src/lib/owner.ts rotates it precisely to stop that).
--    Token access now applies only to runs (and feedback) that no account
--    owns, claiming clears the token and also claims the anonymous feedback
--    written on those runs, and existing account-owned rows drop theirs.
--    run-experiment no longer stores the browser token on a signed-in
--    user's run.

-- 1 -------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.runs FROM anon, authenticated;
GRANT UPDATE (share_token) ON public.runs TO authenticated;

-- 2 -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anonymous owners can view their runs" ON public.runs;
CREATE POLICY "Anonymous owners can view their runs"
ON public.runs
FOR SELECT
TO public
USING (
  owner_user_id IS NULL
  AND owner_token IS NOT NULL
  AND owner_token = current_setting('request.headers', true)::json->>'x-owner-token'
);

DROP POLICY IF EXISTS "Anonymous owners can view their feedback" ON public.plan_feedback;
CREATE POLICY "Anonymous owners can view their feedback"
  ON public.plan_feedback FOR SELECT TO public
  USING (
    owner_user_id IS NULL
    AND owner_token IS NOT NULL
    AND owner_token = ((current_setting('request.headers', true))::json ->> 'x-owner-token')
  );

DROP POLICY IF EXISTS "Anonymous owners can update their feedback" ON public.plan_feedback;
CREATE POLICY "Anonymous owners can update their feedback"
ON public.plan_feedback FOR UPDATE TO public
USING (
  owner_user_id IS NULL
  AND owner_token IS NOT NULL
  AND owner_token = ((current_setting('request.headers', true))::json ->> 'x-owner-token')
)
WITH CHECK (
  owner_user_id IS NULL
  AND owner_token IS NOT NULL
  AND owner_token = ((current_setting('request.headers', true))::json ->> 'x-owner-token')
);

DROP POLICY IF EXISTS "Anonymous owners can delete their feedback" ON public.plan_feedback;
CREATE POLICY "Anonymous owners can delete their feedback"
ON public.plan_feedback FOR DELETE TO public
USING (
  owner_user_id IS NULL
  AND owner_token IS NOT NULL
  AND owner_token = ((current_setting('request.headers', true))::json ->> 'x-owner-token')
);

DROP POLICY IF EXISTS "Anonymous owners can add feedback" ON public.plan_feedback;
CREATE POLICY "Anonymous owners can add feedback"
ON public.plan_feedback
FOR INSERT
TO public
WITH CHECK (
  owner_user_id IS NULL
  AND owner_token IS NOT NULL
  AND owner_token = ((current_setting('request.headers', true))::json ->> 'x-owner-token')
  AND EXISTS (
    SELECT 1 FROM public.runs r
     WHERE r.id = plan_feedback.run_id
       AND r.owner_user_id IS NULL
       AND r.owner_token = plan_feedback.owner_token
  )
);

DROP POLICY IF EXISTS "Anonymous can subscribe to own run channels" ON realtime.messages;
CREATE POLICY "Anonymous can subscribe to own run channels"
ON realtime.messages
FOR SELECT
TO anon
USING (
  CASE
    WHEN (realtime.topic()) LIKE 'runs:%' THEN EXISTS (
      SELECT 1 FROM public.runs r
       WHERE r.id::text = split_part(realtime.topic(), ':', 2)
         AND r.owner_user_id IS NULL
         AND r.owner_token IS NOT NULL
         AND r.owner_token = ((current_setting('request.headers', true))::json ->> 'x-owner-token')
    )
    ELSE false
  END
);

DROP POLICY IF EXISTS "Authenticated can subscribe to own run channels" ON realtime.messages;
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
             r.owner_user_id IS NULL
             AND r.owner_token IS NOT NULL
             AND r.owner_token = ((current_setting('request.headers', true))::json ->> 'x-owner-token')
           )
         )
    )
    ELSE false
  END
);

CREATE OR REPLACE FUNCTION public.claim_anonymous_runs(_owner_token text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 0;
  END IF;
  IF _owner_token IS NULL OR length(_owner_token) < 8 OR length(_owner_token) > 100 THEN
    RETURN 0;
  END IF;

  -- Feedback first: it is matched through the runs that are being claimed.
  UPDATE public.plan_feedback f
     SET owner_user_id = auth.uid(),
         owner_token = NULL
   WHERE f.owner_token = _owner_token
     AND f.owner_user_id IS NULL
     AND EXISTS (
       SELECT 1 FROM public.runs r
        WHERE r.id = f.run_id
          AND r.owner_token = _owner_token
          AND r.owner_user_id IS NULL
     );

  UPDATE public.runs
     SET owner_user_id = auth.uid(),
         owner_token = NULL
   WHERE owner_token = _owner_token
     AND owner_user_id IS NULL;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- Rows an account already owns do not need (and must not keep) a browser token.
UPDATE public.runs SET owner_token = NULL WHERE owner_user_id IS NOT NULL AND owner_token IS NOT NULL;
UPDATE public.plan_feedback SET owner_token = NULL WHERE owner_user_id IS NOT NULL AND owner_token IS NOT NULL;
