# Running AI Scientist locally

The hosted backend this app was built on (Lovable Cloud project
`hdutcpduikzrrlisbker`) no longer exists, so the live site is gone. This
guide runs the whole system on one Windows PC instead:

- a local Supabase stack in Docker (Postgres with the 20 original
  migrations plus one new one, Auth, Realtime, REST, the edge-function
  runtime, Studio and a mail catcher),
- the five edge functions (`run-experiment`, `embed-feedback`,
  `distill-house-rules`, `eval-harness`, `backfill-feedback-embeddings`),
- the Vite + React frontend on http://localhost:5180,
- an OpenAI-compatible model server for every LLM and embedding call. The
  default is a local Ollama (free, no key); a hosted provider is one env
  change away (see "Switching the AI provider").

Follow the steps in order. Every command is for **PowerShell**, run from
the project folder (`C:\Users\gopal\Downloads\cv-project-fixes\ai-research-assistant`
on Gopal's PC).

## 1. Prerequisites

| Tool | Version used | Notes |
|---|---|---|
| Docker Desktop | 4.73 (engine 29.4) | Must be running. Give it at least 8 GB RAM. |
| Supabase CLI | 3.0.0 | On Gopal's PC it is `C:\Users\gopal\tools\supabase\supabase.exe` (not on PATH; the scripts find it there). Elsewhere: put `supabase` on PATH or set `$env:SUPABASE_CLI` to the full path. |
| Node.js | 20 or newer (24 used) | Runs Vite and the helper scripts. |
| bun | 1.3 | Installs dependencies (`bun install`; do not use `npm ci`). |
| Ollama | any recent | OpenAI-compatible API on `http://localhost:11434`. On Gopal's PC it is the shared Docker container `cvfix-ollama`. |

Ollama models (once):

```powershell
docker exec cvfix-ollama ollama pull qwen2.5:3b         # chat model (all roles)
docker exec cvfix-ollama ollama pull nomic-embed-text   # embeddings, 768 dimensions
# with a native Ollama install: ollama pull qwen2.5:3b ; ollama pull nomic-embed-text
```

The configured chat model is `qwen2.5-3b-4threads`: qwen2.5:3b with 4 CPU
threads and an 8192-token context (see "Known limits"). It shares the
qwen2.5:3b weights (no extra download), and `start-local.ps1` creates it
for you as soon as qwen2.5:3b is pulled. By hand it is:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:11434/api/create `
  -Body '{"model":"qwen2.5-3b-4threads","from":"qwen2.5:3b","parameters":{"num_thread":4,"num_ctx":8192},"stream":false}'
```

To use another Ollama model (for example `qwen2.5:7b`, better plans, about
2.5 times slower), create a variant of it the same way with
`"num_ctx":8192` and put its name in `AI_MODEL` in
`supabase\functions\.env`. Ollama's default context is 4096 tokens, which
a plan and its prompt do not fit in.

Ports used (all on localhost): Supabase API 54321, Postgres 54322, shadow
DB 54320, Studio 54323, Mailpit 54324, edge-function inspector 8083,
frontend 5180. Ollama 11434 is shared with other projects. Analytics (54327)
and the pooler (54329) are reserved but switched off.

## 2. One-time setup

```powershell
bun install
```

That is all. The first `start-local.ps1` run also:

- downloads the Supabase Docker images (several minutes),
- copies `supabase\functions\.env.example` to `supabase\functions\.env`
  (gitignored; the edge-function settings, local Ollama by default),
- applies the migrations,
- writes `.env.development.local` (gitignored) so the dev server talks to
  the local stack instead of the dead hosted project in the committed
  `.env`,
- creates two test accounts and writes them to `.local-test-user.json`
  (gitignored),
- creates the Ollama model `qwen2.5-3b-4threads` (when `qwen2.5:3b` is
  pulled).

## 3. Start

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1
```

It is safe to run repeatedly; it only starts what is not running yet. It
prints the URLs when done (about 1 minute once the images exist).

Options:

- `-RestartFunctions` reloads the edge functions after you edit code under
  `supabase\functions` or change `supabase\functions\.env`. This aborts runs
  in progress.
- `-Watch` keeps `supabase functions serve` running with hot reload while
  you develop functions. Do not use it for long runs: on Windows every NTFS
  last-access update under `supabase\functions` (a `git status`, a directory
  listing, a virus scan) counts as a change, restarts the runtime and kills
  every run in progress. Without `-Watch` the script stops the CLI watcher as
  soon as the runtime serves; the runtime container keeps running.
- `-NoFrontend` starts only the backend.

Why `functions serve --inspect-mode run`: the local edge runtime kills a
worker after 400 seconds of wall-clock time unless the inspector is on, and a
plan from a CPU-only local model takes much longer than that.

## 4. Use it

| What | URL |
|---|---|
| App | http://localhost:5180 |
| Supabase API / edge functions | http://127.0.0.1:54321 (`/functions/v1/<name>`) |
| Supabase Studio (database browser) | http://127.0.0.1:54323 |
| Mailpit (sign-up and reset emails land here) | http://127.0.0.1:54324 |

**Sign in.** Open http://localhost:5180/auth and use an account from
`.local-test-user.json`:

- `tester` is a normal account: own runs, share links, refinements,
  feedback, My runs, My feedback.
- `admin` holds the admin role: `/admin` (feedback moderation, house-rule
  distillation, eval harness).

You can also use the app without signing in (anonymous runs are tied to a
token in the browser and are claimed into your account when you sign in), or
create a new account on the "Create account" tab (no email confirmation is
needed locally).

**Generate a plan.** On the home page type a hypothesis or click one of the
four sample buttons. You land on the run page, which shows each stage as it
happens: hypothesis gate, literature search (Semantic Scholar, OpenAlex,
PubMed), novelty classification, then the plan streaming in (characters and
sections so far), then the reviewer critique. With the local CPU model a
complete run takes a long time (see "Known limits"); you can close the tab
and come back, the run continues on the server.

On a finished plan: **Save as PDF**, **Share** (signed-in owner; copies a
link with a share token that anyone can open read-only), **Refine** (creates
version 2, 3, ... linked to the original; the version switcher appears above
the plan), the star / pencil buttons on each section (feedback that future
plans learn from), and **My feedback** in the user menu.

A run that fails (for example because the model server was down) shows a
**Retry** button for its signed-in owner.

## 5. Stop

```powershell
powershell -ExecutionPolicy Bypass -File scripts\stop-local.ps1
```

Stops the dev server, any `functions serve` process and the project's
Supabase containers. Data stays in the Docker volumes; the next start resumes
where you left off. (Never use `supabase stop --no-backup`; it deletes the
data.)

## 6. Switching the AI provider

All model calls go through `supabase/functions/_shared/aiProvider.ts`, which
reads `supabase\functions\.env`. To use a hosted provider, edit that file
(comment out the local block, uncomment one hosted block from the template,
put your key in `AI_API_KEY`), then run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1 -RestartFunctions
```

| Setting | Meaning |
|---|---|
| `AI_BASE_URL` | OpenAI-compatible base URL. Local default `http://host.docker.internal:11434/v1` (Ollama as seen from the edge-runtime container). |
| `AI_API_KEY` | Bearer key (`LOVABLE_API_KEY` is still accepted). Ollama ignores it. |
| `AI_MODEL` | Model for every role. `AI_MODEL_PLAN`, `_FAST`, `_REASONING`, `_GATE`, `_DOMAIN`, `_DISTILL`, `_EVAL_PLAN`, `_JUDGE` override one role, as a comma-separated fallback chain. |
| `AI_STRUCTURED_OUTPUT` | `json_schema` for Ollama (grammar-constrained JSON), `tools` for providers that honour forced tool calls. |
| `AI_MAX_TOKENS_PARAM` | `max_tokens`, `max_completion_tokens` (OpenAI gpt-5 / o-series) or `none`. |
| `AI_MAX_TOKENS_CAP` | Upper bound on every output budget (3072 locally). Prompt + output must fit the model's context window: 8192 tokens for the local `qwen2.5-3b-4threads`. |
| `AI_COMPACT_OUTPUT` | `true` for small local models: lists capped at 5 items and text fields at 400 characters (both enforced by Ollama's JSON grammar, so a model stuck in a loop has to close the field), short answers requested, long prompt inputs (previous plan, plan under review) cut short. Set `false` for hosted models. |
| `AI_MIN_TIMEOUT_MS` | Floor for every per-call timeout (60 minutes locally, `0` for hosted). |
| `AI_EMBED_MODEL` | Embedding model (`nomic-embed-text` locally, natively 768-d). Empty switches embeddings off. |
| `AI_EMBED_BASE_URL`, `AI_EMBED_API_KEY` | Separate embeddings endpoint (for chat providers without one, for example the Hugging Face router or the Lovable gateway). |
| `AI_EMBED_DIMENSIONS` | `true` to request 768-d vectors from OpenAI / Gemini embedding models. |
| `FEEDBACK_MIN_SIMILARITY` | Cosine floor for retrieving past corrections (0.7 for nomic-embed-text). |

Ready-made blocks in `supabase\functions\.env.example`: OpenAI, Google Gemini
(OpenAI-compatible endpoint), Hugging Face router, and the original Lovable
AI gateway (restores the original Gemini / GPT-5 per-role routing when no
`AI_MODEL` is set). The embedding column is `vector(768)`, so any embedding
model must return 768 dimensions.

## 7. Tests

```powershell
# Frontend and shared client logic (Vitest, jsdom). Note: `bun run test`, not `bun test`.
bun run test

# Type check of the frontend
node node_modules\typescript\bin\tsc --noEmit -p tsconfig.app.json

# Edge-function tests (Deno). Deno is not needed on the host; this runs it in Docker:
docker run --rm -v "${PWD}:/app" -w /app -e DENO_DIR=/app/supabase/.temp/deno-cache denoland/deno:2.1.4 `
  deno test --allow-net --allow-env --allow-read --no-lock supabase/functions/_shared/ supabase/functions/run-experiment/

# Type check of every edge function entry point (same container)
docker run --rm -v "${PWD}:/app" -w /app -e DENO_DIR=/app/supabase/.temp/deno-cache denoland/deno:2.1.4 `
  deno check --no-lock supabase/functions/run-experiment/index.ts supabase/functions/eval-harness/index.ts `
  supabase/functions/distill-house-rules/index.ts supabase/functions/embed-feedback/index.ts `
  supabase/functions/backfill-feedback-embeddings/index.ts
```

(With Deno installed locally: `deno test --allow-net --allow-env --allow-read supabase/functions/_shared/ supabase/functions/run-experiment/`.)

Builds: `bun run build:dev` builds against the local stack
(`.env.development.local`); plain `bun run build` uses the committed `.env`,
which still points at the deleted hosted project.

## 8. Troubleshooting

| Symptom | Check |
|---|---|
| Run page stays on one stage | The run's `progress` and `error` columns (Studio, table `runs`) say where it is. `docker logs -f cvfix-ollama` shows the model server: a request is logged when it starts (`new prompt`) and when it finishes. Ollama runs one request at a time here, so other projects' requests queue in front of yours. `docker logs supabase_edge_runtime_ai-research-assistant` shows only runtime events (requests served, CPU or wall-clock limits); the functions' own `console.log` lines are not forwarded locally because analytics is off. |
| "CPU time hard limit reached" in the runtime log | The CPU patch is missing: run `start-local.ps1 -RestartFunctions`. |
| Run failed with "Run timed out - connection lost or generation stalled" | No heartbeat for 20 minutes: the runtime was restarted or stopped while the run was in progress. Press Retry. |
| Frontend talks to the dead hosted project | `.env.development.local` is missing: run `start-local.ps1` again (it rewrites the file). |
| Sign-in fails | `.local-test-user.json` is stale: `start-local.ps1` re-checks and recreates the test users. |
| Admin distillation / eval seem to do nothing | They run in the background; watch the runtime log for `distill_done` or new rows under Recent eval batches. |
| Ollama log shows `slot context shift` | The model's context window is too small for prompt + plan: Ollama drops the start of the prompt mid-answer and the plan loses its instructions. Use a model created with `"num_ctx":8192` (see Prerequisites); `start-local.ps1` fixes `qwen2.5-3b-4threads` itself. |

## 9. Known limits

- **Speed with the local model.** Ollama runs on the CPU only and is shared
  with other projects on this PC. Measured here on 9 Nov 2026 with
  `qwen2.5-3b-4threads`, while two other projects' pipelines and their own
  model requests ran (load average 10-21 on 8 cores): prompt processing 6-18
  tokens/s, generation 0.5-3 tokens/s. One hypothesis-gate call (300 prompt
  tokens, 81 output tokens) took 45 s to 3 min 16 s of model time; a new
  plan (2,300 prompt + 1,900 output tokens) 47 min; a refined plan (3,800 +
  1,900 tokens) 27 min; a critique (1,900 + 600 tokens) about 10 min. Ollama
  answers one request at a time, so every call also waits for the requests
  queued before it, other projects' included: the gate call above spent 17
  minutes in the queue. A complete run (gate, literature, novelty, plan,
  critique) took MEASURED_RUN. The README's "60-90 seconds" was measured on
  the hosted Gemini / GPT-5 models; switching `supabase\functions\.env` to a
  hosted provider brings that back. The pipeline itself has no deadline: the
  stall-cleanup job only fails a run after 20 minutes without a heartbeat,
  and the function sends one every 20 seconds.
- **Ollama thread count.** Ollama runs a model with one thread per CPU core
  (8 here). When the PC is busy those threads stall each other: in a test on
  9 Nov 2026 qwen2.5:3b generated 0.07 tokens/s with the default threads and
  0.34 tokens/s with 4. Ollama's OpenAI-compatible API cannot set the thread
  count per request, hence the `qwen2.5-3b-4threads` variant. Ollama keeps
  one model busy at a time here, so when another project uses plain
  `qwen2.5:3b` the two models are swapped in and out (about a minute each
  time) and each side waits for the other's requests.
- **Plan quality with qwen2.5:3b** is far below the hosted models the app was
  tuned for: shorter plans (compact mode caps every list at 5 items),
  plainer critiques, and the hypothesis gate and novelty classifier make
  more mistakes. Seen on 9 Nov 2026: a cryopreservation plan whose
  materials list was copied from the PCR examples in the cost catalog, and
  a distilled house rule copied from the distillation prompt's example. A
  plan can also fail with "Model returned malformed plan" when the model
  loops inside the JSON until the output budget runs out (one of three
  local plans that streamed to the end on 9 Nov 2026, before text fields
  were capped); Retry starts a fresh attempt.
  A larger model (for example a `qwen2.5:7b` variant with
  `"num_ctx":8192`) is better and about 2.5 times slower.
- **The edge runtime is patched at start.** `start-local.ps1` raises the
  CPU budget the Supabase CLI gives each function worker (1 s soft / 2 s
  hard over the worker's life) by editing the generated main service in the
  `supabase_edge_runtime_ai-research-assistant` container, and stops the
  CLI's file watcher. Both are needed for runs that last more than a few
  minutes. If a future CLI changes that file, the script warns and long runs
  will be killed again.
- **Restarting the functions aborts runs in progress.** `-RestartFunctions`,
  `-Watch`, `supabase stop` and a Docker restart all kill the background
  pipeline; those runs stay in `qc`/`plan` until the cleanup job marks them
  failed (within 25 minutes), and their owner gets a Retry button.
- **Live SKU check covers Sigma-Aldrich only**, through PubChem (Sigma's
  own search endpoint no longer accepts plain requests). A catalog number
  PubChem does not know (antibodies, kits, cell lines) is not flagged. Other
  suppliers rely on the format rules and the small canonical dictionary.
- **Scheduled jobs.** Locally pg_cron runs only the two jobs the migrations
  create (stale-run cleanup every 5 minutes, rate-limit cleanup daily). The
  hosted project's other schedules (nightly house-rule distillation,
  embedding backfill, eval harness, lesson auto-demotion) were never in the
  migrations; trigger them from `/admin` or by calling the functions.
- **Eval harness** (`/admin` -> Loop ops -> Run eval) generates two plans
  and two judge calls per hypothesis, for four hypotheses, in the
  background. On the local CPU model that is 8 plans and 8 judge calls, many
  hours of model time, so it was not run end to end here (its role checks
  were); use a hosted provider for it.
- **Anonymous rate-limit bucket.** Locally every browser on the PC reaches
  the function from the Docker gateway address, so all anonymous users share
  one bucket of 100 runs per hour (signed-in users each have their own).
- `bun test` (Bun's own runner) does not run these Vitest suites (no jsdom:
  the component tests fail with "localStorage is not defined"); use
  `bun run test`, as `.github/workflows/ci.yml` now does.

## 10. What only Gopal can do

- Provide a hosted API key (OpenAI, Gemini, Hugging Face or Lovable) if he
  wants plans in about a minute instead of hours; put it only in the
  gitignored `supabase\functions\.env`.
- Request a free Semantic Scholar API key
  (https://www.semanticscholar.org/product/api) and put it in
  `SEMANTIC_SCHOLAR_API_KEY` in `supabase\functions\.env`. Without one the
  shared anonymous pool answered HTTP 429 to every request on 9 Nov 2026, so
  literature QC ran on OpenAlex and PubMed only.
- Decide whether to keep the self-hosted changes on a branch or merge them,
  and push (nothing has been pushed).
- The original hosted project and the live site `ai-scientist.lovable.app`
  are gone; bringing them back needs his Lovable account.
