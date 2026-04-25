-- 1. Add share_token column for opt-in link sharing
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS share_token text;
CREATE INDEX IF NOT EXISTS idx_runs_share_token ON public.runs(share_token) WHERE share_token IS NOT NULL;

-- 2. Idempotency lookup: find an in-flight run for the same hypothesis quickly
CREATE INDEX IF NOT EXISTS idx_runs_hypothesis_hash_status ON public.runs(hypothesis_hash, status);

-- 3. Replace the "publicly viewable" policy with owner / share-token / owner-token scoped reads.
DROP POLICY IF EXISTS "Runs are publicly viewable" ON public.runs;

-- 3a. Authenticated users see their own runs (already exists "Owners can view their runs", keep it)
-- 3b. Anyone with the run's share_token (passed via request header) can view it.
DROP POLICY IF EXISTS "Anyone with share token can view run" ON public.runs;
CREATE POLICY "Anyone with share token can view run"
ON public.runs
FOR SELECT
TO public
USING (
  share_token IS NOT NULL
  AND share_token = current_setting('request.headers', true)::json->>'x-share-token'
);

-- 3c. Anonymous browser sessions can read runs they created via their browser's owner_token.
DROP POLICY IF EXISTS "Anonymous owners can view their runs" ON public.runs;
CREATE POLICY "Anonymous owners can view their runs"
ON public.runs
FOR SELECT
TO public
USING (
  owner_token IS NOT NULL
  AND owner_token = current_setting('request.headers', true)::json->>'x-owner-token'
);