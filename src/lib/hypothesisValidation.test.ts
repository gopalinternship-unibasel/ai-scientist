import { describe, it, expect } from "vitest";
import { checkHypothesis } from "./hypothesisValidation";

describe("checkHypothesis", () => {
  it("rejects empty input", () => {
    const r = checkHypothesis("");
    expect(r.ok).toBe(false);
  });

  it("rejects very short input", () => {
    const r = checkHypothesis("hi");
    expect(r.ok).toBe(false);
    expect(r.signals.longEnough).toBe(false);
  });

  it("accepts a short topic phrase", () => {
    const r = checkHypothesis("study cancer cells");
    expect(r.ok).toBe(true);
  });

  it("accepts a full hypothesis", () => {
    const r = checkHypothesis(
      "Replacing sucrose with trehalose will increase HeLa post-thaw viability by 15%",
    );
    expect(r.ok).toBe(true);
  });
});
