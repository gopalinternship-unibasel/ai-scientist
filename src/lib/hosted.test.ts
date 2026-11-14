import { describe, expect, it } from "vitest";
import { HOSTED_NOTICE, hostedDemo } from "./hosted";

describe("hostedDemo", () => {
  it("is on only when the build says so", () => {
    expect(hostedDemo({})).toBe(false);
    expect(hostedDemo({ VITE_HOSTED_DEMO: "false" })).toBe(false);
    expect(hostedDemo({ VITE_HOSTED_DEMO: "true" })).toBe(true);
  });

  it("names the daily limit and the AI provider without naming one", () => {
    expect(HOSTED_NOTICE).toMatch(/daily limit/);
    expect(HOSTED_NOTICE).toMatch(/hosted AI provider/);
  });
});
