
-- 1) pgvector
create extension if not exists vector;

-- 2) embedding column on plan_feedback (768 dims = gemini text-embedding-004)
alter table public.plan_feedback
  add column if not exists embedding vector(768);

create index if not exists plan_feedback_embedding_idx
  on public.plan_feedback
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 50);

-- 3) similarity search function (security definer so anon/auth can use it
--    without needing direct select on every row; the function only returns
--    fields safe for prompt-injection use, never owner identifiers)
create or replace function public.match_plan_feedback(
  query_embedding vector(768),
  match_threshold float,
  match_count int
)
returns table (
  id uuid,
  section text,
  rating smallint,
  correction text,
  domain text,
  hypothesis_excerpt text,
  similarity float,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    pf.id,
    pf.section,
    pf.rating,
    pf.correction,
    pf.domain,
    pf.hypothesis_excerpt,
    1 - (pf.embedding <=> query_embedding) as similarity,
    pf.created_at
  from public.plan_feedback pf
  where pf.embedding is not null
    and pf.correction is not null
    and 1 - (pf.embedding <=> query_embedding) > match_threshold
  order by pf.embedding <=> query_embedding
  limit match_count;
$$;

revoke all on function public.match_plan_feedback(vector, float, int) from public;
grant execute on function public.match_plan_feedback(vector, float, int) to anon, authenticated, service_role;

-- 4) record which feedback rows were applied to each generated plan
alter table public.runs
  add column if not exists applied_feedback jsonb;
