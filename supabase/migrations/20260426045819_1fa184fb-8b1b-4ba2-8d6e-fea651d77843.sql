-- Per-section structured feedback on generated plans
CREATE TABLE public.plan_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  section TEXT NOT NULL CHECK (section IN ('protocol','materials','budget','timeline','validation','safety','overall')),
  rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
  correction TEXT,
  domain TEXT,
  hypothesis_excerpt TEXT,
  owner_token TEXT,
  owner_user_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_plan_feedback_run ON public.plan_feedback(run_id);
CREATE INDEX idx_plan_feedback_domain ON public.plan_feedback(domain);
CREATE INDEX idx_plan_feedback_section ON public.plan_feedback(section);
CREATE INDEX idx_plan_feedback_created ON public.plan_feedback(created_at DESC);

ALTER TABLE public.plan_feedback ENABLE ROW LEVEL SECURITY;

-- Anyone holding the parent run's owner_token can insert feedback for that run.
CREATE POLICY "Anonymous owners can add feedback"
  ON public.plan_feedback FOR INSERT TO public
  WITH CHECK (
    owner_token IS NOT NULL
    AND owner_token = ((current_setting('request.headers', true))::json ->> 'x-owner-token')
    AND EXISTS (
      SELECT 1 FROM public.runs r
       WHERE r.id = run_id
         AND r.owner_token = owner_token
    )
  );

-- Anonymous owners can read their own feedback.
CREATE POLICY "Anonymous owners can view their feedback"
  ON public.plan_feedback FOR SELECT TO public
  USING (
    owner_token IS NOT NULL
    AND owner_token = ((current_setting('request.headers', true))::json ->> 'x-owner-token')
  );

-- Authenticated owners can insert feedback against their own runs.
CREATE POLICY "Authenticated owners can add feedback"
  ON public.plan_feedback FOR INSERT TO authenticated
  WITH CHECK (
    owner_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.runs r
       WHERE r.id = run_id
         AND r.owner_user_id = auth.uid()
    )
  );

-- Authenticated owners can view their own feedback.
CREATE POLICY "Authenticated owners can view their feedback"
  ON public.plan_feedback FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

-- Authenticated owners can delete their own feedback.
CREATE POLICY "Authenticated owners can delete their feedback"
  ON public.plan_feedback FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid());