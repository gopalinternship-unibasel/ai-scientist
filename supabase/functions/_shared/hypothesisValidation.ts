// Lightweight hypothesis validator. Runs on both client and server (pure TS,
// no deps). Intentionally permissive: we only block trivially empty inputs so
// the user gets fast feedback without being lectured about "structure".
//
// Anything more nuanced (intervention, measurable outcome, etc.) is handled
// downstream by the QC + planning passes, which can actually reason about it.

export interface HypothesisCheck {
  ok: boolean;
  /** User-facing reason it failed (empty if ok). */
  reason: string;
  /** Kept for back-compat with older UI; all flags mirror `ok`. */
  signals: {
    longEnough: boolean;
    hasMultipleWords: boolean;
    hasIntervention: boolean;
    hasMeasurableOutcome: boolean;
  };
}

const MIN_CHARS = 8;

export function checkHypothesis(input: string): HypothesisCheck {
  const text = (input ?? "").trim();
  const longEnough = text.length >= MIN_CHARS;

  const reason = longEnough
    ? ""
    : `Add a bit more detail — at least ${MIN_CHARS} characters.`;

  return {
    ok: longEnough,
    reason,
    signals: {
      longEnough,
      hasMultipleWords: longEnough,
      hasIntervention: longEnough,
      hasMeasurableOutcome: longEnough,
    },
  };
}
