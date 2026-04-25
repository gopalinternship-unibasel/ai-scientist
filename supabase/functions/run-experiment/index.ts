import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { COST_CATALOG_PROMPT } from "./cost-catalog.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { fetchWithRetry } from "../_shared/fetch-with-retry.ts";
import { sanitizeCitationsWithReport } from "../_shared/citations.ts";
import { checkHypothesis } from "../_shared/hypothesisValidation.ts";
import { searchLiterature, type LitPaper } from "../_shared/literature.ts";
import { screenSafety, safetyPromptFragment } from "../_shared/safety.ts";
import {
  callAIWithFallback, PLAN_MODELS, FAST_MODELS,
  classifyHttpError, encodeError, type ErrorKind,
} from "../_shared/ai-fallback.ts";
import { gateHypothesis } from "../_shared/hypothesisGate.ts";
import { findCatalogIssues } from "../_shared/catalogCheck.ts";
import { checkFeasibility } from "../_shared/feasibilityCheck.ts";
import { detectCanonicalTechnique } from "../_shared/canonicalTechniques.ts";
import { rankByRelevance } from "../_shared/relevanceRank.ts";

const planSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    domain: { type: "string" },
    summary: { type: "string" },
    hypothesis_restated: { type: "string" },
    success_criteria: { type: "array", items: { type: "string" } },
    protocol: {
      type: "array",
      items: {
        type: "object",
        properties: {
          step: { type: "integer" },
          title: { type: "string" },
          description: { type: "string" },
          duration: { type: "string" },
          source: { type: "string" },
        },
        required: ["step", "title", "description", "duration"],
        additionalProperties: false,
      },
    },
    materials: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          supplier: { type: "string" },
          catalog_number: { type: "string" },
          quantity: { type: "string" },
          unit_cost_usd: { type: "number" },
          total_cost_usd: { type: "number" },
          notes: { type: "string" },
        },
        required: ["name", "supplier", "quantity", "unit_cost_usd", "total_cost_usd"],
        additionalProperties: false,
      },
    },
    budget: {
      type: "object",
      properties: {
        currency: { type: "string", enum: ["USD"] },
        line_items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              category: { type: "string" },
              amount_usd: { type: "number" },
              note: { type: "string" },
            },
            required: ["category", "amount_usd"],
            additionalProperties: false,
          },
        },
        total_usd: { type: "number" },
      },
      required: ["currency", "line_items", "total_usd"],
      additionalProperties: false,
    },
    timeline: {
      type: "array",
      items: {
        type: "object",
        properties: {
          phase: { type: "string" },
          duration: { type: "string" },
          deliverables: { type: "array", items: { type: "string" } },
          dependencies: { type: "array", items: { type: "string" } },
        },
        required: ["phase", "duration", "deliverables"],
        additionalProperties: false,
      },
    },
    validation: {
      type: "object",
      properties: {
        approach: { type: "string" },
        primary_metric: { type: "string" },
        controls: { type: "array", items: { type: "string" } },
        statistical_plan: { type: "string" },
      },
      required: ["approach", "primary_metric", "controls"],
      additionalProperties: false,
    },
    statistical_design: {
      type: "object",
      description: "Structured statistical design — required for reviewer scrutiny.",
      properties: {
        n_per_group: { type: "integer", minimum: 1 },
        groups: { type: "array", items: { type: "string" } },
        primary_test: { type: "string" },
        effect_size: { type: "string" },
        alpha: { type: "number" },
        power: { type: "number" },
        randomization: { type: "string" },
        blinding: { type: "string" },
        notes: { type: "string" },
      },
      required: ["n_per_group", "groups", "primary_test", "effect_size", "alpha", "power", "randomization", "blinding"],
      additionalProperties: false,
    },
    safety: {
      type: "object",
      description: "Safety / regulatory section. Address each flagged category from the SAFETY PRE-SCREEN.",
      properties: {
        biosafety_level: { type: "string", enum: ["BSL-1", "BSL-2", "BSL-3", "BSL-4", "Not applicable"] },
        irb_required: { type: "boolean" },
        iacuc_required: { type: "boolean" },
        ibc_required: { type: "boolean" },
        controlled_substances: { type: "boolean" },
        hazards: { type: "array", items: { type: "string" } },
        ppe: { type: "array", items: { type: "string" } },
        waste_handling: { type: "string" },
        emergency_procedure: { type: "string" },
      },
      required: ["biosafety_level", "irb_required", "iacuc_required", "ibc_required", "controlled_substances", "hazards", "ppe", "waste_handling", "emergency_procedure"],
      additionalProperties: false,
    },
    risks: {
      type: "array",
      items: {
        type: "object",
        properties: { risk: { type: "string" }, mitigation: { type: "string" } },
        required: ["risk", "mitigation"],
        additionalProperties: false,
      },
    },
    team: {
      type: "array",
      items: {
        type: "object",
        properties: { role: { type: "string" }, fte: { type: "number" } },
        required: ["role", "fte"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "title", "domain", "summary", "hypothesis_restated", "success_criteria",
    "protocol", "materials", "budget", "timeline", "validation",
    "statistical_design", "safety", "risks", "team",
  ],
  additionalProperties: false,
} as const;

const critiqueSchema = {
  type: "object",
  properties: {
    overall_score: { type: "integer", minimum: 1, maximum: 10 },
    strengths: { type: "array", items: { type: "string" } },
    concerns: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["low", "medium", "high"] },
          area: { type: "string" },
          issue: { type: "string" },
          suggestion: { type: "string" },
        },
        required: ["severity", "area", "issue", "suggestion"],
        additionalProperties: false,
      },
    },
    missing_controls: { type: "array", items: { type: "string" } },
    statistical_notes: { type: "string" },
    ethical_notes: { type: "string" },
  },
  required: ["overall_score", "strengths", "concerns", "missing_controls", "statistical_notes"],
  additionalProperties: false,
} as const;

