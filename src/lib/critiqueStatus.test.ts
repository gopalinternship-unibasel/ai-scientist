import { describe, expect, it } from "vitest";
import { CRITIQUE_WAIT_MS, critiqueStillRunning } from "./critiqueStatus";

describe("critiqueStillRunning", () => {
  const at = "2026-11-19T13:52:09.096Z";
  const t = Date.parse(at);

  it("is still running right after the review stage starts", () => {
    expect(critiqueStillRunning({ at }, t + 5_000)).toBe(true);
  });

  it("stops counting as running once the stage is older than the wait limit", () => {
    expect(critiqueStillRunning({ at }, t + CRITIQUE_WAIT_MS + 1)).toBe(false);
  });

  it("keeps waiting when the time stamp is missing or unreadable", () => {
    expect(critiqueStillRunning({}, t)).toBe(true);
    expect(critiqueStillRunning({ at: "not a date" }, t)).toBe(true);
    expect(critiqueStillRunning(null, t)).toBe(true);
  });
});
