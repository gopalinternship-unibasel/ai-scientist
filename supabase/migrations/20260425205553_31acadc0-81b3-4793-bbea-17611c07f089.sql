
-- Ensure realtime UPDATE payloads include the full row (needed for RunPage and MyRuns auto-refresh).
ALTER TABLE public.runs REPLICA IDENTITY FULL;

-- Helper: a signed-in user can claim runs they created anonymously by passing
-- the owner_token stored in their browser. Returns the count of runs claimed.
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

  UPDATE public.runs
     SET owner_user_id = auth.uid()
   WHERE owner_token = _owner_token
     AND owner_user_id IS NULL;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- Allow signed-in users to invoke the claim function from the client.
GRANT EXECUTE ON FUNCTION public.claim_anonymous_runs(text) TO authenticated;

-- Allow owners to update their runs (so the claim function works under their context).
-- Note: claim_anonymous_runs is SECURITY DEFINER so it bypasses RLS, but we also
-- want the runs table to support owner-scoped updates for future features.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='runs' AND policyname='Owners can update their runs'
  ) THEN
    CREATE POLICY "Owners can update their runs"
      ON public.runs FOR UPDATE
      TO authenticated
      USING (auth.uid() = owner_user_id)
      WITH CHECK (auth.uid() = owner_user_id);
  END IF;
END $$;

-- Background cleanup: prune rate_limit rows older than 24h so the table stays small.
CREATE OR REPLACE FUNCTION public.cleanup_old_rate_limits()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  DELETE FROM public.rate_limits WHERE created_at < now() - interval '24 hours';
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-old-rate-limits');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'cleanup-old-rate-limits',
  '17 3 * * *',
  $$ SELECT public.cleanup_old_rate_limits(); $$
);
