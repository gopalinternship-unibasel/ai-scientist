// Deterministic check of the novelty classifier's verdict against the
// retrieved papers.
//
// The classifier is an LLM; with the small local model it contradicted its
// own evidence (QA round 2, 9 Nov 2026):
//  - the metformin / palmitate / HepG2 hypothesis was labelled "not found,
//    likely novel" while its three references were palmitate-treated HepG2
//    lipid papers, which the prompt's own rubric calls "similar";
//  - NMN raising NAD+ (well published) was "not_found" together with
//    "semantic overlap: high";
//  - "exact match" was claimed with references that share almost nothing
//    with the hypothesis.
// The candidates' relevance (relevanceRank.ts: the weighted share of the
// hypothesis concepts a paper mentions) settles those cases:
//  - not_found with an on-topic candidate becomes similar;
//  - exact_match needs a candidate that names the core of the hypothesis
//    (its cell line or organism, compound and named measurands); otherwise
//    it becomes similar, or not_found when nothing is on-topic;
//  - semantic_overlap follows the verdict (low for not_found, high for
//    exact_match, at least medium for similar);
//  - references the classifier chose that are off-topic are dropped, and a
//    corrected verdict cites the most relevant candidates.
// Import-free apart from hypothesisTerms.ts (no Deno or browser APIs).

import type { Concept } from "./hypothesisTerms.ts";
import { anchorConcepts, mentions, textWords } from "./hypothesisTerms.ts";

/** A retrieved paper with its relevance (relevanceRank.ts RankedPaper fits). */
export interface ScoredPaper {
  title: string;
  abstract?: string | null;
  /** Weighted share of the hypothesis concepts the paper mentions (0-1). */
  relevance: number;
  /** The hypothesis concepts (query spellings) the paper mentions. */
  matched: string[];
  /** Cosine similarity of the paper's embedding to the hypothesis, when embeddings ran (embeddingRelevance.ts). */
  embed_similarity?: number;
}

export type NoveltySignal = "not_found" | "similar" | "exact_match";
export type Overlap = "low" | "medium" | "high";

export interface NoveltyVerdict {
  signal: NoveltySignal;
  rationale: string;
  chosen: number[];
  semantic_overlap: Overlap;
  /** Set when this check changed the classifier's verdict. */
  corrected_from?: NoveltySignal;
}

/** A candidate at least this relevant is prior work on the same topic. */
export const ON_TOPIC = 0.35;
/** A chosen reference below this is off-topic and is not shown. */
export const REFERENCE_FLOOR = 0.2;
/** Share of the anchor concepts' weight an exact match must name. */
export const EXACT_CORE_SHARE = 0.85;
/**
 * An exact match must also be this close in the embedding model, when it ran.
 * QA round 3 probe (10 Nov 2026): the sodium butyrate / Caco-2 barrier paper
 * that tests the butyrate hypothesis' claim scored 0.81; papers that share
 * only "3D-printed polylactic acid" with a Dsup-coating hypothesis at most
 * 0.75.
 */
export const EXACT_EMBED_MIN = 0.78;
/**
 * With fewer than two anchor concepts the core says little ("3D-printed" was
 * the whole core of the Dsup hypothesis, so any 3D-printing paper named it):
 * an exact match must then also cover this much of all the hypothesis' terms.
 */
export const EXACT_THIN_CORE_RELEVANCE = 0.5;

function shortTitle(t: string): string {
  return t.length > 90 ? `${t.slice(0, 87).trimEnd()}...` : t;
}

/**
 * Weighted share of the anchor concepts (anchorConcepts: cell line or
 * organism, compound, named measurands and topic, comparators excluded) that
 * a paper's title and abstract name. "Metformin regulates palmitate-induced
 * apoptosis ... in HepG2 cells" names 80% of the metformin / palmitate /
 * HepG2 / lipid hypothesis: same system and intervention, another outcome,
 * so not an exact match.
 */
