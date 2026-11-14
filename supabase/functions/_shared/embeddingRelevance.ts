// Embedding check of the literature candidates before the novelty
// classifier sees them, and before any of them is shown or cited.
//
// QA round 3 (NMN run b4d82571): the word-overlap ranking (relevanceRank.ts)
// kept "HYDROGENASE**Abbreviations: ATP ..." (1974), "The Uncatalyzed
// Reduction of Flavin Mononucleotide (FMN) by NADH" and a Lithocarpus
// extract paper because they share "NAD+", "NADH" and "nicotinamide" with
// the hypothesis; the classifier itself said two of them were not relevant,
// yet the verdict check cited them and the protocol steps used them as
// sources. Each candidate's title and abstract is now embedded together with
// the hypothesis (the local nomic-embed-text, the model the feedback loop
// already uses) and dropped when it is far from the hypothesis.
//
// nomic-embed-text expects task prefixes: "search_query: " for the
// hypothesis and "search_document: " for the papers. Its cosines are
// compressed: for the QA's six hypotheses (probe embed-probe.ts in
// _e2e/ai-research-assistant-fix/round4/, kept outside this repository, 10 Nov 2026) every
// retrieved biology paper scored 0.68-0.88, on-topic ones 0.71-0.88, and
// the QA's three irrelevant NMN papers (titles only, as the run stored
// them) 0.70, 0.65 and 0.51 against an
// on-topic best of 0.86. So the cut is relative: a paper is kept when it is
// within LIT_EMBED_MARGIN (0.15) of the best candidate and above the floor
// LIT_EMBED_MIN_SIMILARITY (0.66). That drops all three NMN papers and none
// of the on-topic papers of the other five hypotheses. It cannot tell an
// on-topic paper from one that shares only the material ("3D-printed
// polylactic acid" papers for a Dsup-coating hypothesis scored 0.68-0.75);
// the word coverage in noveltyVerdict.ts still decides "on-topic".
//
// When no embedding model is configured or the call fails, the candidates
// pass unchanged and the result says so (`available: false`).

import { embedTexts } from "./embeddings.ts";
import { denoSetting, fractionSetting } from "./thresholds.ts";

export const DEFAULT_LIT_EMBED_MIN_SIMILARITY = 0.66;
export const DEFAULT_LIT_EMBED_MARGIN = 0.15;

function envNumber(name: string, fallback: number): number {
  return fractionSetting(denoSetting(name), fallback);
}

export function litEmbedMinSimilarity(): number {
  return envNumber("LIT_EMBED_MIN_SIMILARITY", DEFAULT_LIT_EMBED_MIN_SIMILARITY);
}

export function litEmbedMargin(): number {
  return envNumber("LIT_EMBED_MARGIN", DEFAULT_LIT_EMBED_MARGIN);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

export interface PaperText {
  title?: string | null;
  abstract?: string | null;
}

/** The text a paper is embedded as. */
export function paperDocument(p: PaperText): string {
  return `search_document: ${(p.title ?? "").trim()}. ${(p.abstract ?? "").trim().slice(0, 1500)}`;
}

export function hypothesisQuery(hypothesis: string): string {
  return `search_query: ${(hypothesis ?? "").trim()}`;
}

export type WithEmbedSimilarity<T> = T & { embed_similarity?: number };

export interface EmbeddingFilterResult<T> {
  /** Candidates at or above the threshold, in their original order, with embed_similarity set. */
  kept: WithEmbedSimilarity<T>[];
  /** Candidates below it. */
  dropped: WithEmbedSimilarity<T>[];
  /** False when no embedding was available (everything kept). */
  available: boolean;
  /** The cut actually applied: max(floor, best - margin). */
  threshold: number;
  best?: number;
}

/**
 * Keep the candidates whose title + abstract embedding is close to the
 * hypothesis: at least `floor` cosine and within `margin` of the best
 * candidate. `embed` defaults to the configured provider (embeddings.ts);
 * tests pass their own.
 */
export async function filterByEmbedding<T extends PaperText>(
  hypothesis: string,
  papers: T[],
  opts: { floor?: number; margin?: number; embed?: (texts: string[]) => Promise<number[][] | null> } = {},
): Promise<EmbeddingFilterResult<T>> {
  const floor = opts.floor ?? litEmbedMinSimilarity();
  const margin = opts.margin ?? litEmbedMargin();
  if (papers.length === 0) return { kept: [], dropped: [], available: true, threshold: floor };
  const vecs = await (opts.embed ?? embedTexts)([hypothesisQuery(hypothesis), ...papers.map(paperDocument)]).catch(() => null);
  if (!vecs || vecs.length !== papers.length + 1) {
    return { kept: papers.map((p) => ({ ...p })), dropped: [], available: false, threshold: floor };
  }
  const [q, ...docs] = vecs;
  const scored = papers.map((p, i) => ({ ...p, embed_similarity: Math.round(cosine(q, docs[i]) * 1000) / 1000 }));
  const best = Math.max(...scored.map((p) => p.embed_similarity));
  const threshold = Math.round(Math.max(floor, best - margin) * 1000) / 1000;
  return {
    kept: scored.filter((p) => p.embed_similarity >= threshold),
    dropped: scored.filter((p) => p.embed_similarity < threshold),
    available: true,
    threshold,
    best,
  };
}
