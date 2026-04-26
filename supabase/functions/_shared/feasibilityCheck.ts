// Deterministic feasibility pre-screen. Catches hypotheses that violate
// well-established physical / biological limits BEFORE we burn rate-limit
// quota or generate a (necessarily fictitious) plan for them.
//
// Returns the first matching violation, or { ok: true } if no rule trips.
//
// We deliberately use simple regex pattern-matching here (not an LLM call)
// so the check is fast, free, and doesn't add latency to every request.
// The patterns are conservative — only block on unambiguous violations.

export interface FeasibilityResult {
  ok: boolean;
  principle?: string;     // Short name of the violated principle
  explanation?: string;   // User-facing one-liner
  suggestion?: string;    // What they could try instead
}

interface Rule {
  principle: string;
  // ALL patterns must match for the rule to fire (AND semantics).
  patterns: RegExp[];
  explanation: string;
  suggestion: string;
}

const RULES: Rule[] = [
  {
    principle: "Abbe diffraction limit",
    patterns: [
      /\b(?:resolve|image|visualize|see)\b.*\b(?:individual\s+)?atoms?\b/i,
      /\b(?:brightfield|bright[-\s]?field|light|optical|fluorescence|fluorescent|confocal|widefield|wide[-\s]?field|phase[-\s]?contrast|dic|darkfield|dark[-\s]?field)\b(?:\s+\w+){0,3}\s+microscop/i,
    ],
    explanation:
      "Visible-light microscopy cannot resolve individual atoms — the Abbe diffraction limit caps optical resolution at ~200 nm, four orders of magnitude larger than an atom.",
    suggestion:
      "Try cryo-EM, AFM, or STM if you need atomic resolution; or rephrase the hypothesis around a feature in the ~200 nm+ range.",
  },
  {
    principle: "Abbe diffraction limit",
    patterns: [
      /\b(?:standard\s+)?(?:confocal|widefield|wide[-\s]?field|brightfield|bright[-\s]?field|optical|fluorescence|fluorescent)\s+microscop/i,
      /\b(?:[1-9]\d?|1[0-7]\d)\s*nm\b[^.]{0,80}\b(?:resolution|lateral\s+resolution)\b|\b(?:resolution|lateral\s+resolution)\b[^.]{0,80}\b(?:[1-9]\d?|1[0-7]\d)\s*nm\b/i,
    ],
    explanation:
      "Standard optical/confocal microscopy cannot achieve 50–170 nm lateral resolution without super-resolution methods; diffraction limits conventional resolution to ~200 nm.",
    suggestion:
      "Use STED, PALM/STORM, SIM, expansion microscopy, or relax the target to ~200 nm+ for standard confocal imaging.",
  },
  {
    patterns: [
      /\b(?:faster[-\s]than[-\s]light|greater\s+than\s+(?:the\s+speed\s+of\s+)?light|superluminal|FTL)\b/i,
    ],
    explanation:
      "Special relativity forbids superluminal information transfer — no experiment can demonstrate this.",
    suggestion:
      "If you're interested in apparent FTL phenomena (group velocity, quantum entanglement), rephrase around the actual measurable quantity.",
  },
  {
    principle: "No-communication theorem (entanglement signalling)",
    patterns: [
      /\b(?:entangl(?:ed|ement))\b/i,
      /\b(?:transmit|send|communicate|signal|convey)\b[^.]*\b(?:classical\s+information|message|bit|signal|data)\b/i,
    ],
    explanation:
      "The no-communication theorem of quantum mechanics forbids using entanglement to transmit classical information — measurement outcomes on one party are random and provide no channel.",
    suggestion:
      "Reframe around correlations (Bell-inequality violations, CHSH tests) or quantum teleportation, which still requires a classical channel.",
  },
  {
    principle: "Perpetual motion / over-unity energy",
    patterns: [
      /\b(?:perpetual\s+motion|over[-\s]?unity|free\s+energy\s+device|infinite\s+energy)\b/i,
    ],
    explanation:
      "The first and second laws of thermodynamics forbid devices that produce more energy than they consume.",
    suggestion:
      "Reframe around energy efficiency, recovery, or a specific known energy source.",
  },
  {
    principle: "Absolute zero",
    patterns: [
      /\b(?:reach|achieve|cool\s+to)\s+(?:absolute\s+zero|0\s*K|0\s*kelvin)\b/i,
    ],
    explanation:
      "The third law of thermodynamics forbids reaching absolute zero in finite steps.",
    suggestion:
      "Pick a target temperature in the millikelvin range, which is achievable with dilution refrigerators.",
  },
  {
    // Catches "expose adult zebrafish to 4 K bath", "cool mice to liquid
    // helium temperature", etc. Vertebrate tissue freezes solid well above
    // even liquid-nitrogen temperatures, never mind 4 K.
    principle: "Cryogenic exposure of living vertebrates",
    patterns: [
      /\b(?:zebrafish|mice|mouse|rat|rats|axolotl|xenopus|frog|fish|vertebrate|mammal|human|patient|animal|organism|in\s+vivo|live)\b/i,
      /\b(?:4\s*K|4\s*kelvin|liquid\s+helium|liquid\s+nitrogen|cryogenic|sub[-\s]?zero|near\s+absolute\s+zero)\b/i,
    ],
    explanation:
      "Living vertebrates cannot survive cryogenic exposure (≤ ~−20 °C); tissue ice formation is lethal long before liquid-helium temperatures.",
    suggestion:
      "Use ex vivo tissue, isolated cells, or a cryopreservation protocol with vitrification agents — and study the nanomaterial behaviour separately at 4 K.",
  },
  {
    // qPCR / RT-qPCR amplification cycles take ~10–30 s each plus ramp time.
    // A full 40-cycle run is ~30–90 min. Sub-millisecond gene-expression
    // measurements via PCR are physically impossible.
    principle: "Sub-millisecond PCR / qPCR readout",
    patterns: [
      /\b(?:qPCR|RT[-\s]?qPCR|RT[-\s]?PCR|real[-\s]?time\s+PCR)\b/i,
      /\b(?:sub[-\s]?millisecond|microsecond|nanosecond|picosecond|<\s*1\s*ms|less\s+than\s+(?:a\s+)?millisecond)\b/i,
    ],
    explanation:
      "qPCR thermal cycling requires seconds-to-minutes per cycle; gene-expression changes cannot be resolved at sub-millisecond timescales by PCR.",
    suggestion:
      "Use single-molecule fluorescence (smFISH live-cell), MS2/PP7 nascent-RNA tagging, or nanopore sequencing for fast transcription dynamics.",
  },
  {
    // Mammalian cell culture media (DMEM, RPMI, IMDM, MEM) are bicarbonate-
    // buffered — without 5 % CO₂ the pH crashes within hours and the cells
    // die. CO₂-independent media (Leibovitz L-15) exist but must be named.
    principle: "Mammalian culture without CO₂ buffering",
    patterns: [
      /\b(?:HeLa|HEK293|HEK\s*293|A549|K562|Jurkat|MCF[-\s]?7|U2OS|CHO|HepG2|mammalian\s+(?:cell|culture)|primary\s+(?:human|mouse)\s+cells?)\b/i,
      /\b(?:without\s+CO2|no\s+CO2|ambient\s+air|atmospheric\s+air|room\s+air)\b/i,
    ],
    explanation:
      "Standard mammalian media (DMEM/RPMI/MEM) are bicarbonate-buffered and require 5 % CO₂; cells will not survive ambient-air culture for the duration of a typical experiment.",
    suggestion:
      "Use Leibovitz's L-15 medium (CO₂-independent, phosphate-buffered) or HEPES-supplemented media if you cannot use a CO₂ incubator.",
  },
  {
    // Room-temperature superconductors at ambient pressure remain unverified
    // (LK-99 etc. failed replication). Block claims to "demonstrate" or
    // "measure" RT superconductivity in ordinary metals at 1 atm.
    principle: "Room-temperature superconductivity at ambient pressure",
    patterns: [
      /\broom[-\s]?temperature\s+superconduct/i,
      /\b(?:ambient\s+pressure|1\s*atm|atmospheric\s+pressure|standard\s+conditions)\b/i,
    ],
    explanation:
      "No room-temperature superconductor at ambient pressure has been independently verified; designing an experiment that assumes the effect would yield a null result.",
    suggestion:
      "Reframe as a search/screening study (vary composition, temperature, pressure) with explicit controls and pre-registered null-result handling.",
  },
];

export function checkFeasibility(hypothesis: string): FeasibilityResult {
  for (const rule of RULES) {
    if (rule.patterns.every((p) => p.test(hypothesis))) {
      return {
        ok: false,
        principle: rule.principle,
        explanation: rule.explanation,
        suggestion: rule.suggestion,
      };
    }
  }
  return { ok: true };
}
