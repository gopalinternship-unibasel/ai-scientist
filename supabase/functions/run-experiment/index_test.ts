// Deno tests for shared modules used by `run-experiment`. Run with:
//   supabase__test_edge_functions({ functions: ["run-experiment"] })
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sanitizeCitations } from "../_shared/citations.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { fetchWithRetry } from "../_shared/fetch-with-retry.ts";

Deno.test("sanitizeCitations strips out-of-range indices", () => {
  const out = sanitizeCitations(
    [{ description: "Use prior work (see [9])." }],
    3,
  );
  assertEquals(out[0].description, "Use prior work .");
});

Deno.test("sanitizeCitations preserves valid multi-index refs", () => {
  const out = sanitizeCitations(
    [{ description: "Per (see [1, 2])." }],
    3,
  );
  assertEquals(out[0].description, "Per (see [1, 2]).");
});

Deno.test("sanitizeCitations is a no-op for non-string descriptions", () => {
  const input = [{ description: undefined as unknown as string, foo: "bar" }];
  const out = sanitizeCitations(input, 3);
  assertEquals(out[0], input[0]);
});

Deno.test("corsHeaders include the headers the SSE client sends", () => {
  const allow = corsHeaders["Access-Control-Allow-Headers"] ?? "";
  assertEquals(allow.includes("authorization"), true);
  assertEquals(allow.includes("content-type"), true);
  assertEquals(corsHeaders["Access-Control-Allow-Origin"], "*");
});

Deno.test("fetchWithRetry returns immediately on a successful response", async () => {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = ((..._args: Parameters<typeof fetch>) => {
    calls++;
    return Promise.resolve(new Response("ok", { status: 200 }));
  }) as typeof fetch;
  try {
    const r = await fetchWithRetry("https://example.test/", { method: "GET" });
    await r.text();
    assertEquals(r.status, 200);
    assertEquals(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("fetchWithRetry retries on 5xx and eventually returns", async () => {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = ((..._args: Parameters<typeof fetch>) => {
    calls++;
    if (calls < 3) return Promise.resolve(new Response("err", { status: 503 }));
    return Promise.resolve(new Response("ok", { status: 200 }));
  }) as typeof fetch;
  try {
    const r = await fetchWithRetry("https://example.test/", { method: "GET" }, {
      retries: 3,
      baseDelayMs: 1,
    });
    await r.text();
    assertEquals(r.status, 200);
    assertEquals(calls, 3);
  } finally {
    globalThis.fetch = original;
  }
});
