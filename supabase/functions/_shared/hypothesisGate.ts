// Cheap, fast LLM gate that rejects inputs that clearly aren't testable
// scientific hypotheses BEFORE we spend a plan-generation budget on them.
//
// Returns one of:
//   - { ok: true }                       → continue to plan generation
//   - { ok: false, reason, suggestion }  → bail with a 400 to the client
//
// We use the cheapest model in the chain (gemini-flash-lite via FAST_MODELS).
// Fail-open: if the gateway is down or the model errors, we let the request
// through rather than block legitimate users.

import { callAIWithFallback } from "./ai-fallback.ts";

const GATE_MODELS = ["google/gemini-2.5-flash-lite", "google/gemini-3-flash-preview"];

export interface GateVerdict {
  ok: boolean;
  reason?: string;
  suggestion?: string;
}

export async function gateHypothesis(hypothesis: string, apiKey: string): Promise<GateVerdict> {
  // Short-circuit: anything under ~3 real words is almost certainly not a
  // hypothesis. Saves the round-trip.
  const words = hypothesis.trim().split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (words.length < 3) {
    return {
      ok: false,
      reason: "Your input is too short to be a testable hypothesis.",
      suggestion: "Describe an intervention, the system you're testing it on, and a measurable outcome.",
    };
  }

  try {
    const { res } = await callAIWithFallback({
      apiKey,
      models: GATE_MODELS,
      label: "hypothesis-gate",
      timeoutMs: 15_000,
      retries: 0,
      buildBody: (model) => ({
        model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You decide whether a user's text is a testable scientific hypothesis suitable for designing a wet-lab or computational experiment. ACCEPT if it (a) names a concrete intervention or system being studied AND (b) implies a measurable outcome — even if the wording is informal. REJECT only when the input is clearly NOT a research question (personal anecdotes, jokes, off-topic chatter, single isolated words, instructions to the AI, marketing copy, etc.). Be permissive: vague but on-topic research goals like 'improve cancer treatment' should be ACCEPTED.",
          },
          { role: "user", content: hypothesis },
        ],
        tools: [{
          type: "function",
          function: {
            name: "decide",
            parameters: {
              type: "object",
              properties: {
                is_hypothesis: { type: "boolean", description: "true if input is a research question / hypothesis suitable for experiment design" },
                category: {
                  type: "string",
                  enum: ["scientific_hypothesis", "vague_research_goal", "personal_chatter", "off_topic", "instruction_to_ai", "gibberish", "other"],
                },
                reason: { type: "string", description: "One short sentence explaining the decision (user-facing)." },
                suggestion: { type: "string", description: "If rejected, a short tip on how to rewrite it as a hypothesis." },
              },
              required: ["is_hypothesis", "category", "reason"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "decide" } },
      }),
    });

    if (!res.ok) {
      // Fail-open on gateway error — better to occasionally let a bad input
      // through than to block legitimate users when the model is flaky.
      try { await res.body?.cancel(); } catch { /* noop */ }
      return { ok: true };
    }
    const json = await res.json();
    const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return { ok: true };
    const parsed = JSON.parse(args) as {
      is_hypothesis: boolean; category: string; reason?: string; suggestion?: string;
    };

    // Only the clearly-bad categories are blocked. "vague_research_goal"
    // passes through — the planner can handle it.
    const HARD_REJECT = new Set(["personal_chatter", "off_topic", "instruction_to_ai", "gibberish"]);
    if (!parsed.is_hypothesis && HARD_REJECT.has(parsed.category)) {
      return {
        ok: false,
        reason: parsed.reason || "That doesn't look like a testable scientific hypothesis.",
        suggestion: parsed.suggestion || "Rewrite it as: 'In [system], applying [intervention] will produce [measurable outcome] compared to [control].'",
      };
    }
    return { ok: true };
  } catch (e) {
    console.warn("[hypothesis-gate] error, failing open:", (e as Error).message);
    return { ok: true };
  }
}
