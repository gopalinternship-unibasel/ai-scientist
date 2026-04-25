
-- Required extensions for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Index to make the stale-run scan fast
CREATE INDEX IF NOT EXISTS idx_runs_status_updated_at
  ON public.runs (status, updated_at)
  WHERE status IN ('pending', 'qc', 'plan');

-- Helper function: mark stuck runs as failed
CREATE OR REPLACE FUNCTION public.cleanup_stale_runs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.runs
     SET status = 'failed',
         error = COALESCE(error, 'Run timed out — connection lost or generation stalled.'),
         updated_at = now()
   WHERE status IN ('pending', 'qc', 'plan')
     AND updated_at < now() - interval '10 minutes';

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- Schedule: every 5 minutes (idempotent — drop existing first)
DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-stale-runs');
EXCEPTION WHEN OTHERS THEN
  -- not scheduled yet, ignore
  NULL;
END;
$$;

SELECT cron.schedule(
  'cleanup-stale-runs',
  '*/5 * * * *',
  $$ SELECT public.cleanup_stale_runs(); $$
);
