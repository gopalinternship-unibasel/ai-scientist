// Domain normalizer — maps free-text plan.domain into a small controlled
// vocabulary so cross-run feedback retrieval can compare apples to apples.
//
// Used by BOTH the planner edge function (when persisting runs.domain) and
// the client (before inserting plan_feedback.domain). Keep this file pure
// JS/TS so it can be imported from either runtime without bundler tricks.

export const DOMAINS = [
  "cell-biology",
  "molecular-biology",
  "biochemistry",
  "microbiology",
  "neuroscience",
  "immunology",
  "genetics",
  "genomics",
  "proteomics",
  "pharmacology",
  "clinical",
  "ecology",
  "plant-biology",
  "chemistry",
  "organic-chemistry",
  "materials-science",
  "nanotechnology",
  "physics",
  "engineering",
  "computer-science",
  "machine-learning",
  "other",
] as const;

export type CanonicalDomain = (typeof DOMAINS)[number];

// Keyword → canonical. Order matters: more specific patterns first.
const RULES: Array<[RegExp, CanonicalDomain]> = [
  [/\b(crispr|pcr|qpcr|rna[\s-]?seq|sequencing|gene\s+expression|plasmid|transfection|knockout)\b/i, "molecular-biology"],
  [/\b(cell\s+culture|hela|ips[c]?|stem\s+cell|fluorescence\s+microscop|flow\s+cytometry|mitochond)/i, "cell-biology"],
  [/\b(enzyme|kinase|protein\s+(folding|purif)|western\s+blot|elisa|chromatograph)\b/i, "biochemistry"],
  [/\b(bacter|e\.?\s?coli|yeast|fungal|biofilm|antibiotic|microbiom)/i, "microbiology"],
  [/\b(neur(on|al)|brain|synap|fmri|eeg|optogenet|axon|dendrit)/i, "neuroscience"],
  [/\b(t\s?cell|b\s?cell|cytokine|antibod|immune|vaccine|inflamm)/i, "immunology"],
  [/\b(gwas|snp|allele|hereditar|mendel|haplotyp)/i, "genetics"],
  [/\b(genom(e|ic)|exome|metagenom|whole[\s-]?genome)/i, "genomics"],
  [/\b(proteom|mass\s+spec|peptide\s+identif)/i, "proteomics"],
  [/\b(drug|pharmaco|ic50|ec50|dose[\s-]?response|pk\/pd|adme)/i, "pharmacology"],
  [/\b(clinical\s+trial|patient|cohort|randomi[sz]ed|placebo|biomarker)/i, "clinical"],
  [/\b(ecosystem|biodivers|species\s+richness|habitat|climate\s+change)/i, "ecology"],
  [/\b(arabidopsis|maize|wheat|photosynth|chloroplast|root\s+system)/i, "plant-biology"],
  [/\b(catalys|reaction\s+mechanism|nmr|reflux|reagent\s+synthesis|organic\s+synthesis)/i, "organic-chemistry"],
  [/\b(electrochem|inorganic|coordination\s+complex|spectroscop)/i, "chemistry"],
  [/\b(graphene|composite|alloy|polymer|tensile|young's\s+modulus|crystal\s+structure|lattice)/i, "materials-science"],
  [/\b(nano(particle|wire|tube|rod)|quantum\s+dot|self[\s-]?assembl)/i, "nanotechnology"],
  [/\b(quantum|relativ|photon|particle\s+physics|condensed\s+matter|superconduct)/i, "physics"],
  [/\b(finite\s+element|mechanical\s+design|circuit|microcontroll|cad|fluid\s+dynamics)/i, "engineering"],
  [/\b(neural\s+network|deep\s+learning|transformer|llm|gradient\s+descent|reinforcement\s+learning)/i, "machine-learning"],
  [/\b(algorithm|compiler|database|distributed\s+system|operating\s+system)/i, "computer-science"],
];

// Normalise a free-text domain string OR fall back to scanning text content
// (hypothesis, plan summary). Returns 'other' if nothing matches.
export function normalizeDomain(...inputs: Array<string | null | undefined>): CanonicalDomain {
  const blob = inputs.filter(Boolean).join(" ").toLowerCase();
  if (!blob.trim()) return "other";

  // 1) If the input is already an exact canonical, accept it.
  for (const d of DOMAINS) {
    if (blob === d || blob.replace(/[\s_]+/g, "-") === d) return d;
  }
  // 2) Pattern match.
  for (const [re, dom] of RULES) {
    if (re.test(blob)) return dom;
  }
  return "other";
}
