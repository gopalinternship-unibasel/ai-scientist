
alter table public.runs
  add column if not exists domain text;

create index if not exists runs_domain_idx on public.runs (domain) where domain is not null;
create index if not exists plan_feedback_section_domain_idx on public.plan_feedback (section, domain);
