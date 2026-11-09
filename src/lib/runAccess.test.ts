import { describe, it, expect } from "vitest";
import { canGiveFeedback, canRefineRun } from "./runAccess";

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

describe("canGiveFeedback", () => {
  const fb = { isOwner: false, signedIn: false, shareToken: null, ownerUserId: null };
  it("allows the signed-in owner and the anonymous owner", () => {
    expect(canGiveFeedback({ ...fb, isOwner: true, signedIn: true, ownerUserId: "u1" })).toBe(true);
    expect(canGiveFeedback(fb)).toBe(true);
  });
  it("hides feedback from share-link viewers, signed in or not", () => {
    expect(canGiveFeedback({ ...fb, shareToken: "tok", ownerUserId: "u1" })).toBe(false);
    expect(canGiveFeedback({ ...fb, signedIn: true, shareToken: "tok", ownerUserId: "u1" })).toBe(false);
  });
  it("hides feedback from a signed-out viewer of an account-owned run", () => {
    expect(canGiveFeedback({ ...fb, ownerUserId: "u1" })).toBe(false);
  });
});
