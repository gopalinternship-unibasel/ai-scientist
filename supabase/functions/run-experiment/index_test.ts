// Deno tests for shared modules used by `run-experiment`. Run with:
//   supabase__test_edge_functions({ functions: ["run-experiment"] })
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sanitizeCitations, sanitizeCitationsWithReport } from "../_shared/citations.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { fetchWithRetry } from "../_shared/fetch-with-retry.ts";
import { screenSafety, safetyPromptFragment } from "../_shared/safety.ts";

Deno.test("sanitizeCitations strips out-of-range indices", () => {
  const out = sanitizeCitations(
    [{ description: "Use prior work (see [9])." }],
    3,
  );
  assertEquals(out[0].description, "Use prior work.");
});

Deno.test("sanitizeCitations preserves valid multi-index refs", () => {
  const out = sanitizeCitations(
    [{ description: "Per (see [1, 2])." }],
    3,
  );
  assertEquals(out[0].description, "Per (see [1, 2]).");
});

Deno.test("sanitizeCitations rewrites prose forms to canonical [N]", () => {
  const out = sanitizeCitations(
    [{ description: "As shown (ref. 2) and [refs 1-3] elsewhere." }],
    3,
  );
  assert(out[0].description.includes("[2]"));
  assert(out[0].description.includes("(see [1, 2, 3])"));
});

Deno.test("sanitizeCitations validates bare [N] indices", () => {
  const out = sanitizeCitations(
    [{ description: "Per [1] and [99]." }],
    3,
  );
  assertEquals(out[0].description, "Per [1] and.");
});

Deno.test("sanitizeCitationsWithReport reports counts", () => {
  const { report } = sanitizeCitationsWithReport(
    [{ description: "Cite [1] and (ref. 2) and [99]." }],
    3,
  );
  // [1] valid, [99] hallucinated, (ref. 2) rewritten to [2] which is then
  // re-validated by the bare-[N] pass — counted as both rewritten + valid.
  assertEquals(report.valid, 2);
  assertEquals(report.rewritten, 1);
  assertEquals(report.hallucinated, 1);
});

Deno.test("sanitizeCitations is a no-op for non-string descriptions", () => {
  const input = [{ description: undefined as unknown as string, foo: "bar" }];
  const out = sanitizeCitations(input, 3);
  assertEquals(out[0], input[0]);
});

Deno.test("screenSafety flags human subjects + IRB note", () => {
  const f = screenSafety("Recruit human volunteers and measure CRP from whole blood samples after intervention.");
  assertEquals(f.human_subjects, true);
  assert(f.notes.some((n) => n.includes("IRB")));
});

Deno.test("screenSafety flags CRISPR as IBC-relevant", () => {
  const f = screenSafety("CRISPR knockout of TP53 in HeLa cells reduces apoptosis by 30%");
  assertEquals(f.recombinant_dna, true);
});

Deno.test("safetyPromptFragment lists active categories", () => {
  const f = screenSafety("Treat C57BL/6 mice with LPS and measure cytokines");
  const frag = safetyPromptFragment(f);
  assert(frag.includes("animal_subjects"));
  assert(frag.includes("IACUC"));
});

Deno.test("safetyPromptFragment returns baseline note when no flags", () => {
  const f = screenSafety("Measure absorbance of buffer solutions at 280 nm");
  const frag = safetyPromptFragment(f);
  assert(frag.includes("No obvious regulated categories"));
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
