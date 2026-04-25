-- 1. Extend runs table
ALTER TABLE public.runs
  ADD COLUMN IF NOT EXISTS owner_user_id uuid,
  ADD COLUMN IF NOT EXISTS hypothesis_hash text,
  ADD COLUMN IF NOT EXISTS critique jsonb;

CREATE INDEX IF NOT EXISTS idx_runs_owner_user_id ON public.runs(owner_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_hypothesis_hash_done
  ON public.runs(hypothesis_hash)
  WHERE status = 'done' AND hypothesis_hash IS NOT NULL;

-- 2. Rate limit table
CREATE TABLE IF NOT EXISTS public.rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup
  ON public.rate_limits(identifier, kind, created_at DESC);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- No client-facing policies: only service role (edge functions) reads/writes rate_limits.

-- 3. Update RLS on runs to allow owners to see their own runs (in addition to public read)
DROP POLICY IF EXISTS "Owners can view their runs" ON public.runs;
CREATE POLICY "Owners can view their runs"
  ON public.runs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = owner_user_id);