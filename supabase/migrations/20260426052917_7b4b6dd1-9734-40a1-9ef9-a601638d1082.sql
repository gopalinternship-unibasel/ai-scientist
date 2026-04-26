-- Schema additions already applied successfully on the previous run, but
-- IF NOT EXISTS makes this idempotent so re-running is safe.
ALTER TABLE public.plan_feedback
  ADD COLUMN IF NOT EXISTS dup_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.runs
  ADD COLUMN IF NOT EXISTS had_applied_feedback boolean NOT NULL DEFAULT false;

DROP TRIGGER IF EXISTS plan_feedback_set_updated_at ON public.plan_feedback;
CREATE TRIGGER plan_feedback_set_updated_at
BEFORE UPDATE ON public.plan_feedback
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP POLICY IF EXISTS "Authenticated owners can update their feedback" ON public.plan_feedback;
CREATE POLICY "Authenticated owners can update their feedback"
ON public.plan_feedback FOR UPDATE TO authenticated
USING (owner_user_id = auth.uid())
WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS "Anonymous owners can update their feedback" ON public.plan_feedback;
CREATE POLICY "Anonymous owners can update their feedback"
ON public.plan_feedback FOR UPDATE TO public
USING (
  owner_token IS NOT NULL
  AND owner_token = ((current_setting('request.headers', true))::json ->> 'x-owner-token')
)
WITH CHECK (
  owner_token IS NOT NULL
  AND owner_token = ((current_setting('request.headers', true))::json ->> 'x-owner-token')
);

DROP POLICY IF EXISTS "Anonymous owners can delete their feedback" ON public.plan_feedback;
CREATE POLICY "Anonymous owners can delete their feedback"
ON public.plan_feedback FOR DELETE TO public
USING (
  owner_token IS NOT NULL
  AND owner_token = ((current_setting('request.headers', true))::json ->> 'x-owner-token')
);

-- Recreate matcher with `extensions` on the search_path so <=> resolves.
CREATE OR REPLACE FUNCTION public.match_plan_feedback(
  query_embedding extensions.vector,
  match_threshold double precision,
  match_count integer
)
RETURNS TABLE(
  id uuid,
  section text,
  rating smallint,
  correction text,
  domain text,
  hypothesis_excerpt text,
  similarity double precision,
  created_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = extensions, public
AS $$
  -- cosine × exp(-age_days/365) × (1 + ln(1+dup_count)/4)
  -- 1-year-old → ~37%; 5 duplicates → ~1.45× boost.
  select
    pf.id,
    pf.section,
    pf.rating,
    pf.correction,
    pf.domain,
    pf.hypothesis_excerpt,
    (
      (1 - (pf.embedding <=> query_embedding))
      * exp( - extract(epoch from (now() - pf.created_at)) / (365.0 * 86400.0) )
      * (1 + ln(1 + pf.dup_count) / 4.0)
    ) as similarity,
    pf.created_at
  from public.plan_feedback pf
  where pf.embedding is not null
    and pf.correction is not null
    and pf.hidden = false
    and (1 - (pf.embedding <=> query_embedding)) > match_threshold
  order by similarity desc
  limit match_count;
$$;

CREATE OR REPLACE FUNCTION public.find_duplicate_feedback(
  _id uuid,
  _section text,
  _domain text,
  _embedding extensions.vector,
  _threshold double precision DEFAULT 0.92
)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = extensions, public
AS $$
  select pf.id
  from public.plan_feedback pf
  where pf.id <> _id
    and pf.embedding is not null
    and pf.section = _section
    and (_domain is null or pf.domain is null or pf.domain = _domain)
    and (1 - (pf.embedding <=> _embedding)) >= _threshold
  order by pf.embedding <=> _embedding
  limit 1;
$$;

CREATE OR REPLACE FUNCTION public.bump_feedback_dup(_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  update public.plan_feedback
     set dup_count = dup_count + 1,
         updated_at = now()
   where id = _id;
$$;