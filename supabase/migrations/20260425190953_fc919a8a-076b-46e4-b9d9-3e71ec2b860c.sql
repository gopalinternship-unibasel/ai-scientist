CREATE TYPE public.run_status AS ENUM ('pending', 'qc', 'plan', 'done', 'failed');

CREATE TABLE public.runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_token TEXT,
  hypothesis TEXT NOT NULL,
  status public.run_status NOT NULL DEFAULT 'pending',
  qc JSONB,
  plan JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_runs_created_at ON public.runs (created_at DESC);
CREATE INDEX idx_runs_owner_token ON public.runs (owner_token) WHERE owner_token IS NOT NULL;

ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Runs are publicly viewable"
  ON public.runs FOR SELECT
  USING (true);

CREATE POLICY "Anyone can create a run"
  ON public.runs FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update a run"
  ON public.runs FOR UPDATE
  USING (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_runs_updated_at
  BEFORE UPDATE ON public.runs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.runs;
ALTER TABLE public.runs REPLICA IDENTITY FULL;