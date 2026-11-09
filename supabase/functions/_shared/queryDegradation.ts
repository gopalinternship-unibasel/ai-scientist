// Reduce a long, fully-specified hypothesis sentence into progressively
// broader keyword queries so the literature APIs (which do keyword matching,
// not semantic search) still return hits.
//
// Used by `searchLiterature`: each source tries the queries in order and
// merges the hits until it has enough candidates.

import { coreQuery, hypothesisConcepts, keywordQuery } from "./hypothesisTerms.ts";

/**
 * The most search-worthy keywords of a hypothesis, heaviest first by the
 * weighting in hypothesisTerms.ts (cell lines and genes, compounds and
 * acronyms, topic nouns), returned in sentence order so the query reads
 * naturally. Until 9 Nov 2026 this took salient-list words, capitals and
 * then words in sentence order, so "Treating HepG2 hepatocytes with 10 uM
 * metformin ... palmitate ... lipid accumulation" became "treating hepg2
 * hepatocytes metformin hours": the queries lost palmitate and lipid.
 */
export function extractKeywords(hypothesis: string, k = 6): string[] {
  const concepts = hypothesisConcepts(hypothesis).filter((c) => !c.comparator).slice(0, k);
  return concepts.sort((a, b) => a.pos - b.pos).map((c) => c.query);
}

// Common scientific abbreviations → expanded forms. Literature APIs do
// keyword matching: a paper indexed under "5-fluorouracil" won't match "5-FU".
// When any of these abbreviations appear in the hypothesis, we generate an
// extra query with the expanded form to recover those hits.
const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\b5-?FU\b/i, "5-fluorouracil"],
  [/\bara-?C\b/i, "cytarabine"],
  [/\bDOX\b/, "doxorubicin"],
  [/\bCDDP\b/, "cisplatin"],
  [/\bMTX\b/, "methotrexate"],
  [/\bLPS\b/, "lipopolysaccharide"],
  [/\bPMA\b/, "phorbol myristate acetate"],
  [/\bIFN-?γ\b|\bIFNg\b|\bIFN-?gamma\b/i, "interferon gamma"],
  [/\bTNF-?α\b|\bTNFa\b|\bTNF-?alpha\b/i, "tumor necrosis factor alpha"],
  [/\bIL-?(\d+)\b/i, "interleukin"],
  [/\bMPP[1-4]\b/, "multipotent progenitor"],
  [/\bHSPCs?\b/, "hematopoietic stem progenitor"],
  [/\bHSCs?\b/, "hematopoietic stem cell"],
  [/\bBMDMs?\b/, "bone marrow derived macrophage"],
  [/\bDCs?\b/, "dendritic cell"],
  [/\bMSCs?\b/, "mesenchymal stem cell"],
  [/\bPBMCs?\b/, "peripheral blood mononuclear cell"],
  [/\bGFP\b/, "green fluorescent protein"],
  [/\bRT-?qPCR\b/i, "reverse transcription quantitative PCR"],
  [/\bIHC\b/, "immunohistochemistry"],
  [/\bIF\b(?=\s+(?:staining|imaging|microscopy))/, "immunofluorescence"],
  [/\bFACS\b/, "fluorescence activated cell sorting"],
  [/\bAAV\b/, "adeno-associated virus"],
  [/\bCAR-?T\b/i, "chimeric antigen receptor T cell"],
  // Materials science / batteries
  [/\bLiFePO4\b/i, "lithium iron phosphate"],
  [/\bLFP\b/, "lithium iron phosphate"],
  [/\bLiCoO2\b/i, "lithium cobalt oxide"],
  [/\bLiMn2O4\b/i, "lithium manganese oxide"],
  [/\bNMC\b|\bNCM\b/, "nickel manganese cobalt"],
  [/\bNCA\b/, "nickel cobalt aluminum"],
  [/\bSEI\b/, "solid electrolyte interphase"],
];

// Normalize Unicode subscripts/superscripts to ASCII so "LiFePO₄" matches
// papers indexed as "LiFePO4". Applied before keyword extraction and
// abbreviation expansion.
const SUBSCRIPT_MAP: Record<string, string> = {
  "₀":"0","₁":"1","₂":"2","₃":"3","₄":"4","₅":"5","₆":"6","₇":"7","₈":"8","₉":"9",
  "⁰":"0","¹":"1","²":"2","³":"3","⁴":"4","⁵":"5","⁶":"6","⁷":"7","⁸":"8","⁹":"9",
};
function normalizeUnicodeNumerics(s: string): string {
  return s.replace(/[₀-₉⁰-⁹]/g, (c) => SUBSCRIPT_MAP[c] ?? c);
}

/** Replace abbreviations in `s` with their expansions. Returns null if nothing changed. */
function expandAbbreviations(s: string): string | null {
  let out = s;
  let changed = false;
  for (const [re, exp] of ABBREVIATIONS) {
    if (re.test(out)) {
      out = out.replace(re, exp);
      changed = true;
    }
  }
  return changed ? out : null;
}

/**
 * Build a sequence of progressively-broader query strings, from
 * full-hypothesis at the top to a 2-keyword core at the bottom.
 *
 * If the hypothesis contains common scientific abbreviations (5-FU, MPP3,
 * IFN-γ, …), we also emit expanded variants — literature APIs index papers
 * under the long form and won't match the abbreviation.
 *
 * The caller fires them in order until one returns hits.
 */
export function degradedQueries(hypothesis: string): string[] {
  // Normalize Unicode subscripts/superscripts up-front (LiFePO₄ → LiFePO4)
  // so both keyword extraction and abbreviation expansion can match.
  const normalized = normalizeUnicodeNumerics(hypothesis);
  const full = normalized.replace(/\s+/g, " ").trim().slice(0, 280);
  const expandedFull = expandAbbreviations(full);
  const concepts = hypothesisConcepts(normalized);
  const expanded = expandedFull ? hypothesisConcepts(expandedFull) : [];

  const out: string[] = [full];
  // Also include the raw original if it differed (covers papers indexed with the unicode form).
  if (full !== hypothesis.replace(/\s+/g, " ").trim().slice(0, 280)) {
    out.push(hypothesis.replace(/\s+/g, " ").trim().slice(0, 280));
  }
  // Interleave expanded variants so they fire early enough to matter.
  if (expandedFull) out.push(expandedFull);
  // Keyword queries from the most specific (5 heaviest concepts) to the
  // broadest (2), then the intervention and outcome without the system.
  for (const k of [5, 4, 3]) {
    if (concepts.length >= k) out.push(keywordQuery(concepts, k));
    if (expanded.length >= k) out.push(keywordQuery(expanded, k));
  }
  const core = coreQuery(concepts);
  if (core) out.push(core);
  if (concepts.length >= 2) out.push(keywordQuery(concepts, 2));

  // Dedup while preserving order.
  const seen = new Set<string>();
  return out.filter((q) => {
    const k = q.toLowerCase().trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
