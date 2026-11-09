-- QA round 2 (9 Nov 2026), two access-control defects in the feedback store.
--
-- 1. match_plan_feedback handed every user's corrections and private
--    hypothesis excerpts to anyone holding the public anon key.
--    The function is SECURITY DEFINER (it bypasses RLS) and has no owner
--    filter, and migration 20260426051728 granted EXECUTE to anon and
--    authenticated. A POST /rest/v1/rpc/match_plan_feedback with any vector
--    and match_threshold -1 returned all 18 embedded rows, 14 of them with
--    the first 500 characters of another user's private hypothesis, while a
--    direct anon SELECT on plan_feedback returned 0 rows.
--    Only the edge functions need it (run-experiment and eval-harness call it
--    with the service-role client), so EXECUTE now goes to service_role only.
--    The same applies to the other helpers that are meant for the server:
--    find_duplicate_feedback and bump_feedback_dup (embed-feedback, service
--    role), cleanup_stale_runs and cleanup_old_rate_limits (pg_cron, runs as
--    postgres) and the trigger function attribute_lesson_uplift.
--    Note: Supabase grants EXECUTE on every new function in `public` to anon
--    and authenticated directly, so the earlier `REVOKE ... FROM public`
--    statements never removed their access.
--
-- 2. Feedback authors could undo moderation and rig retrieval ranking, and
--    anonymous callers could bump any row.
--    anon and authenticated could UPDATE all 19 plan_feedback columns, so
--    the owner policies let an author PATCH their own row back to
--    hidden=false after a moderator hid it and set dup_count=100000,
--    uplift_sum, applications, embedding or created_at (dup_count multiplies
--    the retrieval score that decides which corrections reach other users'
--    planner prompts). bump_feedback_dup was callable with the anon key on
--    any row. Clients now write only the columns a person types:
--      INSERT: run_id, section, rating, correction, domain,
--              hypothesis_excerpt, owner_token, owner_user_id
--      UPDATE: rating, correction
--    Hiding and restoring a row goes through set_feedback_hidden(), which
--    checks the moderator/admin role. Editing a correction clears its
--    embedding in a trigger (the browser used to send embedding=null itself),
--    so embed-feedback re-embeds the new text.

-- 1 -------------------------------------------------------------------------
DO $$
DECLARE
  f record;
BEGIN
  -- Server-only helpers: edge functions (service role) and pg_cron (postgres).
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'match_plan_feedback', 'find_duplicate_feedback', 'bump_feedback_dup',
         'cleanup_stale_runs', 'cleanup_old_rate_limits', 'attribute_lesson_uplift'
       )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
  END LOOP;

  -- Signed-in helpers. Each checks auth.uid() or the moderator role itself;
  -- the anon key has no business calling them. has_role is only used by
  -- policies that apply TO authenticated.
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'recent_feedback_for_moderation', 'corrections_for_distillation', 'lesson_uplift_stats',
         'feedback_loop_stats', 'eval_summary', 'auto_demote_low_uplift_lessons',
         'bootstrap_first_admin', 'claim_anonymous_runs', 'has_role'
       )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f.sig);
  END LOOP;
END $$;

-- 2 -------------------------------------------------------------------------
REVOKE INSERT, UPDATE ON public.plan_feedback FROM anon, authenticated;
GRANT INSERT (run_id, section, rating, correction, domain, hypothesis_excerpt, owner_token, owner_user_id)
  ON public.plan_feedback TO anon, authenticated;
GRANT UPDATE (rating, correction) ON public.plan_feedback TO anon, authenticated;

-- A changed correction must be embedded again (its old vector would keep
-- matching the old text).
CREATE OR REPLACE FUNCTION public.plan_feedback_reset_embedding()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.correction IS DISTINCT FROM OLD.correction THEN
    NEW.embedding := NULL;
    NEW.embedded_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.plan_feedback_reset_embedding() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS plan_feedback_reset_embedding ON public.plan_feedback;
CREATE TRIGGER plan_feedback_reset_embedding
BEFORE UPDATE OF correction ON public.plan_feedback
FOR EACH ROW EXECUTE FUNCTION public.plan_feedback_reset_embedding();

-- Moderation: hide a correction from retrieval, or restore it.
CREATE OR REPLACE FUNCTION public.set_feedback_hidden(_id uuid, _hidden boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'moderator') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'forbidden: moderator role required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.plan_feedback SET hidden = _hidden WHERE id = _id;
  RETURN FOUND;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_feedback_hidden(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_feedback_hidden(uuid, boolean) TO authenticated, service_role;
