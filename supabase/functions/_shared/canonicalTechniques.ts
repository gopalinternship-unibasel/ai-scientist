// Detect when a hypothesis describes a textbook-canonical technique
// (PCR, Western blot, ELISA, etc.). Used to override the novelty classifier
// when it incorrectly returns `not_found` for protocols that are obviously
// extensively published.
//
// Heuristic: if the hypothesis matches one of the known method patterns AND
// at least one literature hit was returned, we promote the signal to
// `exact_match` — it's almost certainly not novel work.

interface CanonicalTechnique {
  name: string;
  // Pattern must match the hypothesis (case-insensitive).
  pattern: RegExp;
  // Optional: if this pattern ALSO matches, the technique is NOT considered
  // canonical (e.g. growth curve + CRISPRi → the perturbation is the real subject).
  disqualifyIf?: RegExp;
  // Human-readable rationale shown to the user when this rule fires.
  rationale: string;
}

const TECHNIQUES: CanonicalTechnique[] = [
  {
    name: "PCR amplification",
    pattern: /\b(?:standard\s+)?(?:RT-?|q)?PCR\b.*\bamplif/i,
    rationale: "PCR amplification is a textbook-canonical technique with thousands of published protocols. The exact procedure is well-established.",
  },
  {
    name: "Western blot",
    pattern: /\bwestern\s+blot/i,
    rationale: "Western blotting is a textbook-canonical technique — countless published protocols exist.",
  },
  {
    name: "ELISA",
    pattern: /\bELISA\b|\benzyme[- ]linked\s+immunosorbent/i,
    rationale: "ELISA is a textbook-canonical immunoassay with extensive published protocols.",
  },
  {
    name: "Bradford / BCA protein assay",
    pattern: /\b(?:bradford|BCA)\s+(?:protein\s+)?assay/i,
    rationale: "Standard protein quantification assay — extensively published.",
  },
  {
    name: "Gel electrophoresis",
    pattern: /\b(?:SDS-?PAGE|agarose\s+gel|gel\s+electrophoresis)\b/i,
    rationale: "Gel electrophoresis is a foundational technique — countless published protocols exist.",
  },
  {
    name: "Sanger sequencing",
    pattern: /\bsanger\s+sequencing\b/i,
    rationale: "Sanger sequencing is a textbook DNA sequencing method.",
  },
  {
    name: "Plasmid transformation",
    pattern: /\b(?:transform(?:ation|ing)?|electroporat)\b.*\b(?:E\.?\s*coli|plasmid|competent\s+cells)\b/i,
    rationale: "Bacterial transformation is a foundational molecular cloning step.",
  },
  {
    name: "Cell viability (MTT/MTS)",
    pattern: /\b(?:MTT|MTS|XTT|cell\s+viability)\s+assay/i,
    rationale: "Standard cell viability colorimetric assay — extensively published.",
  },
  {
    name: "Bacterial growth curve (OD600)",
    // Match only when the hypothesis is *about* a textbook growth assay —
    // not when it merely mentions growth in passing while testing a novel
    // perturbation (CRISPRi, knockout, novel substrate, engineered strain, …).
    pattern: /\bOD\s*600\b|\b(?:bacterial\s+)?growth\s+curve\b|\b(?:E\.?\s*coli|bacteria|bacterial)\b[^.]{0,80}\b(?:LB|lysogeny\s+broth|TB|terrific\s+broth|M9|minimal\s+media)\b[^.]{0,80}\b(?:37\s*°?\s*C|grow|culture|OD)/i,
    rationale: "Bacterial growth curves in standard media (LB, TB, M9) are textbook microbiology — countless published protocols exist.",
    // Disqualify if the hypothesis introduces a non-canonical perturbation.
    disqualifyIf: /\b(?:CRISPR|CRISPRi|CRISPRa|Cas9|Cas12|Cas13|knockout|knock-?out|knockdown|knock-?down|knock-?in|RNAi|shRNA|siRNA|engineered|synthetic|riboswitch|optogenetic|novel|mutant|deletion\s+strain|overexpress)|Δ[a-zA-Z]/i,
  },
];
// The technique is the subject only when the hypothesis asks for the
// technique itself ("Use standard PCR to amplify GAPDH", "Quantify TNF-alpha
// by sandwich ELISA"). Not when it is the readout of a claim ("... will
// reduce lipid accumulation, measured by Western blot") or the comparator of
// something new ("a paper-based biosensor ... matching laboratory ELISA
// sensitivity"). Both used to fire the rule (QA round 2, 9 Nov 2026: the
// CRP biosensor run was told "EXACT MATCH FOUND - this experiment appears
// to have been conducted", and the literature search was replaced by
// "ELISA method protocol", which returned slot-blot and HTLV-1 papers).
const CLAIM_RE = /\bwill\s+(?:\w+\s+){0,2}?(?:increase|decrease|reduce|raise|lower|improve|enhance|inhibit|suppress|promote|induce|prevent|restore|protect|detect|outperform|match|exceed|alter|change|affect|block|rescue|attenuate|elevate|boost|impair|extend|shorten|accelerate|delay|kill|cure|correlate|predict|discriminate|distinguish|identify|enable|allow|achieve|yield|produce|lead|cause|result)\b|\b(?:increases|decreases|reduces|raises|lowers|improves|inhibits|suppresses|promotes|induces|prevents|restores|attenuates|elevates|outperforms|exceeds)\b|\bleads?\s+to\b|\bresults?\s+in\b/i;
const NOVEL_OR_COMPARED_RE = /\b(?:biosensors?|sensors?|devices?|novel|new|develop(?:ed|ing)?|design(?:ed)?|engineer(?:ed)?|prototype|platform|point[- ]of[- ]care|paper[- ]based|microfluidic|wearable|compared?\s+(?:with|to)|comparable|versus|vs\.?|matching|than|instead\s+of|alternative\s+to|replac(?:e|es|ing))\b/i;

export interface CanonicalMatch {
  matched: boolean;
  technique?: string;
  rationale?: string;
}

export function detectCanonicalTechnique(hypothesis: string): CanonicalMatch {
  if (CLAIM_RE.test(hypothesis) || NOVEL_OR_COMPARED_RE.test(hypothesis)) return { matched: false };
  for (const t of TECHNIQUES) {
    if (t.pattern.test(hypothesis)) {
      if (t.disqualifyIf && t.disqualifyIf.test(hypothesis)) continue;
      return { matched: true, technique: t.name, rationale: t.rationale };
    }
  }
  return { matched: false };
}
