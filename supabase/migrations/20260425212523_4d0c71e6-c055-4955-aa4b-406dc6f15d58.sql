CREATE OR REPLACE FUNCTION public.cleanup_stale_runs()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  affected integer;
BEGIN
  UPDATE public.runs
     SET status = 'failed',
         error = COALESCE(error, 'Run timed out — connection lost or generation stalled.'),
         updated_at = now()
   WHERE status IN ('pending', 'qc', 'plan')
     AND updated_at < now() - interval '20 minutes';

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$function$;