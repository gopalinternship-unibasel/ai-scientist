// The novelty verdict as the run page shows it. Runs since 9 Nov 2026 were
// checked server-side (supabase/functions/_shared/noveltyVerdict.ts; the
// classifier's own answer is kept in qc.classifier_signal). Older runs get the
// same check here, on the references they stored (titles only), so their
// pages no longer show "not found" next to on-topic papers, "not found" with
// "semantic overlap: high", or "exact match" with off-topic papers (QA round
// 2: runs 020ae70a, 633e1d4f, b015232c). The stored row is not changed.
import { hypothesisConcepts, paperRelevance } from "../../supabase/functions/_shared/hypothesisTerms.ts";
import { calibrateNovelty, type ScoredPaper } from "../../supabase/functions/_shared/noveltyVerdict.ts";
import { detectCanonicalTechnique } from "../../supabase/functions/_shared/canonicalTechniques.ts";
import type { LiteratureQC } from "./samples";

export type ShownQC = LiteratureQC & { classifier_signal?: string; novelty_checked?: boolean };

export function displayQc(qc: ShownQC, hypothesis: string | null | undefined): ShownQC {
  if (!qc || qc.novelty_checked || qc.classifier_signal || !hypothesis) return qc;
  // A textbook protocol request keeps its canonical "exact match".
  if (qc.signal === "exact_match" && detectCanonicalTechnique(hypothesis).matched) return qc;
  const concepts = hypothesisConcepts(hypothesis);
  const refs = qc.references ?? [];
  const candidates: ScoredPaper[] = refs.map((r) => {
    const cov = paperRelevance(concepts, r.title ?? "", null);
    return { title: r.title ?? "", relevance: cov.score, matched: cov.matched.map((c) => c.query) };
  });
  const v = calibrateNovelty({
    signal: qc.signal,
    rationale: qc.rationale,
    chosen: refs.map((_, i) => i),
    semantic_overlap: qc.semantic_overlap ?? "medium",
  }, candidates, concepts);
  const unchanged = v.signal === qc.signal && v.chosen.length === refs.length;
  if (unchanged && v.semantic_overlap === (qc.semantic_overlap ?? v.semantic_overlap)) return qc;
  return {
    ...qc,
    signal: v.signal,
    semantic_overlap: v.semantic_overlap,
    rationale: v.corrected_from ? v.rationale : qc.rationale,
    references: v.chosen.map((i) => refs[i]).filter(Boolean),
    ...(v.corrected_from ? { classifier_signal: v.corrected_from } : {}),
  };
}
