// Deterministic timeline-vs-protocol consistency check.
//
// Catches the "3-week culture buried in a 2-week timeline" failure mode the
// model frequently produces. We parse free-form duration strings into hours,
// then compare protocol-step total against declared timeline total.
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
  w: 168, wk: 168, wks: 168, week: 168, weeks: 168,
  mo: 720, mon: 720, month: 720, months: 720,
  y: 8760, yr: 8760, year: 8760, years: 8760,
};

/**
 * Parse a free-form duration string into hours. Handles "72 hours",
 * "2 weeks", "1-2 d", "30 min", "overnight" (→ 14h). Range upper bound is
 * taken so we don't underestimate. Returns 0 when nothing parseable.
 */
export function parseDurationToHours(raw: string | undefined | null): number {
  if (!raw) return 0;
  const s = String(raw).toLowerCase().trim();
  if (!s) return 0;
  if (/\bovernight\b/.test(s)) return 14;
  if (/\binstant(?:aneous)?\b/.test(s)) return 0.05;

  const m = s.match(
    /(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(minutes?|mins?|hours?|hrs?|days?|weeks?|wks?|months?|years?|yrs?|mo|m|h|d|w|y)\b/,
  );
  if (!m) return 0;
  const lo = parseFloat(m[1]);
  const hi = m[2] ? parseFloat(m[2]) : lo;
  const factor = UNIT_HOURS[m[3]] ?? 0;
  return hi * factor;
}

function fmt(h: number): string {
  if (h >= 168) return `${(h / 168).toFixed(1)} wk`;
  if (h >= 24)  return `${(h / 24).toFixed(1)} d`;
  return `${h.toFixed(1)} h`;
}

/**
 * Compare protocol step durations against declared timeline. Returns the
 * single most severe issue (if any) so the critique stays focused.
 */
export function checkTimelineConsistency(
  protocol: Step[]  | undefined,
  timeline: Phase[] | undefined,
  tolerance = 0.2,
): TimelineIssue | null {
  if (!Array.isArray(protocol) || protocol.length === 0) return null;
  if (!Array.isArray(timeline) || timeline.length === 0) return null;

  const stepHours   = protocol.map((s) => parseDurationToHours(s?.duration));
  const protocolTot = stepHours.reduce((a, b) => a + b, 0);
  const timelineTot = timeline.reduce((a, p) => a + parseDurationToHours(p?.duration), 0);
  if (protocolTot === 0 || timelineTot === 0) return null;

  // Hardest fail: a single step is longer than the whole timeline.
  const longestIdx = stepHours.reduce((best, h, i) => (h > stepHours[best] ? i : best), 0);
  if (stepHours[longestIdx] > timelineTot * (1 + tolerance)) {
    const stepTitle = protocol[longestIdx]?.title ?? `step ${longestIdx + 1}`;
    return {
      reason: "step_exceeds_total_timeline",
      protocol_total_hours: protocolTot,
      timeline_total_hours: timelineTot,
      detail: `Protocol step "${stepTitle}" alone takes ${fmt(stepHours[longestIdx])} but the entire timeline is only ${fmt(timelineTot)}.`,
    };
  }

  // Softer: protocol total exceeds timeline total beyond tolerance.
  if (protocolTot > timelineTot * (1 + tolerance)) {
    return {
      reason: "timeline_shorter_than_protocol",
      protocol_total_hours: protocolTot,
      timeline_total_hours: timelineTot,
      detail: `Protocol steps sum to ~${fmt(protocolTot)} of bench time but the declared timeline only allocates ~${fmt(timelineTot)}.`,
    };
  }

  return null;
}
