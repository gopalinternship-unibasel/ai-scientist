// The review runs after the plan is saved, in the same server worker. When
// the worker hits its time limit during the review, nothing marks the review
// as ended (run ff8e17c0, 19 Nov 2026), so the run page stops showing it as
// in progress once the review stage is older than the worker could live.
export const CRITIQUE_WAIT_MS = 180_000;

export function critiqueStillRunning(progress: { at?: string } | null | undefined, now = Date.now()): boolean {
  const at = progress?.at ? Date.parse(progress.at) : Number.NaN;
  return Number.isNaN(at) || now - at < CRITIQUE_WAIT_MS;
}
