// Shared planner pieces extracted so the eval harness can call the SAME
// prompt + schema as the production /run-experiment pipeline. Keeping these
// here (instead of importing from run-experiment/index.ts) avoids cross-
// function entrypoint coupling and lets each function deploy independently.
//
// Anything that affects plan *quality* lives here. Anything that affects
// persistence, streaming, rate-limits or idempotency stays in run-experiment.

import { costCatalogPrompt } from "./costCatalog.ts";
import { safetyPromptFragment, type SafetyFlags } from "./safety.ts";
import { houseRulesPromptFragment, type HouseRule } from "./houseRules.ts";
import { feedbackPromptFragment, type FeedbackHint } from "./feedbackRetrieval.ts";

// JSON schema for the planner tool call. Kept in sync with run-experiment.
// If you change one, change both — there's a runtime schema-equality test
// in run-experiment/index_test.ts to catch drift.
export const planSchema = {
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
          applied_lessons: { type: "array", items: { type: "string" } },
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
          applied_lessons: { type: "array", items: { type: "string" } },
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
        properties: {
          risk: { type: "string" },
          mitigation: { type: "string" },
          applied_lessons: { type: "array", items: { type: "string" } },
        },
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

// Builds the planner system prompt — character-for-character the one used in
// production. Keep in sync with run-experiment/index.ts.
export function buildPlannerSystemPrompt(opts: {
  safetyFlags: SafetyFlags;
  houseRules: HouseRule[];
  feedbackHints: FeedbackHint[];
  domain: string | null;
  /** Picks the cost-catalog topic groups shown (costCatalogPrompt). */
  hypothesis?: string;
}): string {
  const houseRulesContext = houseRulesPromptFragment(opts.houseRules, opts.domain);
  const feedbackContext = feedbackPromptFragment(opts.feedbackHints);
  return `You are a senior scientist at a Contract Research Organisation. You convert a hypothesis into a complete, operationally realistic experiment plan that a real lab could pick up Monday and start running by Friday.

REQUIREMENTS:
- Ground the protocol in real, published methods (protocols.io, Bio-protocol, Nature Protocols, JOVE, OpenWetWare).
- Materials MUST be what THIS experiment uses: the compound or intervention under test, the cell line or organism, and the reagents or kit for the primary readout named in the hypothesis come first. Never fill the list with unrelated catalog items.
- Materials must include real suppliers (Sigma-Aldrich, Thermo Fisher, Promega, Qiagen, IDT, ATCC, Addgene). Catalog numbers MUST be ones you are confident exist on the supplier's site — if you are uncertain, set catalog_number to "Custom" or omit it. Do NOT fabricate plausible-looking SKUs. Sigma SKUs follow patterns like T9531, PHR1084-1G; Thermo Fisher uses 7–9 digit numbers (11965092) or letter+digits (A3160401); IDT Alt-R reagents are 1081xxx; ATCC uses CCL-2, CRL-3216, HTB-22.
- Budget MUST be anchored to the REFERENCE COST CATALOG below — do not invent prices that are wildly off (>20%).
- Budget total MUST equal the sum of line items, and line items must roughly equal materials subtotal + labour + equipment + overhead.
- Protocol step \`source\` (optional): when a step follows an entry of the KNOWN RELATED WORK list, its number in brackets, e.g. [1]; otherwise a short plain label such as "manufacturer's instructions", or leave it out. NEVER write a URL, DOI, PMID or paper title that is not in that list. Unlisted sources are removed before the plan is shown.
- CITATIONS: Use ONLY the canonical format \`[N]\` (or \`(see [N, M])\` for multiples). N must be a 1-based index into the KNOWN RELATED WORK list. Never invent reference numbers; never use prose forms like "(ref. 1)" or "(see reference 1)".
- Timeline must be phased with explicit dependencies.
- The 'validation' section gives the qualitative approach.
- The 'statistical_design' section MUST be filled with a real power calculation: n_per_group justified by effect_size, alpha (typically 0.05), power (typically 0.8), randomization scheme, blinding strategy.
- The 'safety' section MUST be filled — biosafety_level, IRB/IACUC/IBC requirements, controlled substances, hazards, PPE, waste handling, emergency procedure. Address every category flagged in the SAFETY PRE-SCREEN below.
- Risks must be specific, not generic.
- Be precise. Use exact concentrations, volumes, durations.
${safetyPromptFragment(opts.safetyFlags)}
${costCatalogPrompt(opts.hypothesis ?? "")}${houseRulesContext}${feedbackContext}`;
}

// Builds the user-message body — references + hypothesis. Mirrors production.
export function buildPlannerUserMessage(opts: {
  hypothesis: string;
  references: Array<{ title: string; year?: number | null; url?: string }>;
}): string {
  const refContext = opts.references.length
    ? `\n\nKNOWN RELATED WORK — use ONLY the strict canonical citation format:
  • Bare reference:   [N]
  • Multiple refs:    (see [N, M])
  • DO NOT use any other form ((ref. 1), [ref. 1], (1), etc.)
${opts.references.map((r, i) => `[${i + 1}] ${r.title} (${r.year ?? "n.d."}) — ${r.url ?? ""}`).join("\n")}`
    : "";
  return `HYPOTHESIS:
${opts.hypothesis}${refContext}

Produce the full experiment plan.`;
}
