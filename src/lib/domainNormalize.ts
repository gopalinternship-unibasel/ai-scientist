// Mirror of supabase/functions/_shared/domainNormalize.ts for client use.
// Kept in sync by hand; if you change one, change the other.
//
// Why duplicate? The shared file lives under supabase/functions and uses
// Deno-style imports — Vite/TS in src/ can't reach it cleanly without
// bundler config gymnastics. The logic is small and stable, so a manual
// mirror is the pragmatic call.

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
  [/\b(graphene|composite|alloy|polymer|tensile|young'?s\s+modulus|crystal\s+structure|lattice)/i, "materials-science"],
  [/\b(nano(particle|wire|tube|rod)|quantum\s+dot|self[\s-]?assembl)/i, "nanotechnology"],
  [/\b(quantum|relativ|photon|particle\s+physics|condensed\s+matter|superconduct)/i, "physics"],
  [/\b(finite\s+element|mechanical\s+design|circuit|microcontroll|cad|fluid\s+dynamics)/i, "engineering"],
  [/\b(neural\s+network|deep\s+learning|transformer|llm|gradient\s+descent|reinforcement\s+learning)/i, "machine-learning"],
  [/\b(algorithm|compiler|database|distributed\s+system|operating\s+system)/i, "computer-science"],
];

export function normalizeDomain(...inputs: Array<string | null | undefined>): CanonicalDomain {
  const blob = inputs.filter(Boolean).join(" ").toLowerCase();
  if (!blob.trim()) return "other";
  // An input that is a canonical name on its own wins: the run's stored
  // domain is passed next to the hypothesis, and joined together
  // ("cell-biology <hypothesis>") they matched no name, so feedback on a
  // cell-biology run was stored under "other" (QA round 4).
  for (const raw of inputs) {
    const one = (raw ?? "").trim().toLowerCase();
    if (!one) continue;
    for (const d of DOMAINS) {
      if (d !== "other" && (one === d || one.replace(/[\s_]+/g, "-") === d)) return d;
    }
  }
  for (const d of DOMAINS) {
    if (blob === d || blob.replace(/[\s_]+/g, "-") === d) return d;
  }
  for (const [re, dom] of RULES) {
    if (re.test(blob)) return dom;
  }
  return "other";
}

// Cheap spam / quality filter for free-text feedback corrections.
// Returns null when text passes; otherwise a user-facing reason string.
const URL_RE = /(https?:\/\/|www\.)\S+/gi;
const REPEATED_CHAR_RE = /(.)\1{6,}/;

export function validateCorrection(raw: string): string | null {
  const text = (raw ?? "").trim();
  if (text.length < 8) return "Please write at least 8 characters.";
  if (text.length > 2000) return "Please keep corrections under 2000 characters.";
  if (REPEATED_CHAR_RE.test(text)) return "Looks like spam — too many repeated characters.";
  const urlChars = (text.match(URL_RE) ?? []).join("").length;
  if (urlChars / text.length > 0.5) return "Please describe the issue in your own words, not just links.";
  // mostly non-letters → likely spam
  const letters = (text.match(/[a-zA-Z]/g) ?? []).length;
  if (letters / text.length < 0.3) return "Please write in plain language.";
  return null;
}
