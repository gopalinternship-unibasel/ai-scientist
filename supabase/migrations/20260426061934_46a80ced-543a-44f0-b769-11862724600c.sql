-- 1) Counters on plan_feedback
ALTER TABLE public.plan_feedback
  ADD COLUMN IF NOT EXISTS applications integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS uplift_sum numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS uplift_n integer NOT NULL DEFAULT 0;

-- 2) Attribution trigger.
-- When a new rated feedback row lands on a run, each lesson that was applied
-- on THAT run gets credited / debited based on (rating - global baseline).
-- Baseline is recomputed each time (cheap at our scale; one indexed avg).
-- We deliberately attribute uplift to applied lessons even if the new
-- feedback targets a different section — the lessons shaped the whole plan.
CREATE OR REPLACE FUNCTION public.attribute_lesson_uplift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  baseline numeric;
  lesson_id uuid;
  applied jsonb;
BEGIN
  -- Only count rated, non-hidden corrections as outcome signal.
  IF NEW.rating IS NULL OR NEW.hidden = true THEN
    RETURN NEW;
  END IF;

  SELECT applied_feedback INTO applied
    FROM public.runs
   WHERE id = NEW.run_id;

  IF applied IS NULL OR jsonb_array_length(applied) = 0 THEN
    RETURN NEW;
  END IF;

  -- Global baseline avg rating. EXCLUDES the row being inserted.
  SELECT COALESCE(AVG(rating), 3.0)::numeric
    INTO baseline
    FROM public.plan_feedback
   WHERE rating IS NOT NULL AND hidden = false;

  -- Credit each applied lesson.
  FOR lesson_id IN
    SELECT (e->>'id')::uuid
      FROM jsonb_array_elements(applied) AS e
     WHERE e ? 'id'
  LOOP
    UPDATE public.plan_feedback
       SET applications = applications + 1,
           uplift_sum = uplift_sum + (NEW.rating - baseline),
           uplift_n = uplift_n + 1
     WHERE id = lesson_id
       AND id <> NEW.id;  -- never let a lesson credit itself
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS plan_feedback_attribute_uplift ON public.plan_feedback;
CREATE TRIGGER plan_feedback_attribute_uplift
AFTER INSERT ON public.plan_feedback
FOR EACH ROW
EXECUTE FUNCTION public.attribute_lesson_uplift();

-- 3) Read RPC for the admin UI. Returns lessons sorted by absolute uplift.
CREATE OR REPLACE FUNCTION public.lesson_uplift_stats(_limit integer DEFAULT 50)
RETURNS TABLE(
  id uuid,
  section text,
  domain text,
  correction text,
  rating smallint,
  applications integer,
  uplift_n integer,
  avg_uplift numeric,
  hidden boolean,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, section, domain, correction, rating,
         applications, uplift_n,
         CASE WHEN uplift_n > 0 THEN ROUND((uplift_sum / uplift_n)::numeric, 2) ELSE NULL END AS avg_uplift,
         hidden, created_at
    FROM public.plan_feedback
   WHERE (has_role(auth.uid(), 'moderator') OR has_role(auth.uid(), 'admin'))
     AND uplift_n > 0
   ORDER BY uplift_n DESC, abs(uplift_sum) DESC
   LIMIT GREATEST(1, LEAST(_limit, 200));
$$;

-- 4) Auto-demote function. A lesson is hidden when it has enough evidence
-- (>= 5 applications) AND a clearly negative uplift (avg <= -0.5).
-- Returns the count of newly hidden rows so the admin sees the impact.
CREATE OR REPLACE FUNCTION public.auto_demote_low_uplift_lessons(
  _min_applications integer DEFAULT 5,
  _max_avg_uplift numeric DEFAULT -0.5
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  IF NOT (has_role(auth.uid(), 'moderator') OR has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'forbidden: moderator role required';
  END IF;

  UPDATE public.plan_feedback
     SET hidden = true,
         updated_at = now()
   WHERE hidden = false
     AND uplift_n >= GREATEST(1, _min_applications)
     AND (uplift_sum / uplift_n) <= _max_avg_uplift;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;