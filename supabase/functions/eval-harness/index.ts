// Eval harness — runs a frozen suite of hypotheses through the planner twice
// (with vs without feedback retrieval), then asks an LLM judge to score the
// outputs on a 4-dimension rubric. Stores results in eval_runs so the admin
// dashboard can plot the loop's actual impact over time.
//
// Auth: moderator/admin only, OR the cron secret for scheduled runs.
// Cost guardrail: defaults to a 4-hypothesis pilot (8 plans + 8 judge calls).
//   Pass { full: true } to run the entire suite.
//
// Plan generation uses the SAME prompt + schema + retrieval surface as the
// production /run-experiment pipeline (via _shared/plannerCore.ts), so judge
// scores reflect what real users actually see. The only differences vs prod:
//   - no SSE streaming (we collect tool-call args in one shot)
//   - no persistence (no runs row, no rate limit, no idempotency cache)
//   - no post-plan critique / SKU verify (judge is the eval signal)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import { callAIWithFallback } from "../_shared/ai-fallback.ts";
import { aiApiKey, extractToolArgs, modelChain, promptChars } from "../_shared/aiProvider.ts";
import { searchLiterature, type LitPaper } from "../_shared/literature.ts";
import { rankByRelevance } from "../_shared/relevanceRank.ts";
import { detectCanonicalTechnique } from "../_shared/canonicalTechniques.ts";
import { screenSafety } from "../_shared/safety.ts";
import { resolveDomain } from "../_shared/domainNormalize.ts";
import { fetchHouseRules } from "../_shared/houseRules.ts";
import { retrieveRelevantFeedback, type FeedbackHint } from "../_shared/feedbackRetrieval.ts";
import { planSchema, buildPlannerSystemPrompt, buildPlannerUserMessage } from "../_shared/plannerCore.ts";

// Frozen hypothesis suite spanning multiple domains. Keep these stable —
// changing them invalidates historical comparisons.
const SUITE: Array<{ domain: string; hypothesis: string }> = [
  {
    domain: "cell-biology",
    hypothesis: "Replacing sucrose with trehalose as a cryoprotectant in the freezing medium will increase post-thaw viability of HeLa cells by at least 15 percentage points compared to the standard DMSO protocol.",
  },
  {
    domain: "molecular-biology",
    hypothesis: "Knocking out the TP53 gene in HCT116 colon cancer cells via CRISPR-Cas9 will increase doxorubicin IC50 by at least 3-fold compared to wild-type controls.",
  },
  {
    domain: "microbiology",
    hypothesis: "E. coli BL21(DE3) cultures grown in LB at 25C versus 37C will produce soluble recombinant GFP at >2x the yield, measured by SDS-PAGE band intensity of the soluble fraction.",
  },
  {
    domain: "biochemistry",
    hypothesis: "A paper-based electrochemical biosensor functionalized with anti-CRP antibodies will detect C-reactive protein in serum at concentrations below 0.5 mg/L within 10 minutes.",
  },
  {
    domain: "neuroscience",
    hypothesis: "Optogenetic activation of parvalbumin-positive interneurons in mouse prefrontal cortex via 473nm light at 40Hz will reduce anxiety-like behaviour in the elevated plus maze by at least 30%.",
  },
  {
    domain: "pharmacology",
    hypothesis: "Co-administration of metformin (200mg/kg) with sorafenib (30mg/kg) in HepG2-xenograft mice will reduce tumour volume by at least 40% compared to sorafenib alone over 21 days.",
  },
];

interface RubricScores {
  specificity: number;
  sku: number;
  timeline: number;
  feasibility: number;
  notes: string;
}

