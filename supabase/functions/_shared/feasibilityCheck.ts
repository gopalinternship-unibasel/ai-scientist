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
      /\b(?:brightfield|light|optical|fluorescence|confocal)\s+microscop/i,
    ],
    explanation:
      "Visible-light microscopy cannot resolve individual atoms — the Abbe diffraction limit caps optical resolution at ~200 nm, four orders of magnitude larger than an atom.",
    suggestion:
      "Try cryo-EM, AFM, or STM if you need atomic resolution; or rephrase the hypothesis around a feature in the ~200 nm+ range.",
  },
  {
    principle: "Faster-than-light signalling",
    patterns: [
      /\b(?:faster|greater)\s+than\s+(?:the\s+speed\s+of\s+)?light\b|\bsuperluminal\b|\bFTL\b/i,
    ],
    explanation:
      "Special relativity forbids superluminal information transfer — no experiment can demonstrate this.",
    suggestion:
      "If you're interested in apparent FTL phenomena (group velocity, quantum entanglement), rephrase around the actual measurable quantity.",
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
