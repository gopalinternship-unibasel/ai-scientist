import { describe, expect, it } from "vitest";
import { timelineTotalLabel } from "./timelineTotal";
import { normalizeDomain } from "./domainNormalize";

describe("timelineTotalLabel", () => {
  it("adds the phases up instead of showing the first one", () => {
    // Run eaf0d06c (QA round 4): phases of 1 + 2 + 1 + 1 weeks were shown as "1 week".
    expect(timelineTotalLabel([{ duration: "1 week" }, { duration: "2 weeks" }, { duration: "1 week" }, { duration: "1 week" }])).toBe("5 weeks in total");
    expect(timelineTotalLabel([{ duration: "3 days" }, { duration: "4 days" }])).toBe("1 week in total");
    expect(timelineTotalLabel([{ duration: "2 days" }, { duration: "36 hours" }])).toBe("3.5 days in total");
    expect(timelineTotalLabel([{ duration: "6 hours" }])).toBe("6 hours in total");
  });

  it("shows nothing when a phase has no readable duration", () => {
    expect(timelineTotalLabel([{ duration: "1 week" }, { duration: "ongoing" }])).toBeUndefined();
    expect(timelineTotalLabel([{ duration: "1 week" }, {}])).toBeUndefined();
    // Durations the parser would read only in part (review of 11 Nov 2026).
    expect(timelineTotalLabel([{ duration: "1,5 weeks" }, { duration: "1 week" }])).toBeUndefined();
    expect(timelineTotalLabel([{ duration: "3 days + 1 week" }])).toBeUndefined();
    expect(timelineTotalLabel([{ duration: "1-2 weeks" }, { duration: "1 week" }])).toBeUndefined();
    expect(timelineTotalLabel([])).toBeUndefined();
    expect(timelineTotalLabel(undefined)).toBeUndefined();
  });
});

describe("normalizeDomain", () => {
  it("keeps a run's canonical domain when the hypothesis is passed along", () => {
    // QA round 4: feedback on a cell-biology run was stored with domain "other".
    const hypothesis = "Treating HepG2 cells with 10 µM metformin for 24 h will reduce palmitate-induced lipid accumulation.";
    expect(normalizeDomain("cell-biology", hypothesis)).toBe("cell-biology");
    expect(normalizeDomain("Cell Biology", hypothesis)).toBe("cell-biology");
    expect(normalizeDomain("biochemistry", "A CRISPR knockout of X changes Y.")).toBe("biochemistry");
  });

  it("falls back to the keyword rules, then to other", () => {
    expect(normalizeDomain("other", "A CRISPR knockout of X changes Y.")).toBe("molecular-biology");
    expect(normalizeDomain(null, "A CRISPR knockout of X changes Y.")).toBe("molecular-biology");
    expect(normalizeDomain(undefined, "Something with no keyword at all.")).toBe("other");
    expect(normalizeDomain()).toBe("other");
  });
});
