// Deterministic timeline-vs-protocol consistency check.
//
// Catches the "3-week culture buried in a 2-week timeline" failure mode the
// model frequently produces. We parse free-form duration strings ("72 hours",
// "2 weeks", "1-2 d") into hours, then compare:
//
//   sum(protocol[].duration)  vs  sum(timeline[].duration)
//
// We allow timeline ≥ protocol (timeline can include slack & analysis), but
// flag when the timeline is clearly shorter than the work it claims to cover.
// Tolerance: 20% — anything tighter generates noise on natural rounding.

interface Step  { duration?: string; title?: string }
interface Phase { duration?: string; phase?: string }

export interface TimelineIssue {
  reason: "timeline_shorter_than_protocol" | "step_exceeds_total_timeline";
  protocol_total_hours: number;
  timeline_total_hours: number;
  detail: string;
}

const UNIT_HOURS: Record<string, number> = {
  m: 1 / 60, min: 1 / 60, mins: 1 / 60, minute: 1 / 60, minutes: 1 / 60,
  h: 1, hr: 1, hrs: 1, hour: 1, hours: 1,
  d: 24, day: 24, days: 24,
  w: 24 * 7, wk: 24 * 7, wks: 24 * 7, week: 24 * 7, weeks: 24 * 7,
  mo: 24 * 30, mon: 24 * 30, month: 24 * 30, months: 24 * 30,
  y: 24 * 365, yr: 24 * 365, year: 24 * 365, years: 24 * 365,
};

/**
 * Parse a free-form duration string into hours. Handles:
 *   "72 hours", "2 weeks", "1-2 d", "30 min", "overnight" (→ 14h),
 *   "1 week (5 working days)" (uses the first numeric span).
 * Returns 0 when nothing parseable is found.
 */
export function parseDurationToHours(raw: string | undefined | null): number {
  if (!raw) return 0;
  const s = String(raw).toLowerCase().trim();
  if (!s) return 0;

  // Common qualitative shorthands.
  if (/\bovernight\b/.test(s)) return 14;
  if (/\binstant(?:aneous)?\b/.test(s)) return 0.05;

  // Match "<num>[-<num>] <unit>" — e.g. "1-2 weeks", "72 hours", "30 min".
  // We take the upper bound of any range so we don't underestimate.
  const m = s.match(
    /(\d+(?:\.\d+)?)(?:\s*[-–to]+\s*(\d+(?:\.\d+)?))?\s*(minutes?|mins?|hours?|hrs?|days?|weeks?|wks?|months?|years?|yrs?|m|h|d|w|y)\b/,
  );
  if (!m) return 0;
  const lo = parseFloat(m[1]);
  const hi = m[2] ? parseFloat(m[2]) : lo;
  const unitKey = m[3];
  const factor = UNIT_HOURS[unitKey] ?? 0;
  return hi * factor;
}

/**
 * Compare protocol step durations against the declared timeline. Returns the
 * single most severe issue (if any) so the critique stays focused.
 *
 * @param tolerance fraction by which the timeline may underrun protocol total
 *                  before we flag it (default 0.2 = 20%).
 */
export function checkTimelineConsistency(
  protocol: Step[]  | undefined,
  timeline: Phase[] | undefined,
  tolerance = 0.2,
): TimelineIssue | null {
  if (!Array.isArray(protocol) || protocol.length === 0) return null;
  if (!Array.isArray(timeline) || timeline.length === 0) return null;

  const stepHours    = protocol.map((s) => parseDurationToHours(s?.duration));
  const protocolTot  = stepHours.reduce((a, b) => a + b, 0);
  const timelineTot  = timeline.reduce((a, p) => a + parseDurationToHours(p?.duration), 0);

  if (protocolTot === 0 || timelineTot === 0) return null;

  // Hard fail: a single protocol step is longer than the entire timeline.
  const longestIdx = stepHours.reduce(
    (best, h, i) => (h > stepHours[best] ? i : best),
    0,
  );
  if (stepHours[longestIdx] > timelineTot * (1 + tolerance)) {
    return {
      reason: "step_exceeds_total_timeline",
      protocol_total_hours: protocolTot,
      timeline_total_hours: timelineTot,
      detail: