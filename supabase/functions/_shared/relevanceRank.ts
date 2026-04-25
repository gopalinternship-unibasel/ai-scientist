// Re-rank literature candidates by token overlap with the hypothesis.
//
// Why: the OpenAlex/S2/PubMed APIs do raw keyword matching, so degraded
// queries can return broadly-related but off-topic papers (e.g. a query for
// "trehalose graphene nanofiber" returns a generic "carbon nanomaterials"
// review). Before passing to the LLM novelty classifier, sort candidates so
// the most-overlapping titles come first — the classifier picks from the
// top-N anyway, so this directly improves the references shown to users.
//
// Pure heuristic: Jaccard overlap on lowercased non-stopword tokens of
// (title + abstract) vs (hypothesis). No external calls.

import type { LitPaper } from "./literature.ts";

const STOP = new Set([
  "the","a","an","and","or","but","of","in","on","at","to","for","with","by",
  "from","as","is","are","was","were","be","been","being","this","that",
  "these","those","will","would","should","could","may","might","can","do",
  "does","did","than","then","so","such","into","via","between","across",
  "within","without","over","under","using","use","used","not","no","nor",
  "we","our","their","its","it","also","only","more","less","least","most",
  "compared","comparison","versus","vs","up","down","out","off","if","when",
  "while","where","what","which","who","whom","because","due","per","each",
  "every","any","all","some","none","study","studies","analysis","review",
  "approach","method","methods","results","data","based","novel","new",
]);

function tokenSet(s: string): Set<string> {
  const out = new Set<string>();
  for (const raw of s.toLowerCase().replace(/[^\p{L}\p{N}\-/.\s]/gu, " ").split(/\s+/)) {
    const t = raw.replace(/^[-/.]+|[-/.]+$/g, "");
    if (t.length >= 3 && !STOP.has(t) && !/^\d+(?:\.\d+)?$/.test(t)) out.add(t);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export interface RankedPaper extends LitPaper {
  relevance: number;
}

/**
 * Score each paper against the hypothesis and return them sorted desc.
 * Ties broken by `citationCount`, then by source priority (s2 > openalex > pubmed).
 */
export function rankByRelevance(papers: LitPaper[], hypothesis: string): RankedPaper[] {
  const hSet = tokenSet(hypothesis);
  const sourceWeight: Record<string, number> = { s2: 3, openalex: 2, pubmed: 1 };
  const scored: RankedPaper[] = papers.map((p) => {
    const text = `${p.title ?? ""} ${p.abstract ?? ""}`;
    const score = jaccard(hSet, tokenSet(text));
    return { ...p, relevance: score };
  });
  scored.sort((a, b) => {
    if (b.relevance !== a.relevance) return b.relevance - a.relevance;
    const c = (b.citationCount ?? 0) - (a.citationCount ?? 0);
    if (c !== 0) return c;
    return (sourceWeight[b.source] ?? 0) - (sourceWeight[a.source] ?? 0);
  });
  return scored;
}