interface PreparedContext {
  references: Array<{ title: string; year?: number | null; url?: string }>;
  domain: string | null;
  // deno-lint-ignore no-explicit-any
  safetyFlags: any;
  // deno-lint-ignore no-explicit-any
  houseRules: any[];
  hintsWith: FeedbackHint[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const AI_API_KEY = aiApiKey();
  const CRON_SECRET = Deno.env.get("EVAL_CRON_SECRET");

  if (!AI_API_KEY) {
    return new Response(JSON.stringify({ error: "Service not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Two valid auth paths:
  //   1) `x-cron-secret: <EVAL_CRON_SECRET>` — used by the daily pg_cron job
  //      which has no JWT to forward. Constant-time compare to avoid timing leaks.
  //   2) Bearer JWT belonging to a moderator/admin — interactive admin button.
  const cronHeader = req.headers.get("x-cron-secret");
  const isCronCall = !!CRON_SECRET && !!cronHeader && constantTimeEqual(cronHeader, CRON_SECRET);

  if (!isCronCall) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "auth required" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: who } = await userClient.auth.getUser();
    if (!who?.user) {
      return new Response(JSON.stringify({ error: "auth required" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: roles } = await userClient
      .from("user_roles")
      .select("role")
      .eq("user_id", who.user.id);
    const ok = (roles ?? []).some((r) => r.role === "moderator" || r.role === "admin");
    if (!ok) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }
  let body: { full?: boolean; pilot_size?: number; async?: boolean } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const writer = createClient(SUPABASE_URL, SERVICE_KEY);
  const batchId = crypto.randomUUID();
  const cap = body.full ? SUITE.length : Math.min(SUITE.length, body.pilot_size ?? 4);
  const suite = SUITE.slice(0, cap);

  // For each hypothesis we run the SAME planning surface as production twice.
  // The two arms differ only in whether retrieved feedback hints are fed in —
  // everything else (refs, safety, domain, house rules, prompt, schema) is
  // identical. That isolates the loop's contribution from the planner's.
  const evaluateAll = async () => {
    for (const item of suite) {
      try {
        const ctx = await prepareContext(item.hypothesis, writer, AI_API_KEY);

        const planWith = await realPlan(item.hypothesis, ctx, ctx.hintsWith, AI_API_KEY);
        const planWithout = await realPlan(item.hypothesis, ctx, [], AI_API_KEY);

        const judgeWith = await judge(item.hypothesis, planWith ?? "", AI_API_KEY);
        const judgeWithout = await judge(item.hypothesis, planWithout ?? "", AI_API_KEY);

        const rows = [
          toRow({ batchId, hypothesis: item.hypothesis, arm: "with_feedback", plan: planWith, judge: judgeWith, lessonCount: ctx.hintsWith.length }),
          toRow({ batchId, hypothesis: item.hypothesis, arm: "without_feedback", plan: planWithout, judge: judgeWithout, lessonCount: 0 }),
        ];
        const { error } = await writer.from("eval_runs").insert(rows);
        if (error) console.error("eval insert failed", error.message);
      } catch (e) {
        console.error("eval iteration failed", e);
      }
    }
  };

  // { async: true }: answer at once and evaluate in the background (rows land
  // in eval_runs per hypothesis). On a slow local model one hypothesis takes
  // far longer than the API gateway's 150 s request timeout.
  const waitUntil = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
    .EdgeRuntime?.waitUntil;
  if (body.async && waitUntil) {
    waitUntil(evaluateAll().catch((e) => console.error("eval background run failed", e)));
    return new Response(JSON.stringify({ batch_id: batchId, started: true, hypotheses: suite.length }), {
      status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  await evaluateAll();

  return new Response(JSON.stringify({ batch_id: batchId, evaluated: suite.length }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

// ---------------------------------------------------------------------------
// Helpers

// Build the same retrieval/context bundle that production /run-experiment
// constructs before calling the planner. Lit search, safety screen, domain,
// house rules, and feedback hints — everything the system prompt sees.
async function prepareContext(
  hypothesis: string,
  // deno-lint-ignore no-explicit-any
  supabase: any,
  apiKey: string,
): Promise<PreparedContext> {
  // Literature: same query-degradation + canonical-technique handling as prod.
  const canon = detectCanonicalTechnique(hypothesis);
  const litQuery = canon.matched ? `${canon.technique} method protocol` : hypothesis;
  let references: Array<{ title: string; year?: number | null; url?: string }> = [];
  try {
    const lit = await searchLiterature(litQuery);
    const ranked = rankByRelevance(lit.papers, hypothesis);
    const FLOOR = canon.matched ? 0.005 : 0.015;
    const filtered = ranked.filter((p) => p.relevance >= FLOOR);
    const candidates: LitPaper[] = (filtered.length > 0 ? filtered : ranked).slice(0, 3);
    references = candidates.map((p) => ({ title: p.title, year: p.year, url: p.url }));
  } catch (e) {
    console.warn("eval lit search failed", e);
  }

  const safetyFlags = screenSafety(hypothesis);
  const domain = await resolveDomain(apiKey, hypothesis).catch(() => null);
  const houseRules = await fetchHouseRules(supabase, domain).catch(() => []);
  const hintsWith = await retrieveRelevantFeedback(supabase, hypothesis, domain, apiKey).catch(() => []);

  return { references, domain, safetyFlags, houseRules, hintsWith };
}

async function realPlan(
  hypothesis: string,
  ctx: PreparedContext,
  hints: FeedbackHint[],
  apiKey: string,
): Promise<string | null> {
  const system = buildPlannerSystemPrompt({
    safetyFlags: ctx.safetyFlags,
    houseRules: ctx.houseRules,
    feedbackHints: hints,
    domain: ctx.domain,
  });
  const user = buildPlannerUserMessage({ hypothesis, references: ctx.references });

  try {
    const { res } = await callAIWithFallback({
      apiKey,
      // EVAL_PLAN chain: pinned to gemini-3-flash-preview on the Lovable
      // gateway for cost (the typical first hop of the production chain).
      models: modelChain("EVAL_PLAN"),
      label: "eval-plan",
      retries: 1,
      timeoutMs: 120_000,
      maxTokens: 8000,
      buildBody: (model) => ({
        model,
        temperature: 0.2,
        // No streaming — eval doesn't need it and one-shot is simpler.
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        tools: [{
          type: "function",
          function: {
            name: "submit_experiment_plan",
            description: "Submit the complete experiment plan.",
            parameters: planSchema,
          },
        }],
        tool_choice: { type: "function", function: { name: "submit_experiment_plan" } },
      }),
    });
    if (!res.ok) {
      console.warn("eval planner non-200", res.status);
      return null;
    }
    const j = await res.json();
    const args = extractToolArgs(j);
    if (typeof args !== "string") return null;
    // Return as JSON string — the judge reads it as text and we store it as
    // plan_excerpt (truncated). No need to round-trip parse.
    return args;
  } catch (e) {
    console.warn("eval planner threw", e);
    return null;
  }
}

async function judge(hypothesis: string, plan: string, apiKey: string): Promise<RubricScores | null> {
  if (!plan) return null;
  try {
    const { res } = await callAIWithFallback({
      apiKey,
      // JUDGE chain (gpt-5 on the Lovable gateway): a different model family
      // from the planner so judge errors are uncorrelated with planner
      // errors — tighter eval CIs.
      models: modelChain("JUDGE"),
      label: "eval-judge",
      retries: 1,
      timeoutMs: 60_000,
      maxTokens: 600,
      buildBody: (model) => ({
        model,
        temperature: 0.0,
        messages: [
          { role: "system", content: "You are a strict, calibrated peer reviewer scoring an experiment plan on a 0-10 rubric across four axes. Be honest — most first-draft plans should score 5-7, not 9. Reserve 9-10 for plans you would publish as a worked example." },
          { role: "user", content: `HYPOTHESIS:\n${hypothesis}\n\nPLAN (JSON):\n${plan.slice(0, promptChars(8000, 6000))}\n\nScore this plan via the tool.` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "submit_scores",
            parameters: {
              type: "object",
              properties: {
                specificity: { type: "integer", minimum: 0, maximum: 10, description: "Are quantities, durations, concentrations specific and operational?" },
                sku: { type: "integer", minimum: 0, maximum: 10, description: "Are catalog numbers and supplier formats plausible / not fabricated?" },
                timeline: { type: "integer", minimum: 0, maximum: 10, description: "Is the timeline realistic and consistent with the protocol?" },
                feasibility: { type: "integer", minimum: 0, maximum: 10, description: "Could a real lab actually execute this plan?" },
                notes: { type: "string", description: "Brief justification, max 300 chars." },
              },
              required: ["specificity", "sku", "timeline", "feasibility", "notes"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "submit_scores" } },
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const args = extractToolArgs(j);
    if (!args) return null;
    return JSON.parse(args) as RubricScores;
  } catch { return null; }
}

function toRow(p: {
  batchId: string;
  hypothesis: string;
  arm: "with_feedback" | "without_feedback";
  plan: string | null;
  judge: RubricScores | null;
  lessonCount: number;
}) {
  const j = p.judge;
  const overall = j
    ? Number(((j.specificity + j.sku + j.timeline + j.feasibility) / 4).toFixed(2))
    : null;
  return {
    batch_id: p.batchId,
    hypothesis: p.hypothesis,
    arm: p.arm,
    score_specificity: j?.specificity ?? null,
    score_sku: j?.sku ?? null,
    score_timeline: j?.timeline ?? null,
    score_feasibility: j?.feasibility ?? null,
    score_overall: overall,
    judge_notes: j?.notes ?? null,
    plan_excerpt: p.plan?.slice(0, 4000) ?? null,
    applied_lesson_count: p.lessonCount,
  };
}

// Constant-time string compare for the cron secret. Standard timing-attack
// hardening — short-circuit on length but otherwise iterate the whole string.
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
