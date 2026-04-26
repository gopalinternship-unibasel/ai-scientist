-- 1) Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- has_role helper (SECURITY DEFINER avoids recursive RLS)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = _user_id AND role = _role
  );
$$;

-- Users see their own roles; admins see all
CREATE POLICY "Users can view their own roles"
ON public.user_roles FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage roles"
ON public.user_roles FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2) Moderators can hide feedback
CREATE POLICY "Moderators can update any feedback"
ON public.plan_feedback FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'moderator') OR public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'moderator') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Moderators can view all feedback"
ON public.plan_feedback FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'moderator') OR public.has_role(auth.uid(), 'admin'));

-- 3) Active solicitation: which section should we ask the user about
ALTER TABLE public.runs
  ADD COLUMN IF NOT EXISTS solicit_section text,
  ADD COLUMN IF NOT EXISTS solicit_reason text;

-- 4) Embedding retry telemetry
ALTER TABLE public.plan_feedback
  ADD COLUMN IF NOT EXISTS embedding_attempts smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS embedded_at timestamptz;

-- 5) Stats RPC for the dashboard. Returns a single jsonb blob — keeps the
-- client → server roundtrips down and lets us evolve the shape without a
-- schema migration. Restricted to moderators/admins via has_role.
CREATE OR REPLACE FUNCTION public.feedback_loop_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'moderator') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'forbidden: moderator role required';
  END IF;

  WITH
    feedback_overview AS (
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE embedding IS NOT NULL)::int AS embedded,
        count(*) FILTER (WHERE embedding IS NULL)::int AS pending,
        count(*) FILTER (WHERE hidden = true)::int AS hidden_count,
        avg(rating)::numeric(4,2) AS avg_rating,
        sum(GREATEST(dup_count - 1, 0))::int AS dedup_hits
      FROM public.plan_feedback
    ),
    by_section AS (
      SELECT jsonb_object_agg(
        section,
        jsonb_build_object('count', cnt, 'avg_rating', avg_r)
      ) AS sections
      FROM (
        SELECT section, count(*)::int AS cnt, avg(rating)::numeric(4,2) AS avg_r
          FROM public.plan_feedback
         WHERE hidden = false
         GROUP BY section
      ) s
    ),
    by_domain AS (
      SELECT jsonb_object_agg(COALESCE(domain, 'unknown'), cnt) AS domains
      FROM (
        SELECT domain, count(*)::int AS cnt
          FROM public.plan_feedback
         WHERE hidden = false
         GROUP BY domain
         ORDER BY cnt DESC
         LIMIT 15
      ) d
    ),
    runs_overview AS (
      SELECT
        count(*) FILTER (WHERE status = 'done')::int AS total_done,
        count(*) FILTER (WHERE had_applied_feedback = true)::int AS with_lessons
      FROM public.runs
    ),
    impact AS (
      -- Average rating of subsequent feedback grouped by whether the run
      -- it landed on had any lessons applied. This is the headline metric
      -- for "is the loop actually working".
      SELECT
        avg(pf.rating) FILTER (WHERE r.had_applied_feedback = true)::numeric(4,2) AS avg_with,
        avg(pf.rating) FILTER (WHERE r.had_applied_feedback = false)::numeric(4,2) AS avg_without,
        count(pf.id) FILTER (WHERE r.had_applied_feedback = true)::int AS n_with,
        count(pf.id) FILTER (WHERE r.had_applied_feedback = false)::int AS n_without
      FROM public.plan_feedback pf
      JOIN public.runs r ON r.id = pf.run_id
      WHERE pf.rating IS NOT NULL
    )
  SELECT jsonb_build_object(
    'feedback', (SELECT row_to_json(feedback_overview)::jsonb FROM feedback_overview),
    'by_section', (SELECT sections FROM by_section),
    'by_domain', (SELECT domains FROM by_domain),
    'runs', (SELECT row_to_json(runs_overview)::jsonb FROM runs_overview),
    'impact', (SELECT row_to_json(impact)::jsonb FROM impact)
  ) INTO result;

  RETURN result;
END;
$$;

-- 6) RPC to list recent feedback for the moderation queue (RLS-aware,
-- but moderators see everything thanks to the policies above).
CREATE OR REPLACE FUNCTION public.recent_feedback_for_moderation(_limit integer DEFAULT 50)
RETURNS TABLE(
  id uuid,
  run_id uuid,
  section text,
  rating smallint,
  correction text,
  domain text,
  hidden boolean,
  dup_count integer,
  created_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, run_id, section, rating, correction, domain, hidden, dup_count, created_at
    FROM public.plan_feedback
   WHERE has_role(auth.uid(), 'moderator') OR has_role(auth.uid(), 'admin')
   ORDER BY created_at DESC
   LIMIT GREATEST(1, LEAST(_limit, 200));
$$;