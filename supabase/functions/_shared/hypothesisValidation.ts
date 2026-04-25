// Lightweight, deterministic hypothesis validator. Runs on both client and
// server (pure TS, no deps) so the user gets instant inline feedback and the
// edge function can reject the same shapes server-side.
//
// We intentionally avoid an LLM round-trip here: the goal is just to catch
// "one word" / "vague topic" inputs before we burn tokens on QC + planning.
//
// A valid hypothesis should suggest:
//   • An intervention or change (verb / comparator)
//   • Something measurable (number, %, "increase", "reduce", etc.)
//   • Enough words to express both
//
// We use generous word lists so jargon-heavy biology hypotheses pass.

export interface HypothesisCheck {
  ok: boolean;
  /** User-facing reason it failed (empty if ok). */
  reason: string;
  /** Cumulative requirements + which are met — used to render a live checklist. */
  signals: {
    longEnough: boolean;
    hasMultipleWords: boolean;
    hasIntervention: boolean;
    hasMeasurableOutcome: boolean;
  };
}

const MIN_CHARS = 20;
const MIN_WORDS = 4;

// Verbs / comparators that imply an intervention or causal claim.
const INTERVENTION_PATTERNS = [
  /\b(increase|increases|increasing|decrease|decreases|decreasing|reduce|reduces|reducing|improve|improves|improving|enhance|enhances|enhancing|inhibit|inhibits|inhibiting|prevent|prevents|preventing|cause|causes|causing|trigger|triggers|induce|induces|inducing|suppress|suppresses|activate|activates|block|blocks|boost|boosts|lower|lowers|raise|raises|extend|extends|shorten|shortens|accelerate|accelerates|slow|slows|treat|treats|treating|cure|cures|kill|kills|protect|protects|degrade|degrades|stabilise|stabilize|stabilizes|express|expresses|knock\s?down|knock\s?out|over[- ]?express)\b/i,
  /\b(replace|replacing|swap|swapping|switch|switching|substitute|substituting|add|adding|remove|removing|combine|combining)\b/i,
  /\b(versus|vs\.?|compared (to|with)|relative to|than)\b/i,
  /\b(if|when)\b.*\bthen\b/i,
];

// Words / patterns that imply a measurable outcome.
const OUTCOME_PATTERNS = [
  /\d/,                                          // any number, e.g. "15%", "2x", "3 days"
  /\b\d+\s?(%|percent|fold|x|×)\b/i,
  /\b(by|to|of|at least|at most|≥|≤|>|<|=)\s?\d/i,
  /\b(viability|survival|expression|yield|growth|rate|efficiency|accuracy|sensitivity|specificity|titer|titre|concentration|level|levels|activity|response|score|count|fluorescence|absorbance|signal|ic50|ec50|km|vmax|reduction|increase|decrease|change|ratio|fraction|percentage|probability|threshold|metric|mortality|incidence|recovery|performance)\b/i,
];

export function checkHypothesis(input: string): HypothesisCheck {
  const text = (input ?? "").trim();
  const words = text.split(/\s+/).filter(Boolean);

  const signals = {
    longEnough: text.length >= MIN_CHARS,
    hasMultipleWords: words.length >= MIN_WORDS,
    hasIntervention: INTERVENTION_PATTERNS.some((re) => re.test(text)),
    hasMeasurableOutcome: OUTCOME_PATTERNS.some((re) => re.test(text)),
  };

  let reason = "";
  if (!signals.longEnough) {
    reason = `Add a bit more detail — at least ${MIN_CHARS} characters.`;
  } else if (!signals.hasMultipleWords) {
    reason = "Write a full sentence describing what you want to test.";
  } else if (!signals.hasIntervention && !signals.hasMeasurableOutcome) {
    reason =
      "Describe what you'd change and what you'd measure (e.g. \"replacing X will increase Y by 15%\").";
  } else if (!signals.hasIntervention) {
    reason =
      "Add what you'd change or compare (e.g. \"adding\", \"replacing\", \"vs. control\").";
  } else if (!signals.hasMeasurableOutcome) {
    reason =
      "Add a measurable outcome — a number, %, or a quantitative metric (viability, yield, rate…).";
  }

  return { ok: reason === "", reason, signals };
}
