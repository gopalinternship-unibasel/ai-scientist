import { describe, it, expect } from "vitest";
import { checkHypothesis } from "./hypothesisValidation";

describe("checkHypothesis", () => {
  it("rejects single words", () => {
    const r = checkHypothesis("cancer");
    expect(r.ok).toBe(false);
    expect(r.signals.longEnough).toBe(false);
  });

  it("rejects vague topics with no intervention or measurement", () => {
    const r = checkHypothesis("I want to study cancer cells in the lab today");
    expect(r.ok).toBe(false);
    expect(r.signals.hasIntervention).toBe(false);
  });

  it("accepts a complete intervention + measurable outcome", () => {
    const r = checkHypothesis(
      "Replacing sucrose with trehalose will increase HeLa post-thaw viability by 15%",
    );
    expect(r.ok).toBe(true);
    expect(r.signals.hasIntervention).toBe(true);
    expect(r.signals.hasMeasurableOutcome).toBe(true);
  });

  it("accepts a comparison phrasing", () => {
    const r = checkHypothesis(
      "CRISPR knockdown of TP53 reduces apoptosis rate compared to wild-type controls",
    );
    expect(r.ok).toBe(true);
  });

  it("flags missing measurable outcome", () => {
    const r = checkHypothesis("Adding compound X to the media will help the cells");
    expect(r.signals.hasIntervention).toBe(true);
    expect(r.signals.hasMeasurableOutcome).toBe(false);
    expect(r.ok).toBe(false);
  });
});
