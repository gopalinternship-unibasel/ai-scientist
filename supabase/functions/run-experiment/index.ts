import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { COST_CATALOG_PROMPT } from "./cost-catalog.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Expose-Headers": "x-run-id",
};

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
    "protocol", "materials", "budget", "timeline", "validation", "risks", "team",
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

interface S2Paper {
  paperId: string;
  title: string;
  abstract?: string | null;
  year?: number | null;
  authors?: { name: string }[];
  venue?: string | null;
  citationCount?: number | null;
  url?: string | null;
  externalIds?: Record<string, string> | null;
}

const stripCtl = (s: string) => s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

// Stable hash of a normalised hypothesis for caching.
async function hashHypothesis(h: string): Promise<string> {
  const norm = h.toLowerCase().replace(/\s+/g, " ").trim();
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(norm));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function searchSemanticScholar(query: string): Promise<{ papers: S2Paper[]; rateLimited: boolean }> {
  const q = query.replace(/\s+/g, " ").trim().slice(0, 280);
  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", q);
  url.searchParams.set("limit", "8");
  url.searchParams.set("fields", "title,abstract,year,authors.name,venue,citationCount,url,externalIds");

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url.toString(), { headers: { "User-Agent": "AI-Scientist/1.0 (Lovable)" } });
    if (res.ok) {
      const json = await res.json();
      return { papers: (json.data ?? []) as S2Paper[], rateLimited: false };
    }
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
    return { papers: [], rateLimited: false };
  }
  return { papers: [], rateLimited: true };
}

async function classifyNovelty(hypothesis: string, papers: S2Paper[], apiKey: string) {
  if (papers.length === 0) {
    return { signal: "not_found" as const, rationale: "No related work surfaced via Semantic Scholar.", chosen: [] as number[] };
  }
  const condensed = papers.slice(0, 8).map((p, i) => ({
    i, title: p.title, year: p.year, venue: p.venue, abstract: (p.abstract ?? "").slice(0, 600),
  }));
  const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: "You are a research librarian assessing novelty. Choose 1-3 most relevant papers." },
        { role: "user", content: `HYPOTHESIS:\n${hypothesis}\n\nCANDIDATES:\n${JSON.stringify(condensed)}` },
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
            },
            required: ["signal", "rationale", "chosen"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "report_novelty" } },
    }),
  });
  if (!aiRes.ok) {
    return { signal: "similar" as const, rationale: "Classification unavailable; defaulting to similar work exists.", chosen: [0, 1, 2] };
  }
  try {
    const aiJson = await aiRes.json();
    return JSON.parse(aiJson.choices[0].message.tool_calls[0].function.arguments);
  } catch {
    return { signal: "similar" as const, rationale: "Unable to parse classification.", chosen: [0, 1, 2] };
  }
}

