import { describe, it, expect } from "vitest";
import { hintForKind, isRetryable, parseRunError } from "./runErrors";

describe("runErrors", () => {
  it("parses a stored hypothesis-gate rejection as VALIDATION, without Retry", () => {
    const e = parseRunError("VALIDATION: That doesn't look like a testable scientific hypothesis. Suggestion: Name an intervention.");
    expect(e.kind).toBe("VALIDATION");
    expect(e.message).toMatch(/^That doesn't look like/);
    expect(isRetryable(e.kind)).toBe(false);
    expect(hintForKind(e.kind)).toMatch(/testable hypothesis/);
  });

  it("keeps the other kinds and legacy strings working", () => {
    expect(parseRunError("TIMEOUT: slow").kind).toBe("TIMEOUT");
    expect(parseRunError("Run timed out — connection lost or generation stalled.").kind).toBe("TIMEOUT");
    expect(parseRunError(null).kind).toBe("INTERNAL");
    expect(isRetryable("INTERNAL")).toBe(true);
    expect(isRetryable("CREDITS")).toBe(false);
  });
});