const stripCtl = (s: string) => s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

// Stable hash of a normalised hypothesis for caching.
async function hashHypothesis(h: string): Promise<string> {
  const norm = h.toLowerCase().replace(/\s+/g, " ").trim();
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(norm));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// fetchWithRetry now lives in ../_shared/fetch-with-retry.ts
// searchLiterature (multi-source: S2 + OpenAlex + PubMed) lives in ../_shared/literature.ts

/**
 * Two-pass novelty classifier.
 *
 * Pass 1 ("keyword/method overlap"): the original classifier — picks the most
 * relevant references and gives a coarse signal.
 *
 * Pass 2 ("semantic equivalence"): a stricter rubric that asks whether any
 * cited paper tests *the same scientific claim* as the hypothesis (even with
 * different wording, model systems, or measurement methods). This catches the
 * "I reinvented X" failure mode that pure keyword overlap misses.
 */
async function classifyNovelty(hypothesis: string, papers: LitPaper[], apiKey: string) {
  if (papers.length === 0) {
    return {
      signal: "not_found" as const,
      rationale: "No related work surfaced via Semantic Scholar, OpenAlex, or PubMed.",
      chosen: [] as number[],
      semantic_overlap: "low" as const,
    };
  }
  const condensed = papers.slice(0, 8).map((p, i) => ({
    i, title: p.title, year: p.year, venue: p.venue, source: p.source,
    abstract: (p.abstract ?? "").slice(0, 600),
  }));

  const { res: aiRes } = await callAIWithFallback({
    apiKey,
    models: FAST_MODELS,
    label: "novelty-classify",
    buildBody: (model) => ({
      model,
      messages: [
        { role: "system", content: "You are a research librarian assessing whether a hypothesis has prior art. Use this rubric:\n  • exact_match  — at least one candidate tests essentially the same claim (same intervention + same system + same outcome direction), even with minor wording differences.\n  • similar     — at least one candidate shares the technique AND topic area but differs on system, organism, or specific intervention. Default to this when in doubt and any candidate is on-topic.\n  • not_found   — every candidate is clearly off-topic (different field, different question).\nAlso report semantic_overlap (low/medium/high). Pick 1–3 most-relevant indices in `chosen`. ONLY pick papers that are genuinely on-topic; if none of the candidates are relevant, return chosen:[] and signal:not_found." },
        { role: "user", content: `HYPOTHESIS:\n${hypothesis}\n\nCANDIDATES (already pre-ranked by token overlap; index 0 is most overlapping):\n${JSON.stringify(condensed)}` },
      ],
      tools: [{
        type: "function",
        function: {
          name: "report_novelty",
          parameters: {
            type: "object",
            properties: {
              signal: { type: "string", enum: ["not_found", "similar", "exact_match"] },
              rationale: { type: "string" },
              chosen: { type: "array", items: { type: "integer" } },
              semantic_overlap: {
                type: "string",
                enum: ["low", "medium", "high"],
                description: "high = a candidate tests the same scientific claim (even if worded differently); medium = closely adjacent; low = clearly different question.",
              },
            },
            required: ["signal", "rationale", "chosen", "semantic_overlap"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "report_novelty" } },
    }),
  });
  if (!aiRes.ok) {
    return { signal: "similar" as const, rationale: "Classification unavailable; defaulting to similar work exists.", chosen: [0, 1, 2], semantic_overlap: "medium" as const };
  }
  try {
    const aiJson = await aiRes.json();
    return JSON.parse(aiJson.choices[0].message.tool_calls[0].function.arguments);
  } catch {
    return { signal: "similar" as const, rationale: "Unable to parse classification.", chosen: [0, 1, 2], semantic_overlap: "medium" as const };
  }
}

async function critiquePlan(hypothesis: string, plan: unknown, apiKey: string, extraContext = "") {
  const { res: aiRes } = await callAIWithFallback({
    apiKey,
    models: FAST_MODELS,
    label: "critique",
    buildBody: (model) => ({
      model,
      messages: [
        { role: "system", content: "You are a senior peer reviewer for an experimental biology / chemistry journal. Critically evaluate the proposed experiment plan for: missing controls, weak statistical power, ethical/safety oversights, unrealistic budgets or timelines, supplier/catalog inconsistencies, and gaps between hypothesis and protocol. Be specific and actionable." },
        { role: "user", content: `HYPOTHESIS:\n${hypothesis}\n\nPROPOSED PLAN:\n${JSON.stringify(plan).slice(0, 12000)}${extraContext}` },
      ],
      tools: [{
        type: "function",
        function: { name: "submit_critique", description: "Reviewer critique.", parameters: critiqueSchema },
      }],
      tool_choice: { type: "function", function: { name: "submit_critique" } },
    }),
  });
  if (!aiRes.ok) return null;
  try {
    const aiJson = await aiRes.json();
    return JSON.parse(aiJson.choices[0].message.tool_calls[0].function.arguments);
  } catch { return null; }
}

// Per-identifier rate limit (rolling window).
// deno-lint-ignore no-explicit-any
async function checkRateLimit(
  supabase: any,
  identifier: string,
  kind: string,
  windowMinutes: number,
  max: number,
): Promise<{ ok: boolean; remaining: number; used: number; limit: number }> {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const { count } = await supabase
    .from("rate_limits")
    .select("*", { count: "exact", head: true })
    .eq("identifier", identifier)
    .eq("kind", kind)
    .gte("created_at", since);
  const used = count ?? 0;
  if (used >= max) return { ok: false, remaining: 0, used, limit: max };
  await supabase.from("rate_limits").insert({ identifier, kind });
  return { ok: true, remaining: max - used - 1, used: used + 1, limit: max };
}

function rateHeaders(rl: { used: number; limit: number; remaining: number }) {
  return {
    "X-RateLimit-Limit": String(rl.limit),
    "X-RateLimit-Used": String(rl.used),
    "X-RateLimit-Remaining": String(rl.remaining),
  };
}

interface Reference {
  title: string;
  year?: number | null;
  authors?: string[];
  venue?: string | null;
  citationCount?: number | null;
  url?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // GET /run-experiment → return current quota for this caller without consuming one.
  if (req.method === "GET") {
    let userId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      if (token && token !== ANON_KEY) {
        const userClient = createClient(SUPABASE_URL, ANON_KEY, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data } = await userClient.auth.getUser();
        userId = data.user?.id ?? null;
      }
    }
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    const ident = userId ? `user:${userId}` : `ip:${ip}`;
    const limit = userId ? 30 : 20;
    const since = new Date(Date.now() - 60 * 60_000).toISOString();
    const { count } = await supabase
      .from("rate_limits")
      .select("*", { count: "exact", head: true })
      .eq("identifier", ident).eq("kind", "run").gte("created_at", since);
    const used = count ?? 0;
    return new Response(JSON.stringify({
      limit, used, remaining: Math.max(0, limit - used), authenticated: !!userId,
    }), {
      headers: {
        ...corsHeaders, "Content-Type": "application/json",
        ...rateHeaders({ limit, used, remaining: Math.max(0, limit - used) }),
      },
    });
  }

  if (!LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: "Service not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let runId: string | null = null;
  try {
    const body = await req.json();
    const { hypothesis: rawHypothesis, owner_token } = body;
    const rawParentId: unknown = body.parent_run_id;
    const rawRefinement: unknown = body.refinement_instruction;

    if (!rawHypothesis || typeof rawHypothesis !== "string") {
      return new Response(JSON.stringify({ error: "hypothesis is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (rawHypothesis.length > 2000) {
      return new Response(JSON.stringify({ error: "Hypothesis must be under 2000 characters." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const validation = checkHypothesis(rawHypothesis);
    if (!validation.ok) {
      return new Response(JSON.stringify({ error: validation.reason }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const hypothesis = stripCtl(rawHypothesis).trim();
    const ownerToken = typeof owner_token === "string" ? stripCtl(owner_token).slice(0, 100) : null;

    // Optional refinement parameters (when refining a previous plan).
    const parentRunId = typeof rawParentId === "string" && /^[0-9a-f-]{36}$/i.test(rawParentId)
      ? rawParentId : null;
    const refinementInstruction = typeof rawRefinement === "string" && rawRefinement.trim().length > 0
      ? stripCtl(rawRefinement).trim().slice(0, 500) : null;
    const isRefinement = !!(parentRunId && refinementInstruction);

    // LLM-backed gate: reject inputs that clearly aren't hypotheses (jokes,
    // chatter, gibberish) BEFORE we burn rate-limit quota or AI credits.
    // Skipped for refinements — those have a validated parent.
    if (!isRefinement) {
      // (a) Deterministic feasibility pre-screen — block hypotheses that
      // violate well-established physical/biological limits (Abbe limit,
      // FTL, perpetual motion, etc.). Fast, free, no LLM needed.
      const feas = checkFeasibility(hypothesis);
      if (!feas.ok) {
        return new Response(JSON.stringify({
          error: `${feas.principle}: ${feas.explanation}`,
          suggestion: feas.suggestion,
          kind: "VALIDATION",
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // (b) LLM gate — rejects non-hypothesis inputs and overly-vague
      // research goals.
      const verdict = await gateHypothesis(hypothesis, LOVABLE_API_KEY);
      if (!verdict.ok) {
        return new Response(JSON.stringify({
          error: verdict.reason,
          suggestion: verdict.suggestion,
          kind: "VALIDATION",
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Resolve user (optional)
    let userId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      // The anon key is also a Bearer token — only attempt user lookup for non-anon JWTs.
      if (token && token !== ANON_KEY) {
        const userClient = createClient(SUPABASE_URL, ANON_KEY, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data } = await userClient.auth.getUser();
        userId = data.user?.id ?? null;
      }
    }

    // Rate limit: 30 runs / hour for signed-in users; 20 / hour per IP for anon.
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    const rlIdent = userId ? `user:${userId}` : `ip:${ip}`;
    const rl = await checkRateLimit(supabase, rlIdent, "run", 60, userId ? 30 : 20);
    if (!rl.ok) {
      return new Response(JSON.stringify({
        error: userId
          ? "You've reached the limit of 30 experiment runs per hour. Please try again later."
          : "Anonymous users are limited to 20 runs per hour. Sign in for a higher quota.",
      }), {
        status: 429,
        headers: {
          ...corsHeaders, "Content-Type": "application/json", ...rateHeaders(rl),
        },
      });
    }

    // Look up parent run (for refinement) and compute next version.
    let parentRun: { plan: unknown; qc: unknown; version: number } | null = null;
    let nextVersion = 1;
    if (isRefinement) {
      const { data: parent } = await supabase
        .from("runs")
        .select("plan, qc, version, hypothesis_hash, owner_user_id, owner_token")
        .eq("id", parentRunId)
        .maybeSingle();
      if (!parent || !parent.plan) {
        return new Response(JSON.stringify({ error: "Parent run not found." }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Ownership check: only the owner of the parent run may refine it.
      // Match either by signed-in user ID or by anonymous owner_token.
      const ownsByUser = userId && parent.owner_user_id === userId;
      const ownsByToken = ownerToken && parent.owner_token === ownerToken;
      if (!ownsByUser && !ownsByToken) {
        return new Response(JSON.stringify({ error: "You can only refine your own experiments." }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      parentRun = { plan: parent.plan, qc: parent.qc, version: parent.version ?? 1 };
      // Find max version in the chain (root + descendants).
      const { data: siblings } = await supabase
        .from("runs")
        .select("version")
        .or(`id.eq.${parentRunId},parent_run_id.eq.${parentRunId}`)
        .order("version", { ascending: false })
        .limit(1);
      nextVersion = ((siblings?.[0]?.version as number | undefined) ?? parentRun.version) + 1;
    }

    // Cache: skip cache lookup for refinements (they should always re-generate).
    const hHash = await hashHypothesis(hypothesis);

    // Idempotency: if THIS owner already has an in-flight run for the same
    // hypothesis, return that run instead of starting a duplicate. Catches
    // double-clicks and racing browser tabs.
    if (!isRefinement) {
      const ownerFilter = userId
        ? { col: "owner_user_id", val: userId }
        : ownerToken ? { col: "owner_token", val: ownerToken } : null;
      if (ownerFilter) {
        const { data: pending } = await supabase
          .from("runs")
          .select("id")
          .eq("hypothesis_hash", hHash)
          .eq(ownerFilter.col, ownerFilter.val)
          .in("status", ["pending", "qc", "plan"])
          .gt("updated_at", new Date(Date.now() - 5 * 60_000).toISOString())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (pending?.id) {
          // Return as SSE so the client's stream parser handles it uniformly.
          // Emits a single `run` event with in_flight=true, then `done`.
          const enc = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(enc.encode(`event: run\ndata: ${JSON.stringify({ id: pending.id, cached: false, in_flight: true })}\n\n`));
              controller.enqueue(enc.encode(`event: done\ndata: ${JSON.stringify({ id: pending.id })}\n\n`));
              controller.close();
            },
          });
          return new Response(stream, {
            headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
          });
        }
      }
    }

    const { data: cached } = isRefinement ? { data: null } : await supabase
      .from("runs")
      .select("id, qc, plan, critique")
      .eq("hypothesis_hash", hHash)
      .eq("status", "done")
      .is("parent_run_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Create run row (always create new row for ownership / share semantics, even when reusing data)
    const baseInsert = {
      hypothesis,
      owner_token: ownerToken,
      owner_user_id: userId,
      hypothesis_hash: hHash as string | null,
      status: (cached ? "done" : "qc") as "done" | "qc",
      qc: cached?.qc ?? (isRefinement ? parentRun?.qc ?? null : null),
      plan: cached?.plan ?? null,
      critique: cached?.critique ?? null,
      parent_run_id: isRefinement ? parentRunId : null,
      version: nextVersion,
      refinement_instruction: refinementInstruction,
    };

    let { data: created, error: createErr } = await supabase
      .from("runs")
      .insert(baseInsert)
      .select("id")
      .single();

    // A partial unique index on (hypothesis_hash) where status='done' can trip
    // when we're inserting a cached copy for a different owner. Retry once
    // without the hash — dedup is preserved on the original row.
    if (createErr && (createErr as { code?: string }).code === "23505") {
      const retry = await supabase
        .from("runs")
        .insert({ ...baseInsert, hypothesis_hash: null })
        .select("id")
        .single();
      created = retry.data;
      createErr = retry.error;
    }

    if (createErr || !created) {
      console.error("create run failed", createErr);
      return new Response(JSON.stringify({ error: "Could not start run" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    runId = created.id;


    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        try {
          send("run", { id: runId, cached: !!cached });

          // Cache hit — replay events instantly.
          if (cached) {
            send("qc", cached.qc);
            send("plan", cached.plan);
            if (cached.critique) send("critique", cached.critique);
            send("done", { id: runId });
            controller.close();
            return;
          }

          // 1) Literature QC — multi-source (S2 + OpenAlex + PubMed) + semantic novelty.
          //    Skip when refining (reuse parent's QC).
          let references: Reference[] = [];
          let qc: {
            signal: string;
            rationale: string;
            references: Reference[];
            sources_used?: { s2: boolean; openalex: boolean; pubmed: boolean };
            semantic_overlap?: "low" | "medium" | "high";
          };
          if (isRefinement && parentRun?.qc) {
            qc = parentRun.qc as typeof qc;
            references = qc.references ?? [];
            send("qc", qc);
            await supabase.from("runs").update({ status: "plan" }).eq("id", runId);
          } else {
            // For canonical techniques, prepend the technique name to bias
            // the literature search toward methods papers.
            const canon = detectCanonicalTechnique(hypothesis);
            const litQuery = canon.matched
              ? `${canon.technique} ${hypothesis}`
              : hypothesis;
            const lit = await searchLiterature(litQuery);

            // Re-rank candidates by token overlap with the hypothesis BEFORE
            // sending to the classifier. Drop anything below a minimum
            // overlap floor — those are noise and would mislead the
            // classifier into surfacing irrelevant references.
            const ranked = rankByRelevance(lit.papers, hypothesis);
            const RELEVANCE_FLOOR = 0.04;
            const filtered = ranked.filter((p) => p.relevance >= RELEVANCE_FLOOR);
            const candidates: LitPaper[] = (filtered.length > 0 ? filtered : ranked).slice(0, 8);
            console.log(JSON.stringify({
              run_id: runId, step: "lit_rerank",
              raw: lit.papers.length, kept: candidates.length,
              top_score: ranked[0]?.relevance ?? 0,
            }));

            const verdict = await classifyNovelty(hypothesis, candidates, LOVABLE_API_KEY);
            if (lit.rateLimited && lit.papers.length === 0) {
              verdict.rationale = "All literature sources rate-limited or unreachable. Treating as unknown novelty.";
            }

            // Canonical-technique override: only force `exact_match` when at
            // least one returned paper is genuinely on-topic (top relevance
            // above floor). Otherwise leave the classifier verdict alone.
            const topRelevance = ranked[0]?.relevance ?? 0;
            if (canon.matched && topRelevance >= RELEVANCE_FLOOR && verdict.signal !== "exact_match") {
              console.log(JSON.stringify({ run_id: runId, step: "canonical_override", technique: canon.technique, prev_signal: verdict.signal, top_relevance: topRelevance }));
              verdict.signal = "exact_match";
              verdict.semantic_overlap = "high";
              verdict.rationale = `${canon.rationale} ${verdict.rationale}`.trim();
              if (!verdict.chosen || verdict.chosen.length === 0) {
                verdict.chosen = candidates.slice(0, 3).map((_, i) => i);
              }
            }

            references = (verdict.chosen ?? [])
              .map((i: number) => candidates[i]).filter(Boolean).slice(0, 3)
              .map((p: LitPaper) => ({
                title: p.title,
                year: p.year,
                authors: p.authors,
                venue: p.venue,
                citationCount: p.citationCount,
                url: p.url,
                source: p.source,
              }));
            qc = {
              signal: verdict.signal,
              rationale: verdict.rationale,
              references,
              sources_used: lit.sources,
              semantic_overlap: verdict.semantic_overlap,
            };
            await supabase.from("runs").update({ qc, status: "plan" }).eq("id", runId);
            send("qc", qc);
          }

          // Deterministic safety pre-screen — feeds into the planner prompt so
          // the resulting plan addresses regulatory / containment requirements.
          const safetyFlags = screenSafety(hypothesis);

          // 2) Plan generation (streamed)
          const refContext = references.length
            ? `\n\nKNOWN RELATED WORK — use ONLY the strict canonical citation format:\n  • Bare reference:   [N]\n  • Multiple refs:    (see [N, M])\n  • DO NOT use any other form ((ref. 1), [ref. 1], (1), etc.)\n${references.map((r: Reference, i: number) => `[${i + 1}] ${r.title} (${r.year ?? "n.d."}) — ${r.url ?? ""}`).join("\n")}`
            : "";

          const refinementContext = isRefinement
            ? `\n\nREFINEMENT REQUEST — the user has an existing plan and wants you to revise it according to this instruction. Honour it strictly while keeping everything else operationally sound:\n"""${refinementInstruction}"""\n\nPREVIOUS PLAN (for context — do not repeat verbatim, produce a NEW complete plan reflecting the refinement):\n${JSON.stringify(parentRun?.plan).slice(0, 8000)}`
            : "";

          const system = `You are a senior scientist at a Contract Research Organisation. You convert a hypothesis into a complete, operationally realistic experiment plan that a real lab could pick up Monday and start running by Friday.

REQUIREMENTS:
- Ground the protocol in real, published methods (protocols.io, Bio-protocol, Nature Protocols, JOVE, OpenWetWare).
- Materials must include real suppliers (Sigma-Aldrich, Thermo Fisher, Promega, Qiagen, IDT, ATCC, Addgene) with plausible catalog numbers.
- Budget MUST be anchored to the REFERENCE COST CATALOG below — do not invent prices that are wildly off (>20%).
- Budget total MUST equal the sum of line items, and line items must roughly equal materials subtotal + labour + equipment + overhead.
- CITATIONS: Use ONLY the canonical format \`[N]\` (or \`(see [N, M])\` for multiples). N must be a 1-based index into the KNOWN RELATED WORK list. Never invent reference numbers; never use prose forms like "(ref. 1)" or "(see reference 1)".
- Timeline must be phased with explicit dependencies.
- The 'validation' section gives the qualitative approach.
- The 'statistical_design' section MUST be filled with a real power calculation: n_per_group justified by effect_size, alpha (typically 0.05), power (typically 0.8), randomization scheme, blinding strategy.
- The 'safety' section MUST be filled — biosafety_level, IRB/IACUC/IBC requirements, controlled substances, hazards, PPE, waste handling, emergency procedure. Address every category flagged in the SAFETY PRE-SCREEN below.
- Risks must be specific, not generic.
- Be precise. Use exact concentrations, volumes, durations.
${safetyPromptFragment(safetyFlags)}
${COST_CATALOG_PROMPT}`;


          // Streaming plan generation with model fallback. Once tokens are
          // flowing we can't switch mid-stream — but we can switch BEFORE the
          // first byte if the primary model 5xx's on connect.
          const { res: aiRes, modelUsed } = await callAIWithFallback({
            apiKey: LOVABLE_API_KEY,
            models: PLAN_MODELS,
            label: "plan-stream",
            timeoutMs: 90_000,
            buildBody: (model) => ({
              model,
              stream: true,
              temperature: 0.2,
              messages: [
                { role: "system", content: system },
                { role: "user", content: `HYPOTHESIS:\n${hypothesis}${refContext}${refinementContext}\n\nProduce the full experiment plan.` },
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
          console.log(JSON.stringify({ run_id: runId, step: "plan_model_chosen", model: modelUsed }));

          if (!aiRes.ok || !aiRes.body) {
            const text = await aiRes.text().catch(() => "");
            console.error("AI gateway error", aiRes.status, text);
            const kind: ErrorKind = classifyHttpError(aiRes.status, text);
            const msg = kind === "RATE_LIMIT"
              ? "Rate limit reached. Please try again shortly."
              : kind === "CREDITS"
              ? "AI credits exhausted. Top up in workspace settings."
              : kind === "POLICY"
              ? "The hypothesis was flagged by the model's safety filter."
              : "AI gateway error — please retry.";
            await supabase.from("runs").update({ status: "failed", error: encodeError(kind, msg) }).eq("id", runId);
            send("error", { message: msg, kind });
            controller.close();
            return;
          }

          // Stream tokens; emit a partial-plan parse periodically so the UI can render sections progressively.
          const reader = aiRes.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          let argsAccum = "";
          let lastEmit = 0;
          let lastHeartbeat = Date.now();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = buf.indexOf("\n")) !== -1) {
              let line = buf.slice(0, nl);
              buf = buf.slice(nl + 1);
              if (line.endsWith("\r")) line = line.slice(0, -1);
              if (!line.startsWith("data: ")) continue;
              const payload = line.slice(6).trim();
              if (payload === "[DONE]") break;
              try {
                const parsed = JSON.parse(payload);
                const argsDelta = parsed.choices?.[0]?.delta?.tool_calls?.[0]?.function?.arguments;
                if (typeof argsDelta === "string") {
                  argsAccum += argsDelta;
                  const now = Date.now();
                  if (now - lastEmit > 250) {
                    lastEmit = now;
                    const partial = tryParsePartial(argsAccum);
                    send("progress", { chars: argsAccum.length, partial });
                  }
                  // Heartbeat: bump updated_at every ~60s so the stale-run
                  // cleanup cron doesn't kill an actively-streaming generation.
                  if (now - lastHeartbeat > 60_000) {
                    lastHeartbeat = now;
                    supabase.from("runs").update({ updated_at: new Date().toISOString() })
                      .eq("id", runId).then(() => {/* fire-and-forget */});
                  }
                }
              } catch { /* partial chunk */ }
            }
          }

          let plan: unknown = null;
          try {
            plan = JSON.parse(argsAccum);
          } catch (e) {
            console.error("Failed to parse plan JSON", e);
            await supabase.from("runs").update({ status: "failed", error: encodeError("PARSE", "Model returned malformed plan.") }).eq("id", runId);
            send("error", { message: "Model returned malformed plan.", kind: "PARSE" });
            controller.close();
            return;
          }

          // Validate + normalise inline citations against the reference list.
          // Strips hallucinated [N] indices and rewrites prose forms to canonical [N].
          // deno-lint-ignore no-explicit-any
          const planObj = plan as any;
          if (planObj && Array.isArray(planObj.protocol)) {
            const { steps, report } = sanitizeCitationsWithReport(planObj.protocol, references.length);
            planObj.protocol = steps;
            if (report.hallucinated > 0 || report.rewritten > 0) {
              console.log("citation-sanitize", JSON.stringify({ run_id: runId, ...report, refs: references.length }));
            }
          }

          await supabase.from("runs").update({ plan: planObj, status: "done" }).eq("id", runId);
          send("plan", planObj);
          send("done", { id: runId });

          // 3) Reviewer critique pass (best-effort, fire-and-forget after main plan is sent).
          //    Feed catalog-mismatch findings as extra reviewer context so the
          //    critique surfaces wrong-form / wrong-cat# materials concretely.
          try {
            const catIssues = findCatalogIssues((planObj as { materials?: { name?: string; catalog_number?: string }[] })?.materials);
            const extraContext = catIssues.length
              ? `\n\nDETERMINISTIC CATALOG CHECK FOUND ${catIssues.length} MISMATCH(ES) — please raise these in 'concerns' with severity 'high':\n${catIssues.map(i => `- Material #${i.material_index + 1} declares "${i.declared_name}" with catalog number ${i.catalog_number}, but that catalog number is actually "${i.canonical_name}" (${i.reason}).`).join("\n")}`
              : "";
            if (catIssues.length) {
              console.log("catalog-check", JSON.stringify({ run_id: runId, issues: catIssues.length }));
            }
            const critique = await critiquePlan(hypothesis, plan, LOVABLE_API_KEY, extraContext);
            if (critique) {
              await supabase.from("runs").update({ critique }).eq("id", runId);
              send("critique", critique);
            }
          } catch (e) {
            console.error("critique failed", e);
          }

          controller.close();
        } catch (e) {
          console.error("stream error", e);
          if (runId) {
            await supabase.from("runs").update({ status: "failed", error: encodeError("INTERNAL", "Internal error") }).eq("id", runId);
          }
          try { send("error", { message: "Internal error", kind: "INTERNAL" }); } catch { /* noop */ }
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "x-run-id": runId ?? "",
      },
    });
  } catch (e) {
    console.error("run-experiment error", e);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Best-effort partial JSON parse: trims to the last balanced point so the client can show
// already-completed plan sections while later ones stream in.
function tryParsePartial(s: string): Record<string, unknown> | null {
  if (!s.trim().startsWith("{")) return null;
  let depth = 0, inStr = false, esc = false, lastValid = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") { depth--; if (depth === 0) lastValid = i; }
  }
  // Try progressively shorter candidates.
  const candidates = [s];
  if (lastValid > 0) candidates.push(s.slice(0, lastValid + 1));
  // Close any unclosed strings/objects/arrays naively.
  let trial = s;
  if (inStr) trial += '"';
  // Remove trailing comma if present
  trial = trial.replace(/,\s*$/, "");
  // Try to close braces/brackets:
  let toClose = depth;
  while (toClose-- > 0) trial += "}";
  candidates.push(trial);
  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* try next */ }
  }
  return null;
}
