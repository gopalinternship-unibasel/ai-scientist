import { describe, it, expect } from "vitest";
import { canRefineRun } from "./runAccess";

const base = { status: "done", hasPlan: true, isOwner: false, signedIn: false, shareToken: null };

describe("canRefineRun", () => {
  it("needs a finished plan", () => {
    expect(canRefineRun({ ...base, isOwner: true, signedIn: true, status: "plan" })).toBe(false);
    expect(canRefineRun({ ...base, isOwner: true, signedIn: true, hasPlan: false })).toBe(false);
  });
  it("allows the signed-in owner and the anonymous owner", () => {
    expect(canRefineRun({ ...base, isOwner: true, signedIn: true })).toBe(true);
    expect(canRefineRun(base)).toBe(true);
  });
  it("hides Refine from share-link viewers", () => {
    expect(canRefineRun({ ...base, shareToken: "tok" })).toBe(false);
    expect(canRefineRun({ ...base, signedIn: true, shareToken: "tok" })).toBe(false);
  });
});
