import { describe, it, expect } from "vitest";
import { sanitizeCitations } from "./citations";

describe("sanitizeCitations", () => {
  it("returns an empty array for undefined input", () => {
    expect(sanitizeCitations(undefined, 3)).toEqual([]);
  });

  it("preserves valid single-index citations", () => {
    const steps = [{ description: "Run PCR (see [2])." }];
    expect(sanitizeCitations(steps, 3)[0].description).toBe("Run PCR (see [2]).");
  });

  it("preserves multi-index citations and normalizes spacing", () => {
    const steps = [{ description: "Use prior work (see [1, 3])." }];
    expect(sanitizeCitations(steps, 3)[0].description).toBe(
      "Use prior work (see [1, 3]).",
    );
  });

  it("strips citations that exceed the literature count", () => {
    const steps = [{ description: "Bogus claim (see [9])." }];
    expect(sanitizeCitations(steps, 3)[0].description).toBe("Bogus claim .");
  });

  it("filters partially valid groups, keeping only in-range indices", () => {
    const steps = [{ description: "Claim (see [1, 99, 2])." }];
    expect(sanitizeCitations(steps, 3)[0].description).toBe("Claim (see [1, 2]).");
  });

  it("ignores non-numeric junk inside brackets", () => {
    const steps = [{ description: "Claim (see [foo, bar])." }];
    expect(sanitizeCitations(steps, 3)[0].description).toBe("Claim .");
  });

  it("leaves steps without a description untouched", () => {
    const steps = [{ description: undefined as unknown as string, other: "x" }];
    expect(sanitizeCitations(steps, 3)[0]).toEqual(steps[0]);
  });

  it("collapses runs of whitespace left by stripped citations", () => {
    const steps = [{ description: "Before  (see [99])  after." }];
    expect(sanitizeCitations(steps, 1)[0].description).toBe("Before after.");
  });
});
