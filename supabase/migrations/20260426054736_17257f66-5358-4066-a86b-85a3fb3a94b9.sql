
-- House rules: distilled per-domain wisdom that survives even when individual
-- corrections decay or get deduped away. Replaces nothing; sits alongside
-- per-query feedback retrieval.
CREATE TABLE public.domain_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL,
  rule text NOT NULL,
  -- How many corrections this rule was synthesised from. Higher = more trusted.
  source_count integer NOT NULL DEFAULT 1,
  -- 0..1 — model's self-rated confidence at distillation time.
  confidence numeric(3,2) NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  -- When superseded by a newer batch we mark it inactive instead of deleting,
  -- so we can audit how the house rules drifted over time.
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_domain_rules_domain_active
  ON public.domain_rules (domain, active)
  WHERE active = true;

ALTER TABLE public.domain_rules ENABLE ROW LEVEL SECURITY;

-- Anyone can READ active house rules — they're meant to be transparent.
CREATE POLICY "Anyone can view active house rules"
  ON public.domain_rules FOR SELECT
  USING (active = true);

CREATE POLICY "Moderators can view all house rules"
  ON public.domain_rules FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'moderator') OR has_role(auth.uid(), 'admin'));

CREATE POLICY "Moderators can manage house rules"
  ON public.domain_rules FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'moderator') OR has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'moderator') OR has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_domain_rules_updated_at
  BEFORE UPDATE ON public.domain_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Eval harness: nightly LLM-judge scoring across a frozen hypothesis suite,
-- run twice per hypothesis (with vs without feedback retriever) so we can plot
-- the delta over time. Without this, every prompt change is vibes-based.

CREATE TABLE public.eval_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- A label tying together all rows from one harness invocation.
  batch_id uuid NOT NULL,
  hypothesis text NOT NULL,
  -- 'with_feedback' | 'without_feedback'
  arm text NOT NULL CHECK (arm IN ('with_feedback', 'without_feedback')),
  -- 0..10 from the LLM judge across rubric dimensions.
  score_specificity smallint,
  score_sku smallint,
  score_timeline smallint,
  score_feasibility smallint,
  -- Average across rubrics, computed at write-time for cheap dashboards.
  score_overall numeric(4,2),
  judge_notes text,
  -- Useful to spot-check what the planner produced.
  plan_excerpt text,
  applied_lesson_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_eval_runs_batch ON public.eval_runs (batch_id, created_at DESC);
CREATE INDEX idx_eval_runs_arm_created ON public.eval_runs (arm, created_at DESC);

ALTER TABLE public.eval_runs ENABLE ROW LEVEL SECURITY;

-- Eval results are admin/mod-only by default — they include LLM scores that
-- are noisy and shouldn't be presented as authoritative to end users.
CREATE POLICY "Moderators can view eval runs"
  ON public.eval_runs FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'moderator') OR has_role(auth.uid(), 'admin'));

CREATE POLICY "Moderators can manage eval runs"
  ON public.eval_runs FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'moderator') OR has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'moderator') OR has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- Helper: feed the distillation edge function a slim, security-defined list
-- of corrections for a given domain. Excludes hidden rows and respects the
-- moderator gate.
CREATE OR REPLACE FUNCTION public.corrections_for_distillation(_domain text, _limit integer DEFAULT 200)
RETURNS TABLE(id uuid, section text, correction text, rating smallint, dup_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, section, correction, rating, dup_count
    FROM public.plan_feedback
   WHERE domain = _domain
     AND hidden = false
     AND correction IS NOT NULL
     AND length(correction) >= 8
     AND (has_role(auth.uid(), 'moderator') OR has_role(auth.uid(), 'admin'))
   ORDER BY (1 + ln(1 + dup_count)) DESC, created_at DESC
   LIMIT GREATEST(1, LEAST(_limit, 500));
$$;

REVOKE ALL ON FUNCTION public.corrections_for_distillation(text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.corrections_for_distillation(text, integer) TO authenticated;

-- Helper for the eval-harness summary panel.
CREATE OR REPLACE FUNCTION public.eval_summary(_limit integer DEFAULT 5)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'moderator') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'forbidden: moderator role required';
  END IF;

  WITH recent_batches AS (
    SELECT batch_id, max(created_at) AS ts
      FROM public.eval_runs
     GROUP BY batch_id
     ORDER BY ts DESC
     LIMIT GREATEST(1, LEAST(_limit, 50))
  ),
  per_batch AS (
    SELECT
      e.batch_id,
      max(e.created_at) AS ts,
      avg(e.score_overall) FILTER (WHERE arm = 'with_feedback') AS avg_with,
      avg(e.score_overall) FILTER (WHERE arm = 'without_feedback') AS avg_without,
      count(*) FILTER (WHERE arm = 'with_feedback') AS n_with,
      count(*) FILTER (WHERE arm = 'without_feedback') AS n_without
    FROM public.eval_runs e
    JOIN recent_batches rb ON rb.batch_id = e.batch_id
    GROUP BY e.batch_id
  )
  SELECT jsonb_agg(
           jsonb_build_object(
             'batch_id', batch_id,
             'ts', ts,
             'avg_with', round(coalesce(avg_with, 0)::numeric, 2),
             'avg_without', round(coalesce(avg_without, 0)::numeric, 2),
             'n_with', n_with,
             'n_without', n_without
           ) ORDER BY ts DESC
         )
    INTO result
    FROM per_batch;

  RETURN coalesce(result, '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.eval_summary(integer) FROM public;
GRANT EXECUTE ON FUNCTION public.eval_summary(integer) TO authenticated;
