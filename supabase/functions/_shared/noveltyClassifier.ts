// The LLM novelty classifier (moved out of run-experiment/index.ts so the
// model-comparison harness and the tests call the same prompt).
//
// The classifier picks the most relevant candidates and gives a coarse
// signal (not_found / similar / exact_match) with a semantic-overlap label.
// Its verdict is then held to the retrieved evidence by calibrateNovelty
// (noveltyVerdict.ts).

import { callAIWithFallback, FAST_MODELS } from "./ai-fallback.ts";
import { extractToolArgs } from "./aiProvider.ts";
import type { NoveltyVerdict } from "./noveltyVerdict.ts";
import { scrubCandidateRefs } from "./planGuards.ts";

export interface ClassifierCandidate {
  title: string;
  year?: number | null;
  venue?: string | null;
  source?: string;
  abstract?: string | null;
}

export async function classifyNovelty(
  hypothesis: string,
  papers: ClassifierCandidate[],
  apiKey: string,
): Promise<NoveltyVerdict> {
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
    retries: 0,
    timeoutMs: 20_000,
    maxTokens: 600,
    buildBody: (model) => ({
      model,
      messages: [
        { role: "system", content: "You are a research librarian assessing whether a hypothesis has prior art. Use this rubric:\n  • exact_match  — at least one candidate tests essentially the same claim (same intervention + same system + same outcome direction), even with minor wording differences.\n  • similar     — at least one candidate shares the technique AND topic area but differs on system, organism, or specific intervention. Default to this when in doubt and any candidate is on-topic.\n  • not_found   — every candidate is clearly off-topic (different field, different question).\nAlso report semantic_overlap (low/medium/high). Pick 1–3 most-relevant indices in `chosen`. ONLY pick papers that are genuinely on-topic; if none of the candidates are relevant, return chosen:[] and signal:not_found.\n\nWriting style for `rationale`: refer to papers by a short descriptor of their content (e.g. \"the thyroid cancer guideline\", \"the angiogenesis-inhibitor review\") or a brief quoted title fragment. NEVER use phrases like \"Candidate 0\", \"Candidate 1\", or index numbers — users do not see the index list. Keep it to 1–3 sentences." },
        { role: "user", content: `HYPOTHESIS:\n${hypothesis}\n\nCANDIDATES (already pre-ranked by token overlap; the first entry is most overlapping). Use the \`i\` field only for the structured \`chosen\` output, never in your prose rationale:\n${JSON.stringify(condensed)}` },
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
    const parsed = JSON.parse(extractToolArgs(aiJson) ?? "");
    if (!["not_found", "similar", "exact_match"].includes(parsed?.signal)) throw new Error("bad signal");
    if (!Array.isArray(parsed.chosen)) parsed.chosen = [];
    // Indices must point into the candidate list the model was shown.
    parsed.chosen = parsed.chosen.filter((i: unknown) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < condensed.length);
    // Users never see the candidate list: "Candidate 2" becomes the paper's title.
    if (typeof parsed.rationale === "string") {
      parsed.rationale = scrubCandidateRefs(parsed.rationale, condensed.map((c) => c.title));
    }
    return parsed;
  } catch {
    return { signal: "similar" as const, rationale: "Unable to parse classification.", chosen: [0, 1, 2], semantic_overlap: "medium" as const };
  }
}
