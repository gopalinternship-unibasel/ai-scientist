import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SectionFeedback } from "./SectionFeedback";

// plan_feedback RLS matches anonymous owners on the x-owner-token header,
// which only the scoped client sends. These tests pin which client is used.
const { calls, plain, scoped } = vi.hoisted(() => {
  const calls: string[] = [];
  function fakeClient(label: string) {
    // Mimics the supabase-js query builder: every filter returns the same
    // builder, and awaiting it (it is thenable) resolves the query.
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    Object.assign(chain, {
      select: self, eq: self, order: self, limit: self,
      insert: (row: unknown) => { calls.push(`${label}:insert:${JSON.stringify(row)}`); return chain; },
      single: async () => ({ data: { id: "fb-1" }, error: null }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }),
    });
    return {
      from: (table: string) => { calls.push(`${label}:from:${table}`); return chain; },
      functions: { invoke: async () => ({ data: null, error: null }) },
    };
  }
  return { calls, plain: fakeClient("plain"), scoped: fakeClient("scoped") };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: plain }));
vi.mock("@/lib/supabaseScoped", () => ({ createScopedClient: () => scoped }));
vi.mock("@/lib/owner", () => ({ getOwnerToken: () => "owner-token-123" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

async function submitRating(ownerUserId: string | null) {
  render(
    <MemoryRouter>
      <SectionFeedback runId="run-1" section="materials" domain="cell-biology" hypothesis="h" ownerUserId={ownerUserId} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: /rate or correct this materials section/i }));
  fireEvent.click(await screen.findByRole("button", { name: "Rate 4 of 5" }));
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(calls.some((c) => c.includes(":insert:"))).toBe(true));
}

describe("SectionFeedback client selection", () => {
  beforeEach(() => { calls.length = 0; });

  it("uses the owner-token scoped client for anonymous owners", async () => {
    await submitRating(null);
    const insert = calls.find((c) => c.includes(":insert:"))!;
    expect(insert.startsWith("scoped:")).toBe(true);
    expect(insert).toContain('"owner_token":"owner-token-123"');
    expect(calls.some((c) => c.startsWith("plain:from"))).toBe(false);
  });

  it("uses the signed-in client when the run belongs to a user", async () => {
    await submitRating("user-1");
    const insert = calls.find((c) => c.includes(":insert:"))!;
    expect(insert.startsWith("plain:")).toBe(true);
    expect(insert).toContain('"owner_user_id":"user-1"');
  });
});
