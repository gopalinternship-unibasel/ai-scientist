import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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
        properties: {
          risk: { type: "string" },
          mitigation: { type: "string" },
        },
        required: ["risk", "mitigation"],
        additionalProperties: false,
      },
    },
    team: {
      type: "array",
      items: {
        type: "object",
        properties: {
          role: { type: "string" },
          fte: { type: "number" },
        },
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

async function searchSemanticScholar(query: string): Promise<{ papers: S2Paper[]; rateLimited: boolean }> {
  const q = query.replace(/\s+/g, " ").trim().slice(0, 280);
  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", q);
  url.searchParams.set("limit", "8");
  url.searchParams.set("fields", "title,abstract,year,authors.name,venue,citationCount,url,externalIds");

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "AI-Scientist/1.0 (Lovable)" },
    });
    if (res.ok) {
      const json = await res.json();
      return { papers: (json.data ?? []) as S2Paper[], rateLimited: false };
    }
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    console.error("Semantic Scholar error", res.status);
    return { papers: [], rateLimited: false };
  }
  return { papers: [], rateLimited: true };
}

async function classifyNovelty(
  hypothesis: string,
  papers: S2Paper[],
  apiKey: string,
): Promise<{ signal: "not_found" | "similar" | "exact_match"; rationale: string; chosen: number[] }> {
  if (papers.length === 0) {
    return { signal: "not_found", rationale: "No related work surfaced via Semantic Scholar.", chosen: [] };
  }
  const condensed = papers.slice(0, 8).map((p, i) => ({
    i, title: p.title, year: p.year, venue: p.venue,
    abstract: (p.abstract ?? "").slice(0, 600),
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
    return { signal: "similar", rationale: "Classification unavailable; defaulting to similar work exists.", chosen: [0, 1, 2] };
  }
  try {
    const aiJson = await aiRes.json();
    return JSON.parse(aiJson.choices[0].message.tool_calls[0].function.arguments);
  } catch {
    return { signal: "similar", rationale: "Unable to parse classification.", chosen: [0, 1, 2] };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  if (!LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: "Service not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let runId: string | null = null;
  try {
    const { hypothesis: rawHypothesis, owner_token } = await req.json();
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

    // 1) Create run row
    const { data: created, error: createErr } = await supabase
      .from("runs")
      .insert({ hypothesis, owner_token: ownerToken, status: "qc" })
      .select("id")
      .single();
    if (createErr || !created) {
      console.error("create run failed", createErr);
      return new Response(JSON.stringify({ error: "Could not start run" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    runId = created.id;

    // SSE response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        try {
          send("run", { id: runId });

          // 2) Literature QC
          const { papers, rateLimited } = await searchSemanticScholar(hypothesis);
          const verdict = await classifyNovelty(hypothesis, papers, LOVABLE_API_KEY);
          if (rateLimited && papers.length === 0) {
            verdict.rationale = "Semantic Scholar is rate-limiting requests. Treating as unknown novelty.";
          }
          const references = (verdict.chosen ?? [])
            .map((i) => papers[i])
            .filter(Boolean)
            .slice(0, 3)
            .map((p) => ({
              title: p.title,
              year: p.year,
              authors: (p.authors ?? []).slice(0, 4).map((a) => a.name),
              venue: p.venue,
              citationCount: p.citationCount,
              url: p.url ?? (p.externalIds?.DOI
                ? `https://doi.org/${p.externalIds.DOI}`
                : `https://www.semanticscholar.org/paper/${p.paperId}`),
            }));
          const qc = { signal: verdict.signal, rationale: verdict.rationale, references };

          await supabase.from("runs").update({ qc, status: "plan" }).eq("id", runId);
          send("qc", qc);

          // 3) Plan generation (streamed)
          const refContext = references.length
            ? `\n\nKNOWN RELATED WORK:\n${references.map((r, i) => `[${i + 1}] ${r.title} (${r.year ?? "n.d."}) — ${r.url ?? ""}`).join("\n")}`
            : "";

          const system = `You are a senior scientist at a Contract Research Organisation. You convert a hypothesis into a complete, operationally realistic experiment plan that a real lab could pick up Monday and start running by Friday.

REQUIREMENTS:
- Ground the protocol in real, published methods (protocols.io, Bio-protocol, Nature Protocols, JOVE, OpenWetWare).
- Materials must include real suppliers (Sigma-Aldrich, Thermo Fisher, Promega, Qiagen, IDT, ATCC, Addgene) with plausible catalog numbers and unit costs in USD.
- Budget must be realistic and itemised; total must equal sum of line items.
- Timeline must be phased with explicit dependencies.
- Validation must specify primary metric, controls, and statistical plan (n, test, alpha, power).
- Risks must be specific, not generic.
- Be precise. Use exact concentrations, volumes, durations.`;

          const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              stream: true,
              messages: [
                { role: "system", content: system },
                { role: "user", content: `HYPOTHESIS:\n${hypothesis}${refContext}\n\nProduce the full experiment plan.` },
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
              ? "Lovable AI credits exhausted. Add credits in Settings → Workspace → Usage."
              : "AI gateway error";
            await supabase.from("runs").update({ status: "failed", error: msg }).eq("id", runId);
            send("error", { message: msg });
            controller.close();
            return;
          }

          // Stream and accumulate tool-call arguments
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
                const delta = parsed.choices?.[0]?.delta;
                const argsDelta = delta?.tool_calls?.[0]?.function?.arguments;
                if (typeof argsDelta === "string") {
                  argsAccum += argsDelta;
                  // Throttle progress events to ~5/sec
                  const now = Date.now();
                  if (now - lastEmit > 200) {
                    lastEmit = now;
                    send("progress", { chars: argsAccum.length });
                  }
                }
              } catch {
                // partial chunk; ignore
              }
            }
          }

          let plan: unknown = null;
          try {
            plan = JSON.parse(argsAccum);
          } catch (e) {
            console.error("Failed to parse plan JSON", e, argsAccum.slice(0, 500));
            await supabase.from("runs").update({ status: "failed", error: "Model returned malformed plan." }).eq("id", runId);
            send("error", { message: "Model returned malformed plan." });
            controller.close();
            return;
          }

          await supabase.from("runs").update({ plan, status: "done" }).eq("id", runId);
          send("plan", plan);
          send("done", { id: runId });
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
