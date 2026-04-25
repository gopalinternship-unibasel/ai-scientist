// Lightweight, deterministic safety / regulatory pre-screen run before plan
// generation. Surfaces obvious BSL / IRB / IACUC / controlled-substance flags
// to the planner so the resulting plan can include the right approvals,
// containment, and warnings as first-class fields rather than buried prose.
//
// We deliberately keep this rules-based (no LLM call) because:
//   • It runs on every hypothesis (latency + cost matter)
//   • False negatives are worse than false positives — we want "maybe?" to err
//     on the side of flagging, and the planner can explain the actual scope.

export interface SafetyFlags {
  human_subjects: boolean;
  animal_subjects: boolean;
  bsl_2_or_higher: boolean;
  controlled_substances: boolean;
  recombinant_dna: boolean;
  hazardous_chemicals: boolean;
  /** Plain-English summary for the prompt (what to require in the plan). */
  notes: string[];
}

const PATTERNS: Array<[keyof Omit<SafetyFlags, "notes">, RegExp, string]> = [
  ["human_subjects", /\b(human (subjects?|participants?|volunteers?|patients?)|clinical trial|in vivo human|whole blood (donor|sample)|patient[- ]derived|biopsy|consent)\b/i, "IRB / informed consent required for human subjects work."],
  ["animal_subjects", /\b(mice|mouse|rat|rats|rabbit|primate|zebrafish|c57bl|balb\/c|sprague[- ]dawley|in vivo (mouse|rat|animal))\b/i, "IACUC approval required; specify species, strain, ages, group sizes, humane endpoints."],
  ["bsl_2_or_higher", /\b(sars[- ]cov|hiv|hepatitis|tuberculosis|m\. tuberculosis|influenza h[1-9]n[1-9]|ebola|marburg|zika|dengue|prion|bsl[- ]?[234]|biosafety level [234])\b/i, "Likely BSL-2+ containment; specify biosafety level, PPE, and disinfection protocol."],
  ["controlled_substances", /\b(opioid|fentanyl|morphine|cocaine|amphetamine|mdma|psilocybin|ketamine|cannabis|thc|cbd|schedule [iv]+ (drug|substance))\b/i, "DEA / Home Office controlled-substance license likely required."],
  ["recombinant_dna", /\b(crispr|cas9|cas12|guide rna|grna|sgrna|recombinant dna|plasmid (transfection|transformation)|aav|lentivirus|retrovirus|knock(out|in|down)|gain[- ]of[- ]function)\b/i, "IBC review for recombinant / synthetic nucleic acid work; specify viral titer, biosafety, and waste handling."],
  ["hazardous_chemicals", /\b(formaldehyde|paraformaldehyde|pfa|hydrofluoric acid|hf\b|cyanide|phenol[- ]chloroform|ethidium bromide|acrylamide|sodium azide|radioactive|radioisotope|[0-9]+\s?(ci|mci|μci|gbq|mbq))\b/i, "Hazardous reagents present; specify fume hood, PPE, spill plan, and waste route."],
];

export function screenSafety(hypothesis: string): SafetyFlags {
  const flags: SafetyFlags = {
    human_subjects: false,
    animal_subjects: false,
    bsl_2_or_higher: false,
    controlled_substances: false,
    recombinant_dna: false,
    hazardous_chemicals: false,
    notes: [],
  };
  for (const [key, re, note] of PATTERNS) {
    if (re.test(hypothesis)) {
      flags[key] = true;
      flags.notes.push(note);
    }
  }
  return flags;
}

/** Render the flags into a prompt fragment the planner can use. */
export function safetyPromptFragment(flags: SafetyFlags): string {
  const active = (Object.entries(flags) as Array<[keyof SafetyFlags, unknown]>)
    .filter(([k, v]) => k !== "notes" && v === true)
    .map(([k]) => k);
  if (active.length === 0) {
    return "\n\nSAFETY PRE-SCREEN: No obvious regulated categories detected. Still include a brief 'safety' section with PPE, waste handling, and emergency procedure.";
  }
  return `\n\nSAFETY PRE-SCREEN — the hypothesis triggers the following categories: ${active.join(", ")}. The 'safety' section MUST address each:\n${flags.notes.map((n) => `  • ${n}`).join("\n")}`;
}
