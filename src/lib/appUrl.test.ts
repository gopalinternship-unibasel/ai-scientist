import { describe, expect, it } from "vitest";
import { appPathname, buildAppUrl, routerBasename } from "./appUrl";

const origin = "https://gopalinternship-unibasel.github.io";

describe("buildAppUrl", () => {
  it("keeps the project path in front of the app path", () => {
    expect(buildAppUrl("/my-runs", "/ai-scientist/", origin)).toBe(`${origin}/ai-scientist/my-runs`);
    expect(buildAppUrl("reset-password", "/ai-scientist/", origin)).toBe(`${origin}/ai-scientist/reset-password`);
    expect(buildAppUrl("/runs/abc?t=tok", "/ai-scientist/", origin)).toBe(`${origin}/ai-scientist/runs/abc?t=tok`);
  });

  it("is the plain origin path at the root", () => {
    expect(buildAppUrl("/my-runs", "/", "http://localhost:5180")).toBe("http://localhost:5180/my-runs");
  });

  it("accepts a base without a trailing slash", () => {
    expect(buildAppUrl("/x", "/ai-scientist", origin)).toBe(`${origin}/ai-scientist/x`);
  });
});

describe("routerBasename", () => {
  it("is empty at the root and has no trailing slash otherwise", () => {
    expect(routerBasename("/")).toBe("");
    expect(routerBasename("/ai-scientist/")).toBe("/ai-scientist");
  });
});

describe("appPathname", () => {
  it("removes the base path", () => {
    expect(appPathname("/ai-scientist/runs/1", "/ai-scientist/")).toBe("/runs/1");
    expect(appPathname("/ai-scientist", "/ai-scientist/")).toBe("/");
    expect(appPathname("/runs/1", "/")).toBe("/runs/1");
    expect(appPathname("/ai-scientist-other/x", "/ai-scientist/")).toBe("/ai-scientist-other/x");
  });
});
