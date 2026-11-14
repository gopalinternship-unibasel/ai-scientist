# Running AI Scientist locally

The hosted backend this app was built on (Lovable Cloud project
`hdutcpduikzrrlisbker`) no longer exists, so the live site is gone. This
guide runs the whole system on one Windows PC instead:

- a local Supabase stack in Docker (Postgres with the 20 original
  migrations plus three new ones, Auth, Realtime, REST, the edge-function
  runtime, Studio and a mail catcher),
- the five edge functions (`run-experiment`, `embed-feedback`,
  `distill-house-rules`, `eval-harness`, `backfill-feedback-embeddings`),
- the Vite + React frontend on http://localhost:5180,
- an OpenAI-compatible model server for every LLM and embedding call. The
  default is a local Ollama (free, no key); a hosted provider is one env
  change away (see "Switching the AI provider").

To put the app on the internet instead, see section 11, "Live deployment".

Follow the steps in order. Every command is for **PowerShell**, run from
the project folder.

## 1. Prerequisites

| Tool | Version used | Notes |
|---|---|---|
| Docker Desktop | 4.73 (engine 29.4) | Must be running. Give it at least 8 GB RAM. |
| Supabase CLI | 3.0.0 | On the development PC it is `%USERPROFILE%\tools\supabase\supabase.exe` (not on PATH; the scripts find it there). Elsewhere: put `supabase` on PATH or set `$env:SUPABASE_CLI` to the full path. |
| Node.js | 20 or newer (24 used) | Runs Vite and the helper scripts. |
| bun | 1.3 | Installs dependencies (`bun install`; do not use `npm ci`). |
| Ollama | any recent | OpenAI-compatible API on `http://localhost:11434`. On the development PC it is the shared Docker container `cvfix-ollama`. |

Ollama models (once):

```powershell
docker exec cvfix-ollama ollama pull qwen2.5:7b         # chat model (all roles), 4.7 GB
docker exec cvfix-ollama ollama pull nomic-embed-text   # embeddings, 768 dimensions
# with a native Ollama install: ollama pull qwen2.5:7b ; ollama pull nomic-embed-text
```

The configured chat model is `qwen2.5-7b-4threads`: qwen2.5:7b with 4 CPU
threads and an 8192-token context (see "Known limits"). It shares the
qwen2.5:7b weights (no extra download), and `start-local.ps1` creates it
for you as soon as qwen2.5:7b is pulled. By hand it is:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:11434/api/create `
  -Body '{"model":"qwen2.5-7b-4threads","from":"qwen2.5:7b","parameters":{"num_thread":4,"num_ctx":8192},"stream":false}'
```

It needs about 6 GB of RAM while loaded. Until 10 Nov 2026 the default was
the smaller `qwen2.5-3b-4threads` (from `qwen2.5:3b`, 1.9 GB, about 2.5 GB
loaded): faster, but its plans were wrong far more often (section 6,
"Choosing the local model"). To use it, or any other Ollama model, create a
variant the same way with `"num_ctx":8192` and put its name in `AI_MODEL`
in `supabase\functions\.env`. Ollama's default context is 4096 tokens,
which a plan and its prompt do not fit in.

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
- creates the Ollama model `qwen2.5-7b-4threads` (when `qwen2.5:7b` is
  pulled).

A `supabase\functions\.env` made before 10 Nov 2026 still names
`qwen2.5-3b-4threads`: change its `AI_MODEL` line by hand (the script never
overwrites that file) and run `start-local.ps1 -RestartFunctions`.

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

There is no "Continue with Google" button locally. It goes through Lovable
Cloud's OAuth broker (`/~oauth/initiate` on the site's own origin), which
exists only on a Lovable-hosted site; self-hosted it opened the app's 404
page. A build for Lovable hosting shows it again with
`VITE_LOVABLE_OAUTH=true`.

**Generate a plan.** On the home page type a hypothesis or click one of the
four sample buttons. You land on the run page, which shows each stage as it
happens: hypothesis gate, literature search (Semantic Scholar, OpenAlex,
PubMed), novelty classification, then the plan streaming in (characters and
sections so far), then the reviewer critique. With the local CPU model a
complete run takes a long time (see "Known limits"); you can close the tab
and come back, the run continues on the server.

On a finished plan: **Save as PDF** (the plan and its numbered references),
**Share** (signed-in owner; copies a link with a share token that anyone can
open read-only, signed in or not; share-link viewers get no Refine or
feedback buttons), **Refine** (creates version 2, 3, ... linked to the
version it was made from; a refinement of a refinement works the same way,
and the new number is always one above the highest in the whole chain. The
version switcher above the plan lists every version of the chain on every
version's page, says "from v1" for a branch, labels failed versions, and
changed sections are marked "Modified" against the version that was
refined), the star / pencil buttons on each section (feedback that
future plans learn from: the planner retrieves similar past corrections by
embedding, and an admin can distil them into house rules), and
**My feedback** in the user menu.

A run that fails (for example because the model server was down) shows a
**Retry** button for its signed-in owner.

