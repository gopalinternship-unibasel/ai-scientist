# Contributing to AI Scientist

Thanks for your interest in improving AI Scientist! This document covers how
to set up the project locally, the conventions we follow, and how to get a
change merged.

## Ground rules

- **Be kind.** See [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).
- **Small PRs win.** One concern per PR. If a refactor is needed, land it
  in its own PR before the feature.
- **Tests are non-negotiable for shared logic.** Anything in
  `supabase/functions/_shared/` or `src/lib/` must ship with tests.
- **No fabricated data.** This project's whole premise is that we don't
  hallucinate. Don't add fixtures with fake DOIs, fake catalog numbers, or
  fake citations.

## Local setup

You'll need [Bun](https://bun.sh) (or npm) and [Deno](https://deno.com) for
edge-function tests.

```bash
bun install
bun run dev          # http://localhost:8080
bun test             # frontend + lib (Vitest)

# Edge functions
deno test --allow-net --allow-env supabase/functions/
```

`.env` is auto-managed by Lovable Cloud and is required for the dev server
to talk to the backend. If you're working purely on UI, the published
backend at `ai-scientist.lovable.app` is fine.

## Project layout

See [`README.md`](./README.md#project-structure) for the full tour. In
short:

- `src/` — React 18 + Vite + Tailwind frontend
- `supabase/functions/` — Deno edge functions
  - `_shared/` — pure logic, the heart of the deterministic guards
  - `run-experiment/` — the SSE pipeline
- `supabase/migrations/` — schema, RLS, helper SQL functions

## Conventions

### TypeScript

- Strict mode. No `any` without a comment explaining why.
- Prefer discriminated unions over optional flags.
- Frontend components live in `src/components/`; pure logic in `src/lib/`.

### Styling

- **Always** use semantic Tailwind tokens defined in `index.css` and
  `tailwind.config.ts`. Never hard-code colors like `text-white` or
  `bg-black` in components.
- All custom colors must be defined as HSL CSS variables.
- Use `shadcn/ui` primitives where they exist; extend via variants, not
  by forking.

### Edge functions

- Pure logic goes in `_shared/` with a co-located `*.test.ts`.
- Network calls go through `_shared/fetch-with-retry.ts`.
- AI calls go through `_shared/ai-fallback.ts` so model fallback works
  consistently.
- Never log PII or full hypotheses at info level — they may contain
  unpublished research.

### Database

- All schema changes go through migrations (`supabase/migrations/`).
- RLS is mandatory on every new table.
- Roles live in `user_roles`, never on `profiles` or in JWT claims —
  see the security note in `README.md`.

## Pull request checklist

Before opening a PR, make sure:

- [ ] `bun test` passes
- [ ] `deno test` passes for any edge function changes
- [ ] New shared logic has tests
- [ ] No new ESLint warnings (`bun run lint`)
- [ ] No hard-coded colors in new components
- [ ] If you touched the planner/critique prompt or schema, you ran
      a few sample hypotheses end-to-end
- [ ] If you touched RLS, you verified the policy from both an
      authenticated and an anonymous client

## Filing issues

- **Bugs:** include the run ID (visible in the URL on `/runs/:id`),
  the hypothesis, and what you expected vs. what happened.
- **Feature requests:** describe the user problem first, the proposed
  solution second.
- **Security issues:** see [`SECURITY.md`](./SECURITY.md) — please don't
  file these as public issues.

## Releasing

The published app at [ai-scientist.lovable.app](https://ai-scientist.lovable.app)
deploys automatically from `main` via Lovable's GitHub sync. Edge functions
deploy on push. There is no manual release step.

Thanks for contributing!
