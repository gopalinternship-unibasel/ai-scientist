import { describe, it, expect } from "vitest";
import { googleSignInAvailable } from "./authOptions";

// QA round 1: "Continue with Google" led to the app's 404 page off Lovable
// hosting (/~oauth/initiate exists only there).
describe("googleSignInAvailable", () => {
  it("is off unless the build says it runs on Lovable hosting", () => {
    expect(googleSignInAvailable({})).toBe(false);
    expect(googleSignInAvailable({ VITE_LOVABLE_OAUTH: "false" })).toBe(false);
    expect(googleSignInAvailable({ VITE_LOVABLE_OAUTH: "true" })).toBe(true);
  });
});
