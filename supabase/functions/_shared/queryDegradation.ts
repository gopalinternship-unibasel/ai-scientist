// Reduce a long, fully-specified hypothesis sentence into progressively
// broader keyword queries so the literature APIs (which do keyword matching,
// not semantic search) still return hits.
//
// Used by `searchLiterature` when the full-hypothesis query yields 0 papers.

const STOP = new Set([
  "the","a","an","and","or","but","of","in","on","at","to","for","with","by",
  "from","as","is","are","was","were","be","been","being","this","that",
  "these","those","will","would","should","could","may","might","can","do",
  "does","did","than","then","so","such","into","via","between","across",
  "within","without","over","under","using","use","used","not","no","nor",
  "we","our","their","its","it","also","only","more","less","least","most",
  "least","compared","comparison","versus","vs","at","up","down","out","off",
  "if","when","while","where","what","which","who","whom","because","due",
  "increase","decrease","reduce","reduces","increases","reducing","increasing",
  "least","at","per","each","every","any","all","some","none",
]);

// Domain salience boost — words that almost always identify a real research
// topic. We weight these higher when picking keywords.
const SALIENT = new RegExp(
  String.raw`\b(` +
  [
    "PCR","qPCR","RT-PCR","CRISPR","Cas9","RNA[- ]?seq","scRNA[- ]?seq",
    "ELISA","ChIP[- ]?seq","ATAC[- ]?seq","western\\s+blot","flow\\s+cytometry",
    "microscopy","confocal","cryo[- ]?EM","mass\\s+spec","HPLC","NMR",
    "knockout","knock[- ]?in","transfection","transduction","viability",
    "apoptosis","proliferation","differentiation","polarization","expression",
    "biomarker","biosensor","immunoassay","sequencing","amplification",
    "mouse","mice","rat","zebrafish","axolotl","Drosophila","C\\.\\s*elegans",
    "Arabidopsis","E\\.\\s*coli","yeast","bacteri[au]m?","arch[ae]a",
    "HeLa","HEK293","A549","K562","Jurkat","MCF[- ]?7",
    "tumor","cancer","carcinoma","leukemia","lymphoma","glioma",
    "neuron","neural","cardiac","hepatic","renal","pulmonary",
    "GAPDH","p53","BRCA1","BRCA2","CFTR","EGFR","KRAS","TP53","MYC",
    "Lactobacillus","Bacillus","Streptomyces","Saccharomyces","Halobacterium",
    "trehalose","sucrose","DMSO","cryoprotectant","biosensor","nanofiber",
    "nanoparticle","microparticle","hydrogel","scaffold","polymer",
    "graphene","silicon","gold","silver","copper","platinum",
    "phycocyanin","Spirulina","oncolytic","virus","virotherapy",
  ].join("|") +
  String.raw`)\b`,
  "gi",
);

/** Tokenise + lower + drop stopwords + drop pure numbers. */
function tokens(s: string): string[] {
  return s
    .toLowerCase()
    // keep hyphens inside words (e.g. C57BL/6, RT-PCR), strip other punctuation
    .replace(/[^\p{L}\p{N}\-/.\s]/gu, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[-/.]+|[-/.]+$/g, ""))
    .filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+(?:\.\d+)?$/.test(t));
}

/**
 * Pick the most "search-worthy" keywords from a hypothesis. Strategy:
 *  1. Pull every salient term (gene names, organisms, methods, materials).
 *  2. Add the top capitalised proper-nouns / acronyms.
 *  3. Pad with the highest-TF non-stopword tokens to reach `k`.
 *
 * Returned in original-document order so the resulting query reads naturally.
 */
export function extractKeywords(hypothesis: string, k = 6): string[] {
  const picks = new Set<string>();

  // 1) Salient domain terms (case-insensitive match, normalise whitespace).
  for (const m of hypothesis.matchAll(SALIENT)) {
    picks.add(m[0].replace(/\s+/g, " ").trim());
    if (picks.size >= k) break;
  }

  // 2) Acronyms / capitalised tokens (e.g. CFTR, HeLa, GAPDH, NRC-1).
  if (picks.size < k) {
    const caps = hypothesis.match(/\b[A-Z][A-Z0-9]{2,}(?:-[A-Z0-9]+)*\b/g) ?? [];
    for (const c of caps) {
      picks.add(c);
      if (picks.size >= k) break;
    }
  }

  // 3) Term-frequency among non-stopwords.
  if (picks.size < k) {
    const tf = new Map<string, number>();
    for (const t of tokens(hypothesis)) tf.set(t, (tf.get(t) ?? 0) + 1);
    const ranked = [...tf.entries()].sort((a, b) => b[1] - a[1]);
    for (const [t] of ranked) {
      picks.add(t);
      if (picks.size >= k) break;
    }
  }

  // De-dup case-insensitively while preserving the first-seen casing.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of picks) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out.slice(0, k);
}

/**
 * Build a sequence of progressively-broader query strings, from
 * full-hypothesis at the top to a 2-keyword core at the bottom.
 *
 * The caller fires them in order until one returns hits.
 */
export function degradedQueries(hypothesis: string): string[] {
  const full = hypothesis.replace(/\s+/g, " ").trim().slice(0, 280);
  const kw = extractKeywords(hypothesis, 6);
  const out: string[] = [full];
  if (kw.length >= 4) out.push(kw.slice(0, Math.min(5, kw.length)).join(" "));
  if (kw.length >= 2) out.push(kw.slice(0, Math.min(3, kw.length)).join(" "));
  // Dedup neighbouring identical entries (very short hypotheses).
  return out.filter((q, i) => i === 0 || q !== out[i - 1]);
}
