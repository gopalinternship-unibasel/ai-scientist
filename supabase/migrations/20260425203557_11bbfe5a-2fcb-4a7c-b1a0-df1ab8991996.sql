
ALTER TABLE public.runs
  ADD COLUMN parent_run_id uuid REFERENCES public.runs(id) ON DELETE SET NULL,
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN refinement_instruction text;

CREATE INDEX idx_runs_parent ON public.runs(parent_run_id);
CREATE INDEX idx_runs_owner_user ON public.runs(owner_user_id, created_at DESC);
