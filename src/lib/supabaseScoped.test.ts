import { describe, it, expect, vi, afterEach } from "vitest";

// A signed-in user opening someone else's share link needs the share token
// header AND their own JWT (QA round 2: signed-in viewers got "Run not found").
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "user-jwt" } } }) } },
}));
vi.mock("./owner", () => ({ getOwnerToken: () => "owner-tok" }));

import { createScopedClient } from "./supabaseScoped";

function stubFetch() {
  const calls: Headers[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
    calls.push(new Headers(init?.headers));
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  return calls;
}

describe("createScopedClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the share token and the signed-in user's JWT", async () => {
    const calls = stubFetch();
    const c = createScopedClient({ shareToken: "share-tok", asSignedInUser: true });
    await c.from("runs").select("id").eq("id", "00000000-0000-0000-0000-000000000000");
    expect(calls[0].get("x-share-token")).toBe("share-tok");
    expect(calls[0].get("x-owner-token")).toBe("owner-tok");
    expect(calls[0].get("Authorization")).toBe("Bearer user-jwt");
  });

  it("sends the share token with the anon key for signed-out viewers", async () => {
    const calls = stubFetch();
    const c = createScopedClient({ shareToken: "share-tok" });
    await c.from("runs").select("id");
    expect(calls[0].get("x-share-token")).toBe("share-tok");
    expect(calls[0].get("Authorization")).not.toBe("Bearer user-jwt");
  });
});