export function coreShare(concepts: Concept[], paper: { title?: string; abstract?: string | null }): number {
  const core = anchorConcepts(concepts);
  const total = core.reduce((s, c) => s + c.weight, 0);
  if (total === 0) return 0;
  const words = textWords(`${paper.title ?? ""} ${paper.abstract ?? ""}`);
  return core.filter((c) => mentions(words, c)).reduce((s, c) => s + c.weight, 0) / total;
}

export function calibrateNovelty(
  verdict: NoveltyVerdict,
  candidates: ScoredPaper[],
  concepts: Concept[],
): NoveltyVerdict {
  const out: NoveltyVerdict = { ...verdict, chosen: [...(verdict.chosen ?? [])] };
  const onTopic = candidates
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.relevance >= ON_TOPIC)
    .sort((a, b) => b.p.relevance - a.p.relevance);

  // Off-topic picks are not references.
  out.chosen = out.chosen.filter((i) => (candidates[i]?.relevance ?? 0) >= REFERENCE_FLOOR);

  const cite = (n: number) => onTopic.slice(0, n).map(({ i }) => i);
  const named = (i: number) => {
    const p = candidates[i];
    const terms = p.matched.slice(0, 4).join(", ");
    return `"${shortTitle(p.title)}"${terms ? ` (shares ${terms})` : ""}`;
  };

  if (out.signal === "not_found" && onTopic.length > 0) {
    out.corrected_from = "not_found";
    out.signal = "similar";
    if (out.chosen.length === 0) out.chosen = cite(3);
    out.rationale = `Related prior work was retrieved: ${named(out.chosen[0])}. The classifier had answered "not found"; the automated check changed that to "similar" because retrieved papers cover the hypothesis' key terms.${verdict.rationale ? ` Classifier note: ${verdict.rationale}` : ""}`;
  } else if (out.signal === "exact_match") {
    const thinCore = anchorConcepts(concepts).length < 2;
    const qualifies = (p: ScoredPaper) =>
      (p.embed_similarity === undefined || p.embed_similarity >= EXACT_EMBED_MIN)
      && (!thinCore || p.relevance >= EXACT_THIN_CORE_RELEVANCE);
    const best = candidates
      .map((p, i) => ({ i, share: qualifies(p) ? coreShare(concepts, p) : 0 }))
      .sort((a, b) => b.share - a.share)[0];
    if (!best || best.share < EXACT_CORE_SHARE) {
      out.corrected_from = "exact_match";
      out.signal = onTopic.length > 0 ? "similar" : "not_found";
      out.chosen = out.signal === "similar" ? (out.chosen.length ? out.chosen : cite(3)) : [];
      out.rationale = out.signal === "similar"
        ? `Related prior work was retrieved (${named(out.chosen[0])}), but no retrieved paper names the core of this hypothesis, so it is not an exact match. The classifier had answered "exact match".`
        : `No retrieved paper covers the key terms of this hypothesis. The classifier had answered "exact match"; the automated check changed that to "not found".`;
    }
  }

  if (out.signal === "exact_match" && out.chosen.length === 0) {
    // Cite the paper that names the hypothesis' core first.
    const best = candidates.map((p, i) => ({ i, share: coreShare(concepts, p) }))
      .filter((b) => (candidates[b.i]?.relevance ?? 0) >= REFERENCE_FLOOR)
      .sort((a, b) => b.share - a.share).slice(0, 3).map((b) => b.i);
    out.chosen = best;
  }
  if (out.signal === "similar" && out.chosen.length === 0) out.chosen = cite(3);
  if (out.signal === "not_found") out.chosen = out.chosen.filter((i) => (candidates[i]?.relevance ?? 0) >= ON_TOPIC);

  out.semantic_overlap = out.signal === "not_found"
    ? "low"
    : out.signal === "exact_match"
    ? "high"
    : verdict.semantic_overlap === "high" || verdict.semantic_overlap === "medium" ? verdict.semantic_overlap : "medium";
  return out;
}
