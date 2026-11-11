// The figure under "Timeline" in the plan header: the phases added up.
// Until QA round 4 it showed the first phase's duration ("4 phases / 1 week"
// for phases of 1 + 2 + 1 + 1 weeks).
import { parseDurationToHours } from "../../supabase/functions/_shared/timelineCheck";

const HOURS_PER_WEEK = 168;

export function timelineTotalLabel(timeline: Array<{ duration?: string | null }> | undefined | null): string | undefined {
  if (!Array.isArray(timeline) || timeline.length === 0) return undefined;
  // The duration parser reads the first "number unit" only: "1,5 weeks" would count as 5 weeks
  // and "3 days + 1 week" as 3 days. No total is better than a wrong one.
  const PAIR = /\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|days?|d|weeks?|wks?|w|months?|minutes?|mins?)\b/gi;
  const unreadable = (d: string | null | undefined) => !d || /\d,\d/.test(d) || (d.match(PAIR) ?? []).length !== 1 || /\d\s*(?:-|–|to)\s*\d/.test(d);
  if (timeline.some((p) => unreadable(p?.duration))) return undefined;
  const hours = timeline.map((p) => parseDurationToHours(p?.duration ?? undefined));
  // A phase whose duration cannot be read ("ongoing") makes any sum wrong.
  if (hours.some((h) => !(h > 0))) return undefined;
  const total = hours.reduce((a, b) => a + b, 0);
  if (total < 24) {
    const h = Math.round(total * 10) / 10;
    return `${h} ${h === 1 ? "hour" : "hours"} in total`;
  }
  if (total < HOURS_PER_WEEK) {
    const d = Math.round((total / 24) * 10) / 10;
    return `${d} ${d === 1 ? "day" : "days"} in total`;
  }
  const w = Math.round((total / HOURS_PER_WEEK) * 10) / 10;
  return `${w} ${w === 1 ? "week" : "weeks"} in total`;
}