**Novelty verdict.** The literature search sends each source the full
hypothesis and keyword queries built from what the hypothesis is about
(`supabase/functions/_shared/hypothesisTerms.ts`: cell line, compound,
acronyms, topic nouns, weighted; comparators such as "matching ELISA
sensitivity" count less), and ranks the papers by how much of the hypothesis
they cover. The AI classifier's verdict is then checked against those papers
(`noveltyVerdict.ts`): "not found" while an on-topic paper was retrieved
becomes "similar", "exact match" needs a paper that names the hypothesis'
core, the overlap label follows the verdict, and off-topic papers are not
shown as references. A corrected verdict says so in its rationale, and the
run's `qc.classifier_signal` keeps what the classifier said. The
textbook-technique rule (PCR, Western blot, ELISA, ... are "exact match")
applies only to hypotheses that ask for the technique itself, not to claims
that use it as a readout or comparator.

Since QA round 3 (10 Nov 2026) two more things happen before anything is
shown or cited:

- **Related-work filter.** Each candidate's title and abstract is embedded
  together with the hypothesis by the local `nomic-embed-text` (the model the
  feedback loop already uses) and dropped unless it is within 0.15 cosine of
  the best candidate and above 0.66 (`supabase/functions/_shared/embeddingRelevance.ts`;
  `LIT_EMBED_MARGIN`, `LIT_EMBED_MIN_SIMILARITY`). The classifier sees only
  the rest, so a paper that merely shares "NAD+" and "NADH" with the
  hypothesis (the NMN run's 1974 hydrogenase paper) is never a reference or
  a protocol source. `qc.related_filter` lists what was dropped. An "exact
  match" now also needs a cosine of at least 0.78 to the hypothesis.
- **Versioned cache.** The cache key is the hypothesis together with the
  pipeline version (`_shared/pipelineVersion.ts`, now 4), so a plan or
  verdict made before the current checks is never replayed: the first
  request for such a hypothesis computes a fresh run, which becomes the new
  cache entry. Runs made by an older pipeline keep what they stored; their
  page says "Made by an earlier version" and offers **Run again with the
  current checks**. (Their verdict is still re-checked on the page against
  the references they stored, as before.) A refinement of such a run does
  not copy its verdict and references: it searches the literature again,
  so the new version is checked by the current rules throughout.
- **"Similar" needs a paper to show.** When the classifier answers
  "similar" but every paper it points to shares next to nothing with the
  hypothesis, the stored verdict is "not found" and says so.

**Automated checks.** Before a plan is saved (and again before a cached plan
is served) deterministic checks run on it (`supabase/functions/_shared/planIntegrity.ts`,
`planGuards.ts` and `planContentChecks.ts`). "Fixed" findings were corrected
by the check; "Check" findings are for the reader:

| Check | What happens |
|---|---|
| Protocol sources (Fixed) | A step's source is kept only when it is one of the references the literature search returned (matched by `[N]`, URL, DOI or title) and is then shown as `[N] title (year)`. Any other URL, DOI, PMID or author-year citation is removed, also from step text. Plain labels such as "manufacturer's instructions" stay. The note says how many were removed and no longer repeats the removed link. |
| Catalog numbers (Fixed / Check) | Every catalog number gets a status, shown in the materials table (Cat # column) and the PDF. **Removed** (Fixed): it belongs to another product (the SKU dictionary, or Sigma-Aldrich's catalogue looked up through PubChem: Metformin "T9531" is trehalose, "Sodium butyrate" with D8418 is DMSO), or no catalogue confirmed it and it does not fit the supplier's format or looks like a placeholder ("S1000", "A1000", "T1000"). **Corrected** (Fixed): a cell line from the app's ATCC list (25 common lines, each pair checked against PubMed Central) gets ATCC's number (Caco-2 "CCL-22" becomes HTB-37; a missing one is filled in). Only the plain line: a sub-line or an engineered line (Vero E6, HeLa S3, HepG2/C3A, "HEK293 stably expressing GFP") has its own number and is left alone. **Verified**: confirmed by that list, the dictionary or the PubChem lookup, where the catalogue's name must be the same product as the material's name: two thirds of their words in common, or one of the names PubChem lists for that compound ("Metformin" with D150959, which Sigma calls "1,1-Dimethylbiguanide hydrochloride"); a named salt is not confirmed by the acid's number. **Unverified** (Check): every other number: Sigma numbers PubChem does not know, numbers found under a name that only partly fits (the reason then quotes Sigma's name: "Sodium palmitate" with P0500 is listed as "Palmitic acid"), and every supplier without a searchable catalogue; the table labels them "unverified" with the reason on hover. A status the model writes into its own plan is ignored. Plans saved before 10 Nov 2026 have no status, so all their numbers show as unverified. The planner prompt says which suppliers can be checked. |
| Budget (Fixed) | A materials line below the materials table subtotal is raised to the subtotal; the total is set to the sum of the line items, and the Budget card says what the model's own total was. A materials line far above the table is flagged. |
| Materials (Check) | High severity when the materials do not name at least 40% of what the hypothesis is about (its cell line, compound, named measurands, by weight), and when the protocol uses the hypothesis' compound, cell line or readout reagent but the materials leave it out ("The protocol uses palmitate, Oil Red O staining, but the materials table does not list them"). Medium for other reagents the protocol uses but the table does not list (PBS, BSA, DMSO, Transwell inserts, ...), and for materials that match cost-catalog items from topics the hypothesis does not mention. |
| Doses (Check) | High severity when the protocol gives the hypothesis' substance a concentration that is not within 1.5x of the hypothesis' dose ("10 mM metformin" for a 10 uM hypothesis). Units are read in any case and with any micro sign ("0.5 MM", "1 ΜM", "10 µM"); a lower-case unit that is really a length or a time ("510 nm", "0.22 um filter", "35 mm dish", "2 pm") is not a dose. The substance is also found by its bracketed acronym (NMN), dilutions are worked out to their final concentration ("100 uL of 10 mM NMN to 10 mL medium" is about 99 uM, and the 10 mM it starts from is not the dose), a dose series or range that contains the hypothesis' dose passes ("0, 1, 10 and 100 uM", "1-100 uM"), and a treatment step counts before an assay-buffer step. Stock solutions are not counted. Medium when a dilution does not give the concentration the step states ("10 uL of 10 mM into 990 uL ... a 10 uM working solution" is 100 uM). |
| Readout (Check) | High when no protocol step does the measurement the hypothesis names ("measured by Oil Red O staining"). Medium when the hypothesis is about intracellular levels but the protocol measures the culture supernatant and never lyses the cells. |
| Suppliers (Check) | Medium when a material comes from a specialist supplier that does not sell that kind of item (antibodies from IDT, blood from Addgene). |
| Protocol steps (Check) | High severity when at least half of the steps are only material lists. Medium when the protocol's step durations add up to more than the timeline, and when step durations are far longer than the work their text describes ("2 weeks" for "Incubate for 24 h"; steps that run "until ..." or repeat are not compared). |
| Budget caps (Check) | High when the hypothesis itself states a budget cap ("with a total budget under $5,000", "the budget is capped at $5,000", "without exceeding a budget of 5000 dollars") and the total is above it. The finding names the line items and the excess. |
| Refinement limits (Check) | A budget cap or timeline cap in the instruction is sent to the model as a hard limit and checked on the new plan. The budget cap is read from ordinary wording: "under $3,000", "The budget should be $3,000 or less.", "Total budget: $3,000 maximum.", "I only have $3,000 for this.", "The budget is 3000 dollars.", "3 000 USD", "$3.000", "three thousand dollars", a share of the refined plan ("cut the budget by 30%", "halve the budget", "cut the budget in half"), and another currency ("under CHF 3,000": the number is compared as US dollars and the finding says so). "Make it cheaper" or "reduce the budget" without a figure means the total must come out below the plan it refines. A timeline cap is read the same way ("8 weeks", "within 2 months", "2 weeks or less", "within one month", "no longer than 3 weeks", "a 2-week study", "halve the timeline"). What is NOT a limit on the whole plan: the price of one item ("an antibody under $300", "the antibody budget is $500", "$50 per sample"), something that describes the plan as it is ("the current budget is $16,647", "... is too high"), a floor or a permission ("a minimum budget of $5,000", "the budget may exceed $3,000"), and the duration of one step ("incubate for 2 weeks at most", "dose the mice for 4 weeks"). When a message states the budget and then asks for another figure ("The budget is $16,647. Reduce it to $5,000."), the figure that is asked for counts. The reader was reviewed against its predecessor on 175 instructions and 30 hypotheses on 11 Nov 2026 and corrected (`planChecksRound5.test.ts`). The checks: the budget against the total (the finding names the line items and the excess), the timeline against the phases and against the protocol step durations. Only a limit on the whole plan counts: "Extend the treatment to 2 weeks" or "Shorten the staining to 2 days" is not a timeline cap, and "raise n to 12" is not a budget. A limit holds for later refinements of the same chain too (v2 "under $3,000", then v3 "shorten the timeline to 2 weeks": v3 is still checked against $3,000, and the finding says "An earlier refinement of this plan asked for ..."), until a refinement states a new number or gives it up ("ignore the budget", "increase the budget", "extend the timeline", "take as long as needed"). |

A plan with a high-severity finding (materials, missing compound / cell line /
readout reagent, missing readout step, doses, material-list steps, budget
caps, refinement limits) is generated once more with the findings spelled
out (`PLAN_REPAIR_ATTEMPTS`), and the better of the two is kept. What the
second attempt still gets wrong stays on the plan as a "Check" finding.

Findings appear in an **Automated checks** box above the plan and on the PDF
cover page, and the reviewer critique receives them as high-severity
findings (the "Fixed" ones are not sent: they are already corrected). A
cached plan with a high-severity finding is not replayed: the request
generates a fresh plan, which becomes the new cache entry; a replayed copy
keeps the corrections made when the plan was first saved. The plan view and
PDF apply the source and budget checks to plans saved before these checks
existed too. Before generation, house rules that share no specific
term with the hypothesis are left out of the prompt, and the cost catalog
shows only its topic groups that fit the hypothesis.

**Who may write what.** The browser can read runs (its own, or one it has a
share link for) but write only one column: `share_token`, through the owner's
Share button. Everything else in `runs` is written by the edge functions with
the service role (migration `20261109200000`), so no user can plant a plan in
the shared cache. Anonymous access by owner token covers only runs and
feedback that no account owns; signing up claims both and clears the token.
Feedback (migration `20261110090000`): the owner inserts the typed columns
and may later change only `rating` and `correction` (a changed correction is
embedded again); `hidden` is set only through `set_feedback_hidden()`, which
checks the moderator/admin role (the Admin page's Hide / Restore buttons);
`dup_count`, the uplift counters, `embedding` and timestamps are written by
the server. The similarity search over everyone's corrections
(`match_plan_feedback`), the dedup helpers and the cleanup jobs can be called
only with the service role (edge functions, pg_cron), not with the public
anon key. `embed-feedback` works only for the feedback's owner (or a moderator/admin);
`backfill-feedback-embeddings` only for a moderator/admin or the service
role, for example from PowerShell:

```powershell
$svc = (& "$env:USERPROFILE\tools\supabase\supabase.exe" status -o env | Select-String '^SERVICE_ROLE_KEY=').ToString().Split('=',2)[1].Trim('"')
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:54321/functions/v1/backfill-feedback-embeddings -Headers @{ Authorization = "Bearer $svc" }
```

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
| `AI_STRUCTURED_OUTPUT` | `json_schema` for Ollama (grammar-constrained JSON), `tools` for providers that honour forced tool calls, `tools_required` for providers that accept `tool_choice` none, auto or required but not a named function (only the wanted tool is sent, with `required`). |
| `AI_MAX_TOKENS_PARAM` | `max_tokens`, `max_completion_tokens` (OpenAI gpt-5 / o-series) or `none`. |
| `AI_MAX_TOKENS_CAP` | Upper bound on every output budget (3072 locally). Prompt + output must fit the model's context window: 8192 tokens for the local `qwen2.5-7b-4threads`. |
| `AI_COMPACT_OUTPUT` | `true` for small local models: lists capped at 5 items and text fields at 400 characters (both enforced by Ollama's JSON grammar, so a model stuck in a loop has to close the field), short answers requested, long prompt inputs (previous plan, plan under review) cut short. Set `false` for hosted models. |
| `AI_MIN_TIMEOUT_MS` | Floor for every per-call timeout, including the time a call waits in the Ollama queue (2 hours locally since 10 Nov 2026, `0` for hosted). A call that runs out of it fails the run as `TIMEOUT` (Retry). An existing `supabase\functions\.env` keeps its old value: edit it and run `start-local.ps1 -RestartFunctions`. |
| `AI_EMBED_MODEL` | Embedding model (`nomic-embed-text` locally, natively 768-d). Empty switches embeddings off. |
| `AI_EMBED_BASE_URL`, `AI_EMBED_API_KEY` | Separate embeddings endpoint (for chat providers without one, for example the Hugging Face router or the Lovable gateway). |
| `AI_EMBED_DIMENSIONS` | `true` to request 768-d vectors from OpenAI / Gemini embedding models. |
| `FEEDBACK_MIN_SIMILARITY` | Cosine floor for retrieving past corrections (0.7 for nomic-embed-text). The lessons tooltip shows that cosine; the rating-weighted ranking value is stored separately (`applied_feedback[].score`). |
| `LIT_EMBED_MARGIN`, `LIT_EMBED_MIN_SIMILARITY` | Related-work filter (defaults 0.15 and 0.66, measured for nomic-embed-text): a literature candidate is kept when its embedding is within the margin of the best candidate and above the floor. Another embedding model needs its own values. |
| `AI_MODEL_FAST`, `AI_MODEL_GATE` | Commented out in the template: `qwen2.5-3b-4threads` for the short calls only (gate, novelty classifier) while the 7B model writes the plan. Faster, but two models are then loaded (about 8 GB instead of 6) and the 3B classifier is the one that called an opposing paper an "exact match". |
| `PLAN_REPAIR_ATTEMPTS` | `1` (default): a plan with a high-severity finding (a refinement or budget limit not met, materials that do not fit, a changed dose, a missing readout) is generated once more; `0` turns that off (saves one plan's model time). |

Ready-made blocks in `supabase\functions\.env.example`: OpenAI, Google Gemini
(OpenAI-compatible endpoint), Hugging Face router, and the original Lovable
AI gateway (restores the original Gemini / GPT-5 per-role routing when no
`AI_MODEL` is set). The embedding column is `vector(768)`, so any embedding
model must return 768 dimensions.

### Choosing the local model

The default local model is `qwen2.5-7b-4threads`. It was chosen on 10 Nov
2026 on what the two candidates got right, not on speed. Both were given
the app's own gate, novelty and planner prompts with the same retrieved
papers (harness `model-compare.ts`, raw outputs `compare-3b.json` and
`compare-7b.json` in `_e2e/ai-research-assistant-fix/round4/`, a folder kept outside this
repository), the 3B model's six QA round-3 runs through the app were added, and
every plan was scored by the current automated checks
(`round5/evaluate-compare.ts`, output `evaluate-compare.out.json`):

| | `qwen2.5-3b-4threads` | `qwen2.5-7b-4threads` |
|---|---|---|
| Plans scored | 8 (2 from the harness, 6 QA runs) | 4 (all from the harness) |
| Plans with a high-severity finding | 7 of 8 | 2 of 4 |
| High-severity findings in all | 16 | 2 |
| What they were | materials from another experiment or without the compound (2 plans), compound / cell line / readout reagent used but not listed (7), dose 10 to 500 times off the hypothesis (2), no readout step (1), budget limit not met (3), timeline limit not met (1) | budget limit not met: $13,590 for "under $3,000", with the model's own total written as $1,998 (1); the NAD/NADH assay kit used but not listed (1) |
| Doses as in the hypothesis | 6 of 8 plans | 4 of 4 |
| Invented catalog numbers | 5 in one plan (S1000, A1000, T1000, E1000, and CCL-22 for Caco-2) | none: it left the field empty, as the prompt asks when it does not know the number |
| Novelty classifier, before the automatic correction | metformin: "not found" although three on-topic papers were retrieved; butyrate: "exact match", quoting a paper as reporting "a 25% or greater increase in TEER" when its title says butyrate makes the monolayer leaky | metformin and butyrate: "similar", citing the right papers; NMN: "not found" (corrected to "similar" by the check) |
| Speed in the harness (Ollama's own timing, other projects idle or nearly) | prompt 17-33 tokens/s, generation 2.3-6.5 tokens/s; a plan of 1,620 tokens 6.6 min | prompt 7-11 tokens/s, generation 3.1-3.6 tokens/s; plans of 1,450-1,820 tokens 9.3-12.5 min; gate 16-56 s; novelty call 3-5 min |
| Memory while loaded | about 2.5 GB | about 6 GB |

The 3B harness run has only the metformin case: it was stopped before its
butyrate and NMN plans (its metformin plan alone took 2 h 26 min of wall
time, nearly all of it waiting behind another project's requests), which
is why the QA runs stand in for them. "Doses as in the hypothesis" counts
the plans the dose check did not flag. Four 7B plans are a small sample; the difference in kind (no invented
numbers, no changed doses, no missing readout) is what decided it.

The 7B model is slower: about twice the time for a complete run (see
"Known limits"). `AI_MODEL=qwen2.5-3b-4threads` in
`supabase\functions\.env` brings the faster model back; the checks flag
what it gets wrong, they do not make it right.

## 7. Tests

```powershell
# Frontend and shared client logic (Vitest, jsdom). Note: `bun run test`, not `bun test`.
bun run test

# Type check of the frontend
node node_modules\typescript\bin\tsc --noEmit -p tsconfig.app.json

# Lint (0 errors required; CI fails on any error, warnings are allowed)
bun run lint

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

Measured on 14 Nov 2026 after the live-deployment changes: Vitest 24 files / 97 tests, Deno 205 tests,
ESLint 0 errors (9 warnings), `tsc` and `deno check` clean.

Measured on 11 Nov 2026 after the QA round-4 fixes and their review: Vitest 22 files / 90
tests, Deno 186 tests, ESLint 0 errors (9 warnings), `tsc` and `deno check`
clean. The plan checks have their own Deno suites built from the QA's
failing plans (`supabase/functions/_shared/planGuards.test.ts` for round 1,
`planChecksRound2.test.ts` for round 2), and the literature queries and the
novelty verdict check are tested in `novelty.test.ts`, the critique clean-up in `critiqueGuards.test.ts`. The access rules of
migration `20261110090000` are not covered by these unit tests; they were
checked against the running stack with the scripts in
`_e2e/ai-research-assistant-fix/round3/`, a folder kept outside this repository (`01-feedback-security.mjs`).

Builds: `bun run build:dev` builds against the local stack
(`.env.development.local`); plain `bun run build` uses the committed `.env`,
which still points at the deleted hosted project.

## 8. Troubleshooting

| Symptom | Check |
|---|---|
| Run page stays on one stage | The run's `progress` and `error` columns (Studio, table `runs`) say where it is. `docker logs -f cvfix-ollama` shows the model server: a request is logged when it starts (`new prompt`) and when it finishes. Ollama runs one request at a time here, so other projects' requests queue in front of yours. `docker logs supabase_edge_runtime_ai-research-assistant` shows only runtime events (requests served, CPU or wall-clock limits); the functions' own `console.log` lines are not forwarded locally because analytics is off. |
| "CPU time hard limit reached" in the runtime log | The CPU patch is missing: run `start-local.ps1 -RestartFunctions`. |
| `permission denied for table runs` (HTTP 403) when a script or the browser writes `runs` | Intended: clients may only set `share_token` (migration `20261109200000`). Write runs through the edge functions, or as the service role. |
| `embed-feedback` or `backfill-feedback-embeddings` answers 401/403 | Intended for callers who do not own the feedback; see "Who may write what" in section 4. |
| `permission denied for function match_plan_feedback` (or `bump_feedback_dup`, `cleanup_stale_runs`, ...) | Intended: those RPCs are for the service role only (migration `20261110090000`). Call them with the service-role key, as the edge functions do. |
| `permission denied for table plan_feedback` when a client PATCHes `hidden`, `dup_count` or `embedding` | Intended: clients may change only `rating` and `correction`; moderators use `set_feedback_hidden`. |
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
  plan (2,300 prompt + 1,900 output tokens) 13 to 47 min; a refined plan
  (3,800 + 1,900 tokens) 27 to 31 min; a critique (1,900 + 600 tokens) 8 to
  15 min. Ollama answers one request at a time, so every call also waits
  for the requests queued before it, other projects' included: the gate call
  above spent 17 minutes in the queue. A complete run (gate, literature,
  novelty, plan, critique) took 31 minutes with an almost empty queue (run
  02d13270: gate 1 min, literature and novelty 3 min, plan 13 min, critique
  15 min) and 2 hours while other projects kept the model busy (run
  c1314d1a). The README's "60-90 seconds" was measured on
  the hosted Gemini / GPT-5 models; switching `supabase\functions\.env` to a
  hosted provider brings that back. The pipeline itself has no deadline: the
  stall-cleanup job only fails a run after 20 minutes without a heartbeat,
  and the function sends one every 20 seconds.
  Later on 9 Nov 2026 (QA round-2 fixes, CPU load 94%, other projects
  sharing Ollama): generation 3.4-5.7 tokens/s and prompt processing about
  20 tokens/s with `qwen2.5-3b-4threads`. The filtered cost catalog shrank
  the planner prompt from about 2,300 to 1,739 tokens. Run 633e1d4f took
  14 minutes end to end (gate, literature and novelty 2.5 min, plan about
  9 min, critique 3 min); two runs that shared the queue took 21 minutes
  each, and a refinement that needed the second attempt 16 minutes.
  `qwen2.5:7b` measured 5.6 prompt and 1.15 generated tokens/s on the same
  load, about three times slower.
  After the QA round-2 fixes (9-10 Nov 2026, around midnight; host CPU
  95-96%, 2 GB of host RAM free, other projects' `llama3.1:8b`,
  `qwen2.5:7b` and `qwen2.5-7b-4threads` loaded in the same Ollama, 12 GB of
  its 15 GB): the CRP-biosensor run 739dddf1 saved its plan after 23 minutes
  and its critique after 56; the metformin run 78967afc, queued behind it,
  saved its plan after 56 minutes and was complete after 61. Gate about 1
  minute, literature search 15-20 s, the novelty call 3-8 minutes with the
  queue. The CRP plan itself: 2,275 prompt tokens at 10.5 tokens/s, 1,702
  generated tokens at 2.6 tokens/s (14.5 minutes); critiques ran at 0.7-1.0
  generated tokens/s while the other projects' 7B/8B models were busy. A
  cache hit (same hypothesis) answered in under a second. Later (00:00-00:50
  UTC, host CPU at 100%, another project's `qwen2.5-7b-4threads` generating
  at the same time) the refinement "Shorten the overall timeline to 2
  weeks." of 78967afc (run af633061) streamed its first plan at about 75
  characters a minute (roughly 0.4 generated tokens/s) and needed 65 minutes
  for it; the timeline check flagged 3+ weeks against the 2 asked and the
  automatic second attempt started, which was stopped there rather than
  waited for. Two runs queued behind it (the budget refinement c4aec570 and
  an NMN run) waited 60 minutes for their first model call and failed at the
  then 60-minute `AI_MIN_TIMEOUT_MS`, recorded as "Internal error"; such a
  failure is now a `TIMEOUT` with a Retry button, and the local floor is 2
  hours. These times are set by the shared CPU, not by the pipeline; the
  only lever on this PC is a smaller or a hosted model.
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
  more mistakes. Before the QA round-1 fixes, plans copied their materials
  from the PCR examples of the cost catalog, pasted house rules from an
  unrelated trehalose study, cited invented URLs and ignored refinement
  limits. After them (runs of 9 Nov 2026, evening):
  - the QA's own NR / NAD+ hypothesis (run 5330844e) and a new NMN one
    (633e1d4f) got materials that fit (the compound, SH-SY5Y cells, culture
    media, an NAD+ assay kit in the first), no unrelated house rules and no
    invented sources;
  - the model's budget total was wrong in all three local plans (corrected
    to the line-item sum), and one plan priced its materials at $109,403
    against a $1,635 materials line (flagged, not fixable without a model);
  - "Keep the total budget under $3,000." was first ignored outright (the
    old $17,355 budget copied, run f6ad46e3, flagged). With the old amounts
    hidden from the refinement prompt and one automatic second attempt,
    the next try (run 41cff2b1) cut the budget to $3,132 at the first
    attempt and $3,165 at the second: close to the cap but over it, with
    "$3,000" written as the total and labour of $1,000 for two full-time
    people. The plan is saved with "Check: ... One automatic second attempt
    did not fix it." The small model follows the instruction now but cannot
    do the arithmetic; the checks say so instead of hiding it;
  - the reviewer critique repeats an injected past correction as a concern
    even when the plan already follows it (run 633e1d4f).
  After the QA round-2 fixes the checks catch the remaining wrong content
  instead of letting it through: a protocol dose that differs from the
  hypothesis' dose (v3's "10 mM metformin" for 10 uM), material-list steps,
  materials that leave out the compound and cell line (the independent run
  a60e2fa8), catalog numbers copied onto the wrong product (removed), a
  materials line below the materials table (raised), unlikely suppliers
  (antibodies from IDT, blood from Addgene in run 739dddf1). The three
  high-severity ones get the automatic second attempt. The new metformin
  plan 78967afc (prompt without example SKUs, "use the hypothesis' doses")
  had action steps at the hypothesis' 10 uM and 0.5 mM, the compound, cell
  line and stain in its materials, and no catalog numbers; its materials
  line ($100 against a $775 table) was raised. Still model-made and not
  caught: every protocol step citing the same retrieved paper, $0 equipment
  or overhead lines, and suppliers that are merely odd (Thermo for
  everything). The critic still invents things; concerns that claim a
  controlled substance the plan does not have or name catalog numbers that
  are not in the plan are now dropped (`critique.removed_concerns`), and
  looping phrases are collapsed.
  A plan can also fail with "Model returned malformed plan" when the model
  loops inside the JSON until the output budget runs out (one of three
  local plans that streamed to the end on 9 Nov 2026, before text fields
  were capped); Retry starts a fresh attempt. `AI_MODEL_PLAN=qwen2.5-7b-4threads`
  (see `.env.example`) gives the planner the larger model at about a third
  of the speed; it was not run end to end here.
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
- **Literature APIs are best-effort.** On 9 Nov 2026 Semantic Scholar
  answered 429 to every anonymous request (a free key fixes that, see
  below) and OpenAlex rate-limited anonymous search for minutes at a time
  ("temporarily rate-limited while the search cluster is under elevated
  load"), so some runs used PubMed alone. Each source has a 2.5-4.5 s
  budget; a source that fails just contributes no papers. Later the same
  evening Semantic Scholar answered some anonymous requests again. For
  textbook techniques (PCR, Western blot, ELISA, ...) asked for as such
  ("Use standard PCR to amplify GAPDH") the canonical-technique rule marks
  the hypothesis `exact_match` and cites the top methods papers; since QA
  round 2 it no longer fires when the technique is only a readout or the
  comparator of something new.
- **The novelty verdict check is mostly word-based.** After the embedding
  filter has removed papers far from the hypothesis, it decides "on-topic" by how
  much of the hypothesis' weighted vocabulary a paper's title and abstract
  share (`hypothesisTerms.ts`), not by reading the paper. It catches the
  contradictions the QA found (and keeps "not found" only when nothing
  on-topic was retrieved), but a paper that uses the same words for another
  question can still count as related, and synonyms the hypothesis does not
  use (a drug's brand name, a gene's alias) are missed. "Exact match" still
  comes only from the AI classifier (or the canonical rule); the check can
  only downgrade it.
- **Catalog numbers: what "verified" means.** The live lookup covers
  Sigma-Aldrich only, through PubChem (Sigma's own search endpoint no longer
  accepts plain requests), for up to eight materials per plan. Besides that,
  25 common ATCC cell lines and about 25 dictionary products can be
  confirmed. Every other number is shown as **unverified** (since QA round
  3; before, a number PubChem did not know was accepted silently and an
  invented "Sigma S1000" or "ATCC CCL-22" for Caco-2 appeared as real).
  "Unverified" does not mean wrong: Sigma does not deposit antibodies, kits
  or cell lines in PubChem, and Thermo Fisher, Corning, Promega and the
  other suppliers have no public catalogue to search, so their numbers can
  never be verified here. Placeholder-like numbers (a letter or two and a
  round number, a repeated digit, "123456") are removed outright. With the
  local model most numbers end up unverified or removed: it does not know
  real catalogue numbers. A hosted model writes more real ones, which are
  then verified where a lookup exists.
- **The related-work filter has a narrow margin.** `nomic-embed-text`
  compresses similarities: on the QA's six hypotheses (probe
  `embed-probe.ts`, 10 Nov 2026) every retrieved biology paper scored
  0.68-0.88, the on-topic ones 0.71-0.88, the QA's three irrelevant NMN
  papers 0.70, 0.65 and 0.51 (titles only) against an on-topic best of 0.86.
  The relative cut (best minus 0.15, at least 0.66) drops all three and none
  of the on-topic papers of the other five hypotheses, but an irrelevant
  paper only 0.15 below the best still gets through, and papers that share
  only the material (3D-printed polylactic acid for a Dsup-coating
  hypothesis, 0.68-0.75) cannot be told apart from on-topic ones by the
  embedding; the word coverage then decides "on-topic". On the busy CPU one
  embedding request for 13 papers took 85-150 s while a plan was being
  generated in the same Ollama.
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

## 10. What only the repository owner can do

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

- **Left open after QA round 4 (11 Nov 2026), all minor.**
  - A catalog number that the model writes into a material's *name or notes*
    ("Metformin hydrochloride (Sigma S1000)") is not examined; only the
    Cat # column and the protocol steps are. No real run did this with an
    invented number.
  - A dose with the unit spelled out ("10 millimolar metformin") is not read
    as a dose.
  - The pipeline version was not raised for the last check changes, so one
    local test run made between them (42c080d0) still shows text the current
    checks would change. New runs are not affected.
  - A limit in a wording the reader does not know ("Keep it under 3000."
    with no word for money, "Make it a $3,000 project.", "2 weeks, no
    more.") is not sent to the model as a hard limit and not checked. A
    limit that was lifted in words ("The budget does not need to stay under
    $3,000.") is still read as a limit. On the reviewer's 205 test sentences
    the reader now agrees with an ordinary reader on 180 (90 before the
    round-4 change was reviewed), with none read worse than before.
  - The novelty verdict for a hypothesis whose anchor words also describe
    unrelated work (the Dsup / PLA scaffold example) can still be "exact
    match" when the classifier says so.

## 11. Live deployment

This section is for putting the app on the internet. The local way of
running it (sections 1 to 5) does not change: every hosted setting below is
optional, and without it the code behaves as it does locally.

### The pieces

| Piece | What it is | Where it lives |
|---|---|---|
| Frontend | The Vite build, a static site | GitHub Pages project site, https://gopalinternship-unibasel.github.io/ai-scientist/ , built and published by `.github/workflows/pages.yml` |
| Backend | Database, sign-in, realtime and the five edge functions | One new Supabase cloud project (free plan, region Zurich, eu-central-2) |
| AI | Chat and embeddings, reached through an OpenAI-compatible URL | Cloudflare Workers AI on its free allowance (10,000 neurons a day for the whole Cloudflare account, no card). Everything is set through function settings, see section 6, so another provider is a change of settings |
| Checks | Daily test of the live site | `.github/workflows/smoke.yml` |

Limits of the free plan that shape the setup: an edge function may run
150 seconds of wall-clock time (background work counts) and 2 seconds of CPU
per request. A run that is cut off is marked failed at once by a shutdown
handler in `run-experiment` ("server time limit reached, press Retry"); the
cleanup job (`cleanup_stale_runs`, every 5 minutes) is the fallback. Supabase's
built-in mailer only delivers to the project's own team members, so "Confirm
email" must be off and password-reset emails do not reach other people.

### Settings

Function settings go to the Supabase project as secrets. Non-secret ones can
be put in `supabase\functions\.env.cloud` (ignored by git) and loaded with
`supabase secrets set --env-file supabase\functions\.env.cloud`. Key-like
values are set by the owner in the dashboard (Edge Functions, Secrets) and
never go into a file in this repository.

| Setting | Where | Meaning |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`, `SUPABASE_DB_URL` | Injected by Supabase | New projects get the key pair as JSON (the key is under `"default"`). The functions read `_shared/supabaseKeys.ts`: the old names `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` win when present (local stack), otherwise the new ones are used. Names starting with `SUPABASE_` cannot be set by hand. |
| `AI_BASE_URL`, `AI_API_KEY` | Function secrets | OpenAI-compatible base URL without a trailing slash, and the bearer key (secret, set by the owner). For Cloudflare Workers AI the URL is `https://api.cloudflare.com/client/v4/accounts/<account id>/ai/v1` and the key is a Workers AI API token (dashboard, Workers AI, Use REST API). |
| `AI_MODEL`, `AI_MODEL_<ROLE>` | Function secrets | Default model and per-role chains (comma separated). Roles: PLAN, FAST, REASONING, GATE, DOMAIN, DISTILL, EVAL_PLAN, JUDGE. Use fast, small models for GATE, DOMAIN and FAST: their time budgets are 6, 5 and 20 seconds. Start values on Cloudflare: `AI_MODEL=@cf/zai-org/glm-4.7-flash` and `AI_MODEL_PLAN=@cf/zai-org/glm-4.7-flash,@cf/google/gemma-4-26b-a4b-it`. |
| `AI_STRUCTURED_OUTPUT`, `AI_MAX_TOKENS_PARAM`, `AI_MAX_TOKENS_CAP`, `AI_COMPACT_OUTPUT`, `AI_MIN_TIMEOUT_MS` | Function secrets | As in section 6. Hosted start values: `tools_required` (Cloudflare documents `tool_choice` none, auto and required; use `tools` for a provider that accepts a named function), `max_tokens`, about 6000, `false`, `0`. |
| `AI_REASONING_EFFORT` | Function secrets, optional | For example `low`. Sent as `reasoning_effort` on every chat request. Unset: nothing is sent. |
| `AI_EMBED_MODEL`, `AI_EMBED_BASE_URL`, `AI_EMBED_API_KEY` | Function secrets | Embedding model and, if different from chat, its URL and key. Empty model: embeddings off, the app runs in its degraded mode. Start value on Cloudflare: `@cf/google/embeddinggemma-2`, which returns 768 numbers by itself, so `AI_EMBED_DIMENSIONS` stays unset. |
| `AI_EMBED_DIMENSIONS` | Function secrets, optional | `true` asks the provider for 768-dimensional vectors; a whole number asks for that many. The database column is `vector(768)`, so any other number needs a migration of `plan_feedback.embedding` and the two match functions first. Vectors of the wrong size are rejected. |
| `LIT_EMBED_MIN_SIMILARITY` (default 0.66), `LIT_EMBED_MARGIN` (0.15), `FEEDBACK_MIN_SIMILARITY` (0.55), `EXACT_EMBED_MIN` (0.78) | Function secrets, optional | Similarity thresholds, numbers between 0 and 1. The first, second and fourth default were measured for the local embedding model (nomic-embed-text), the feedback floor of 0.55 dates from Google's text-embedding-004; set them again when the model changes. A lower `LIT_EMBED_MIN_SIMILARITY` (about 0.5) keeps the related-work filter from dropping every paper while the values are not calibrated. |
| `PLAN_REPAIR_ATTEMPTS` | Function secrets | `0` at launch: no second plan attempt, which keeps a run inside 150 seconds. |
| `RUN_LIMIT_GLOBAL_PER_DAY`, `RUN_LIMIT_ANON_PER_DAY`, `RUN_LIMIT_USER_PER_DAY` | Function secrets | Daily caps on new AI runs: over all visitors, per visitor address without sign-in, per signed-in user. Start values 20, 3 and 6: a run costs roughly 150 to 200 Cloudflare neurons, and the 10,000 a day are shared with the LifeOps demo. A cap that is not set does not apply; when none is set the local rule (100 runs per hour per user or address) stays. The check counts and then inserts, without a lock, so several requests that arrive in the same instant can overshoot a cap by a few runs. Only runs that call the AI count: a cached plan is replayed free and is not counted; a refinement counts. A refused run gets HTTP 429 with a plain message. |
| `SEMANTIC_SCHOLAR_API_KEY` | Function secrets, optional | As in section 10. |
| `LOG_FORWARDING_HEADERS` | Function secrets, optional | `true` logs the forwarding headers of the first request each worker sees, to find out which one carries the visitor address. The line holds that address, which is personal data: set it for one check and remove it again (`supabase secrets unset LOG_FORWARDING_HEADERS`). |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID` | GitHub repository variables | Public values of the Supabase project. The publishable key ships in the browser bundle by design. Variables win over `.env` in the build. |
| `VITE_BASE_PATH` | Build setting (`pages.yml` sets `/ai-scientist/`) | Base path of the site. Unset: `/`. In Git Bash set `MSYS_NO_PATHCONV=1` before a local build with it, or the value is turned into a Windows path. |
| `VITE_HOSTED_DEMO` | Build setting (`pages.yml` sets `true`) | Shows one line on the start page: a hosted demo with a daily limit, and the hypothesis goes to a hosted AI provider. Unset locally: no line. |
| `SMOKE_HYPOTHESIS` | GitHub repository variable, optional | Exact text of one hypothesis that a real run has already planned. The weekly step of the smoke check replays it from the cache. |
| `VITE_LOVABLE_OAUTH` | Not set | The Google button needs Lovable hosting. |

The tracked `.env` holds placeholders. Real values come from
`.env.development.local` (local stack, written by `start-local.ps1`) or from
the GitHub variables (hosted build). Never commit a real key.

### Order of steps

Marked **owner** where only the repository owner can do it.

1. Code and workflows are in the repository (this branch). Run the checks in section 7.
2. **Owner:** create the AI provider key and keep it out of chat and files.
3. **Owner:** create the Supabase project (name `ai-scientist`, region Zurich) with a database password only the owner knows. Note the project ref.
4. **Owner:** in this folder run `supabase link --project-ref <ref>`, then `supabase db push --remote --dry-run` (23 migrations expected), then `supabase db push --remote`. Do not use `--include-seed` or `--include-roles`. The CLI skips migrations while `supabase/config.toml` says `[db.migrations] enabled = false` (the local stack applies them itself); set `SUPABASE_DB_MIGRATIONS_ENABLED=true` in the shell for this command. Migration `20260425210859` turns row-level security on for `realtime.messages` only where it is off, because a hosted project owns that table and has it on already (the plain statement was refused there with "must be owner of table messages"). All 23 migrations applied to a new project on 14 Nov 2026.
5. Write the non-secret settings to `supabase\functions\.env.cloud` and run `supabase secrets set --env-file supabase\functions\.env.cloud`.
6. **Owner:** in the dashboard (Edge Functions, Secrets) add `AI_API_KEY`, and `SEMANTIC_SCHOLAR_API_KEY` if wanted.
7. `supabase functions deploy --use-api` deploys all five functions with `verify_jwt = false` from `supabase/config.toml` (each checks its caller in code). Check `supabase functions list`. Never run `supabase config push` with this file: it holds local URLs.
8. **Owner (or with the owner's go-ahead in the browser):** Authentication, URL Configuration: Site URL `https://gopalinternship-unibasel.github.io/ai-scientist/`, redirect URL `https://gopalinternship-unibasel.github.io/ai-scientist/**`. Authentication, Sign In / Providers, Email: turn "Confirm email" off.
9. Set the three `VITE_SUPABASE_*` repository variables (`gh variable set ...`, without echoing the key) and switch Pages to "GitHub Actions" (repository Settings, Pages).
10. **Owner:** merge to `main`. `pages.yml` runs on the push; while the variables are missing it only prints a notice and publishes nothing.
11. **Owner:** straight after the first deploy, before sharing the link, sign up at `/ai-scientist/auth` and press the claim-admin button on `/ai-scientist/admin`. The first account that asks becomes admin.
12. Make one real run. Check: status done in under 150 seconds; `qc.related_filter.method` is `embedding` (if it says words only, the provider did not return vectors of the right size); the function logs show no wall-clock or CPU shutdown. To see which header carries the visitor address, set `LOG_FORWARDING_HEADERS=true` for this one run, read the log line `forwarding_headers`, and unset it again.
13. Run `smoke.yml` by hand (Actions, Run workflow) and check the deep link, share link, refinement, PDF export and sign-in in the browser. Optionally set `SMOKE_HYPOTHESIS` to the text of step 12.
14. **Owner:** keep the repository active. GitHub switches scheduled workflows off after 60 days without activity; the last step of `smoke.yml` enables the workflow again through the API on every run, and a push or the link in GitHub's email also works. Whether that call restarts the 60-day clock has not been verified.

### Smoke check

`smoke.yml` runs daily at 05:23 UTC and on demand. It reads only the public
variables. It checks: the Pages root answers 200 and its first script loads;
a deep link returns the app shell (status 404 by design of Pages); the Auth
service is healthy; a REST query on `runs` returns a JSON array (a real
database query); `GET run-experiment` returns numeric `limit`, `used` and
`remaining`. On Mondays and on manual runs, when `SMOKE_HYPOTHESIS` is set, it
posts that text and expects a cached plan; each such replay adds one row to
`runs` (owner token `smoke-check`), because a replay always gets its own row.
While the variables are missing the job ends with a notice.

### If runs are cut off at 150 seconds

Start with `PLAN_REPAIR_ATTEMPTS=0`, small fast models for the short roles,
`AI_REASONING_EFFORT=low` and an `AI_MAX_TOKENS_CAP` of about 6000. Next step,
not built: split `processRun` into stages (literature and novelty, plan,
critique) that call `run-experiment` again with the run id and the secret key,
so each stage gets its own 150 seconds and 2 seconds of CPU.
`eval-harness` and full house-rule distillation cannot finish in one worker
on the free plan; keep them to the admin and use `pilot_size=1`.
