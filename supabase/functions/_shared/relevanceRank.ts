// Re-rank literature candidates by how much of the hypothesis they cover.
//
// Why: the OpenAlex/S2/PubMed APIs do raw keyword matching, so degraded
// queries can return broadly-related but off-topic papers (e.g. a query for
// "trehalose graphene nanofiber" returns a generic "carbon nanomaterials"
// review). Before passing to the LLM novelty classifier, sort candidates so
// the most relevant come first; the classifier picks from the top-N, and the
// novelty verdict check (noveltyVerdict.ts) reads the same scores.
//
// Score: the weighted share of the hypothesis' concepts (hypothesisTerms.ts:
// cell lines and genes weigh most, then compounds and acronyms, then topic
// nouns) that the title, and the title + abstract, mention (paperRelevance). Until 9 Nov 2026 it was a
// Jaccard overlap of all words, which a long abstract dilutes and which
// counts "cells" as much as "metformin". No external calls.

import type { LitPaper } from "./literature.ts";
import { type Concept, hypothesisConcepts, paperRelevance } from "./hypothesisTerms.ts";

export interface RankedPaper extends LitPaper {
  /** Weighted share of the hypothesis concepts the paper mentions (0-1). */
  relevance: number;
  /** The hypothesis concepts (query spellings) the paper mentions. */
  matched: string[];
}

/** Candidates below this score are off-topic for an ordinary hypothesis. */
export const RELEVANCE_FLOOR = 0.2;
/** Canonical techniques: methods papers have generic titles, so accept less. */
export const CANONICAL_RELEVANCE_FLOOR = 0.1;

/**
 * Score each paper against the hypothesis and return them sorted desc.
 * Ties broken by `citationCount`, then by source priority (s2 > openalex > pubmed).
 */
export function rankByRelevance(papers: LitPaper[], hypothesis: string, concepts?: Concept[]): RankedPaper[] {
  const cs = concepts ?? hypothesisConcepts(hypothesis);
  const sourceWeight: Record<string, number> = { s2: 3, openalex: 2, pubmed: 1 };
  const scored: RankedPaper[] = papers.map((p) => {
    const cov = paperRelevance(cs, p.title ?? "", p.abstract);
    return { ...p, relevance: Math.round(cov.score * 1000) / 1000, matched: cov.matched.map((c) => c.query) };
  });
  scored.sort((a, b) => {
    if (b.relevance !== a.relevance) return b.relevance - a.relevance;
    const c = (b.citationCount ?? 0) - (a.citationCount ?? 0);
    if (c !== 0) return c;
    return (sourceWeight[b.source] ?? 0) - (sourceWeight[a.source] ?? 0);
  });
  return scored;
}
