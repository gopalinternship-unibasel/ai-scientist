// Tests for the Semantic Scholar client in literature.ts (stubbed network).
// Run: deno test --allow-net --allow-env --allow-read supabase/functions/_shared/
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { searchPubMed, searchS2 } from "./literature.ts";

const page = { data: [{ paperId: "p1", title: "Trehalose cryopreservation", year: 2015, externalIds: { DOI: "10.1/ABC" }, authors: [{ name: "A" }] }] };

function stub(statuses: number[], seen: Headers[] = []): typeof fetch {
  let i = 0;
  return ((_url: string | URL | Request, init?: RequestInit) => {
    seen.push(new Headers(init?.headers));
    const status = statuses[Math.min(i++, statuses.length - 1)];
    return Promise.resolve(new Response(status === 200 ? JSON.stringify(page) : '{"message":"Too Many Requests"}', { status }));
  }) as typeof fetch;
}

Deno.test("searchS2 retries once after a 429 and returns the papers", async () => {
  const seen: Headers[] = [];
  const papers = await searchS2("trehalose", 4500, stub([429, 200], seen));
  assertEquals(seen.length, 2);
  assertEquals(papers.length, 1);
  assertEquals(papers[0].source, "s2");
  assertEquals(papers[0].externalId, "10.1/abc");
});

Deno.test("searchS2 reports a persistent 429 as a failure, not as zero papers", async () => {
  await assertRejects(() => searchS2("trehalose", 4500, stub([429, 429])), Error, "rate limit");
});

Deno.test("searchS2 sends SEMANTIC_SCHOLAR_API_KEY as x-api-key when set", async () => {
  const seen: Headers[] = [];
  Deno.env.set("SEMANTIC_SCHOLAR_API_KEY", "test-key");
  try {
    await searchS2("trehalose", 4500, stub([200], seen));
  } finally {
    Deno.env.delete("SEMANTIC_SCHOLAR_API_KEY");
  }
  assertEquals(seen[0].get("x-api-key"), "test-key");
  const seen2: Headers[] = [];
  await searchS2("trehalose", 4500, stub([200], seen2));
  assert(!seen2[0].has("x-api-key"));
});

Deno.test("searchPubMed asks E-utilities for Best Match order and maps the summary", async () => {
  const urls: string[] = [];
  const fake = ((url: string | URL | Request) => {
    const u = String(url);
    urls.push(u);
    const body = u.includes("esearch")
      ? { esearchresult: { idlist: ["35737237"] } }
      : { result: { uids: ["35737237"], "35737237": { title: "Enzyme-Linked Immunosorbent Assay (ELISA).", pubdate: "2022 Jun", authors: [{ name: "B" }], fulljournalname: "J", articleids: [{ idtype: "doi", value: "10.1/X" }] } } };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  }) as typeof fetch;
  const papers = await searchPubMed("ELISA method protocol", 4500, fake);
  assertEquals(new URL(urls[0]).searchParams.get("sort"), "relevance");
  assertEquals(papers.length, 1);
  assertEquals(papers[0].source, "pubmed");
  assertEquals(papers[0].year, 2022);
  assertEquals(papers[0].url, "https://doi.org/10.1/x");
});