async function critiquePlan(hypothesis: string, plan: unknown, apiKey: string) {
  const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: "You are a senior peer reviewer for an experimental biology / chemistry journal. Critically evaluate the proposed experiment plan for: missing controls, weak statistical power, ethical/safety oversights, unrealistic budgets or timelines, and gaps between hypothesis and protocol. Be specific and actionable." },
        { role: "user", content: `HYPOTHESIS:\n${hypothesis}\n\nPROPOSED PLAN:\n${JSON.stringify(plan).slice(0, 12000)}` },
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
): Promise<{ ok: boolean; remaining: number }> {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const { count } = await supabase
    .from("rate_limits")
    .select("*", { count: "exact", head: true })
    .eq("identifier", identifier)
    .eq("kind", kind)
    .gte("created_at", since);
  const used = count ?? 0;
  if (used >= max) return { ok: false, remaining: 0 };
  await supabase.from("rate_limits").insert({ identifier, kind });
  return { ok: true, remaining: max - used - 1 };
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
    if (rawHypothesis.length < 10 || rawHypothesis.length > 2000) {
      return new Response(JSON.stringify({ error: "Hypothesis must be 10-2000 characters." }), {
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

    // Rate limit: 5 runs / hour for signed-in users; 3 / hour per IP for anon.
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    const rlIdent = userId ? `user:${userId}` : `ip:${ip}`;
    const rl = await checkRateLimit(supabase, rlIdent, "run", 60, userId ? 5 : 3);
    if (!rl.ok) {
      return new Response(JSON.stringify({
        error: userId
          ? "You've reached the limit of 5 experiment runs per hour. Please try again later."
          : "Anonymous users are limited to 3 runs per hour. Sign in for a higher quota.",
      }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Look up parent run (for refinement) and compute next version.
    let parentRun: { plan: unknown; qc: unknown; version: number } | null = null;
    let nextVersion = 1;
    if (isRefinement) {
      const { data: parent } = await supabase
        .from("runs")
        .select("plan, qc, version, hypothesis_hash")
        .eq("id", parentRunId)
        .maybeSingle();
      if (parent && parent.plan) {
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
    }

    // Cache: skip cache lookup for refinements (they should always re-generate).
    const hHash = await hashHypothesis(hypothesis);
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
    const { data: created, error: createErr } = await supabase
      .from("runs")
      .insert({
        hypothesis,
        owner_token: ownerToken,
        owner_user_id: userId,
        hypothesis_hash: hHash,
        status: cached ? "done" : "qc",
        qc: cached?.qc ?? (isRefinement ? parentRun?.qc ?? null : null),
        plan: cached?.plan ?? null,
        critique: cached?.critique ?? null,
        parent_run_id: isRefinement ? parentRunId : null,
        version: nextVersion,
        refinement_instruction: refinementInstruction,
      })
      .select("id")
      .single();

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

          // 1) Literature QC — skip when refining (reuse parent's QC).
          let references: Reference[] = [];
          let qc: { signal: string; rationale: string; references: Reference[] };
          if (isRefinement && parentRun?.qc) {
            qc = parentRun.qc as typeof qc;
            references = qc.references ?? [];
            send("qc", qc);
            await supabase.from("runs").update({ status: "plan" }).eq("id", runId);
          } else {
            const { papers, rateLimited } = await searchSemanticScholar(hypothesis);
            const verdict = await classifyNovelty(hypothesis, papers, LOVABLE_API_KEY);
            if (rateLimited && papers.length === 0) {
              verdict.rationale = "Semantic Scholar is rate-limiting requests. Treating as unknown novelty.";
            }
            references = (verdict.chosen ?? [])
              .map((i: number) => papers[i]).filter(Boolean).slice(0, 3)
              .map((p: S2Paper) => ({
                title: p.title,
                year: p.year,
                authors: (p.authors ?? []).slice(0, 4).map((a) => a.name),
                venue: p.venue,
                citationCount: p.citationCount,
                url: p.url ?? (p.externalIds?.DOI
                  ? `https://doi.org/${p.externalIds.DOI}`
                  : `https://www.semanticscholar.org/paper/${p.paperId}`),
              }));
            qc = { signal: verdict.signal, rationale: verdict.rationale, references };
            await supabase.from("runs").update({ qc, status: "plan" }).eq("id", runId);
            send("qc", qc);
          }

          // 2) Plan generation (streamed)
          const refContext = references.length
            ? `\n\nKNOWN RELATED WORK (cite inline as [1], [2], [3] in the protocol description field where relevant):\n${references.map((r: Reference, i: number) => `[${i + 1}] ${r.title} (${r.year ?? "n.d."}) — ${r.url ?? ""}`).join("\n")}`
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
- For each protocol step, where a reference [N] is relevant, append "(see [N])" to the description text. Be conservative — only cite where the reference truly supports the step.
- Timeline must be phased with explicit dependencies.
- Validation must specify primary metric, controls, and statistical plan (n, test, alpha, power calculation).
- Risks must be specific, not generic.
- Be precise. Use exact concentrations, volumes, durations.
${COST_CATALOG_PROMPT}`;

          const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
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

          if (!aiRes.ok || !aiRes.body) {
            const text = await aiRes.text().catch(() => "");
            console.error("AI gateway error", aiRes.status, text);
            const msg = aiRes.status === 429
              ? "Rate limit reached. Please try again shortly."
              : aiRes.status === 402
              ? "AI credits exhausted. Top up in workspace settings."
              : "AI gateway error";
            await supabase.from("runs").update({ status: "failed", error: msg }).eq("id", runId);
            send("error", { message: msg });
            controller.close();
            return;
          }

          // Stream tokens; emit a partial-plan parse periodically so the UI can render sections progressively.
          const reader = aiRes.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          let argsAccum = "";
          let lastEmit = 0;
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
                }
              } catch { /* partial chunk */ }
            }
          }

          let plan: unknown = null;
          try {
            plan = JSON.parse(argsAccum);
          } catch (e) {
            console.error("Failed to parse plan JSON", e);
            await supabase.from("runs").update({ status: "failed", error: "Model returned malformed plan." }).eq("id", runId);
            send("error", { message: "Model returned malformed plan." });
            controller.close();
            return;
          }

          await supabase.from("runs").update({ plan, status: "done" }).eq("id", runId);
          send("plan", plan);
          send("done", { id: runId });

          // 3) Reviewer critique pass (best-effort, fire-and-forget after main plan is sent).
          try {
            const critique = await critiquePlan(hypothesis, plan, LOVABLE_API_KEY);
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
            await supabase.from("runs").update({ status: "failed", error: "Internal error" }).eq("id", runId);
          }
          try { send("error", { message: "Internal error" }); } catch { /* noop */ }
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
