import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const planSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    domain: { type: "string", description: "e.g., Diagnostics, Cell Biology, Climate, Gut Health" },
    summary: { type: "string", description: "1-2 sentence executive summary." },
    hypothesis_restated: { type: "string" },
    success_criteria: {
      type: "array",
      items: { type: "string" },
      description: "Measurable thresholds that constitute success.",
    },
    protocol: {
      type: "array",
      description: "Ordered protocol steps grounded in real published methods.",
      items: {
        type: "object",
        properties: {
          step: { type: "integer" },
          title: { type: "string" },
          description: { type: "string" },
          duration: { type: "string", description: "e.g., '2 hours', 'overnight'." },
          source: { type: "string", description: "Reference protocol (e.g. protocols.io DOI, Nature Protocols ref)." },
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
              category: { type: "string", description: "Reagents, Consumables, Equipment, Personnel, Overhead" },
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
          duration: { type: "string", description: "e.g., 'Week 1-2'" },
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
          fte: { type: "number", description: "Full-time equivalent (0-1)." },
        },
        required: ["role", "fte"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "title",
    "domain",
    "summary",
    "hypothesis_restated",
    "success_criteria",
    "protocol",
    "materials",
    "budget",
    "timeline",
    "validation",
    "risks",
    "team",
  ],
  additionalProperties: false,
} as const;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { hypothesis, references } = await req.json();
    if (!hypothesis || typeof hypothesis !== "string") {
      return new Response(JSON.stringify({ error: "hypothesis is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const refContext = Array.isArray(references) && references.length
      ? `\n\nKNOWN RELATED WORK (use to ground the protocol; cite by title in step sources where appropriate):\n${references
          .map((r: any, i: number) => `[${i + 1}] ${r.title} (${r.year ?? "n.d."}) — ${r.url ?? ""}`)
          .join("\n")}`
      : "";

    const system = `You are a senior scientist at a Contract Research Organisation. You convert a hypothesis into a complete, operationally realistic experiment plan that a real lab could pick up Monday and start running by Friday.

REQUIREMENTS:
- Ground the protocol in real, published methods (protocols.io, Bio-protocol, Nature Protocols, JOVE, OpenWetWare). Cite specific protocol IDs/DOIs when known.
- Materials must include real suppliers (Sigma-Aldrich, Thermo Fisher, Promega, Qiagen, IDT, ATCC, Addgene) and plausible catalog numbers and unit costs in USD.
- Budget must be realistic and itemised; total must equal the sum of line items.
- Timeline must be phased with explicit dependencies.
- Validation must specify a primary metric, controls, and a statistical plan (n, test, alpha, power).
- Risks must be specific to the experiment, not generic.
- Be precise. Use exact concentrations, volumes, durations.`;

    const body = {
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: system },
        { role: "user", content: `HYPOTHESIS:\n${hypothesis}${refContext}\n\nProduce the full experiment plan.` },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "submit_experiment_plan",
            description: "Submit the complete experiment plan.",
            parameters: planSchema,
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "submit_experiment_plan" } },
    };

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!aiRes.ok) {
      const text = await aiRes.text();
      console.error("AI gateway error", aiRes.status, text);
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit reached. Please try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiRes.status === 402) {
        return new Response(
          JSON.stringify({ error: "Lovable AI credits exhausted. Add credits in Settings → Workspace → Usage." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiRes.json();
    const call = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    if (!call?.function?.arguments) {
      console.error("No tool call returned", JSON.stringify(aiJson).slice(0, 1000));
      return new Response(JSON.stringify({ error: "Model returned no plan." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const plan = JSON.parse(call.function.arguments);
    return new Response(JSON.stringify({ plan }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-plan error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
