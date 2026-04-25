import { describe, it, expect, beforeEach } from "vitest";
import { getOwnerToken } from "./owner";

describe("getOwnerToken", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("creates a token on first call and persists it", () => {
    const t = getOwnerToken();
    expect(t).toMatch(/^[0-9a-f-]{36}$/i);
    expect(localStorage.getItem("ai-scientist:owner-token")).toBe(t);
  });

  it("returns the same token on subsequent calls", () => {
    const a = getOwnerToken();
    const b = getOwnerToken();
    expect(a).toBe(b);
  });

  it("respects an existing stored token", () => {
    localStorage.setItem("ai-scientist:owner-token", "preset-token-value");
    expect(getOwnerToken()).toBe("preset-token-value");
  });
});
