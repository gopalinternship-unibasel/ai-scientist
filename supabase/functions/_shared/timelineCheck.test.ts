import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseDurationToHours, checkTimelineConsistency } from "./timelineCheck.ts";

Deno.test("parseDurationToHours: hours/days/weeks", () => {
  assertEquals(parseDurationToHours("72 hours"), 72);
  assertEquals(parseDurationToHours("3 days"), 72);
  assertEquals(parseDurationToHours("2 weeks"), 336);
  assertEquals(parseDurationToHours("30 min"), 0.5);
});

Deno.test("parseDurationToHours: ranges take upper bound", () => {
  assertEquals(parseDurationToHours("1-2 weeks"), 336);
  assertEquals(parseDurationToHours("2 to 4 hours"), 4);
});

Deno.test("parseDurationToHours: qualitative shorthands", () => {
  assertEquals(parseDurationToHours("overnight"), 14);
  assertEquals(parseDurationToHours(""), 0);
  assertEquals(parseDurationToHours(undefined), 0);
});

Deno.test("checkTimelineConsistency: flags step longer than total timeline", () => {
  const issue = checkTimelineConsistency(
    [{ title: "Cell expansion", duration: "3 weeks" }, { title: "Assay", duration: "2 hours" }],
    [{ phase: "All", duration: "1 week" }],
  );
  assertEquals(issue?.reason, "step_exceeds_total_timeline");
});

Deno.test("checkTimelineConsistency: flags protocol-total > timeline", () => {
  const issue = checkTimelineConsistency(
    [{ duration: "5 days" }, { duration: "5 days" }, { duration: "5 days" }],
    [{ duration: "1 week" }],
  );
  assertEquals(issue?.reason, "timeline_shorter_than_protocol");
});

Deno.test("checkTimelineConsistency: passes when timeline >= protocol", () => {
  const issue = checkTimelineConsistency(
    [{ duration: "3 days" }, { duration: "2 days" }],
    [{ duration: "2 weeks" }],
  );
  assertEquals(issue, null);
});

Deno.test("checkTimelineConsistency: tolerates 20% rounding", () => {
  const issue = checkTimelineConsistency(
    [{ duration: "10 hours" }],
    [{ duration: "9 hours" }], // 10% under — within tolerance
  );
  assertEquals(issue, null);
});
