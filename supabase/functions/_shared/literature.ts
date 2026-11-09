// Multi-source literature search. Queries Semantic Scholar, OpenAlex and
// PubMed in parallel, normalises results into a single shape, and dedupes by
// DOI (then by lowercased-title prefix).
//
// All three sources are best-effort: a failure or rate-limit on one source
// just contributes zero rows. We surface which sources actually returned
// results so the caller can degrade gracefully.
//
// QUERY DEGRADATION: when the first attempt (full hypothesis) returns 0 hits
// across every source, we retry with progressively broader keyword queries
// before giving up. This fixes the case where a perfectly cite-able topic
// (e.g. "PCR amplification of GAPDH") returns nothing because the full
// sentence happens to match no paper title verbatim.

import { degradedQueries } from "./queryDegradation.ts";
import { hypothesisConcepts, paperRelevance } from "./hypothesisTerms.ts";

export interface LitPaper {
  source: "s2" | "openalex" | "pubmed";
  externalId?: string;          // DOI or PMID — used for dedup
  title: string;
  abstract?: string | null;
  year?: number | null;
  authors?: string[];
  venue?: string | null;
  citationCount?: number | null;
  url?: string;
}

// The fields read from each API's JSON (everything is optional there).
interface S2Paper {
  paperId?: string;
  title?: string | null;
  abstract?: string | null;
  year?: number | null;
  authors?: { name: string }[];
  venue?: string | null;
  citationCount?: number | null;
  url?: string | null;
  externalIds?: { DOI?: string } | null;
}
interface OpenAlexWork {
  id?: string;
  doi?: string | null;
  title?: string | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  publication_year?: number | null;
  authorships?: { author?: { display_name?: string } | null }[];
  host_venue?: { display_name?: string } | null;
  primary_location?: { source?: { display_name?: string } | null } | null;
  cited_by_count?: number | null;
}
interface PubMedSummary {
  title?: string;
  pubdate?: string;
  articleids?: { idtype?: string; value?: string }[];
  authors?: { name?: string }[];
  fulljournalname?: string;
  source?: string;
}

const isString = (v: unknown): v is string => typeof v === "string" && v.length > 0;

export interface LitResult {
  papers: LitPaper[];
  sources: { s2: boolean; openalex: boolean; pubmed: boolean };
  rateLimited: boolean;
}

const UA = "AI-Scientist/1.0 (Lovable)";
// Keep literature QC snappy for live demos: all sources are best-effort, and
// each source has degraded fallback queries, so long per-source waits hurt UX
// more than they improve recall.
const DEFAULT_TIMEOUT = 4500;
const DEGRADED_TIMEOUT = 2500;

// Semantic Scholar's unauthenticated pool is shared by every anonymous
// client and answers HTTP 429 most of the time (seen on 9 Nov 2026 for
// almost every query). A free API key (SEMANTIC_SCHOLAR_API_KEY, sent as
// x-api-key) gets its own quota. Without one, a throttled call is retried
// once after a short pause, and a call that stays throttled counts as a
// failure (not as "no papers"), so an all-sources outage is reported as
// rate-limited.
const S2_RETRY_MS = 1100;

function s2Headers(): Record<string, string> {
  const key = Deno.env.get("SEMANTIC_SCHOLAR_API_KEY")?.trim();
  return key ? { "User-Agent": UA, "x-api-key": key } : { "User-Agent": UA };
}

export async function searchS2(
  q: string,
  timeoutMs = DEFAULT_TIMEOUT,
  fetchFn: typeof fetch = fetch,
): Promise<LitPaper[]> {
  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", q);
  url.searchParams.set("limit", "8");
  url.searchParams.set(
    "fields",
    "title,abstract,year,authors.name,venue,citationCount,url,externalIds",
  );
  const call = () => fetchFn(url.toString(), {
    headers: s2Headers(),
    signal: AbortSignal.timeout(timeoutMs),
  });
  let res = await call();
  if (res.status === 429) {
    try { await res.body?.cancel(); } catch { /* noop */ }
    await new Promise((r) => setTimeout(r, S2_RETRY_MS));
    res = await call();
    if (res.status === 429) {
      try { await res.body?.cancel(); } catch { /* noop */ }
      throw new Error("Semantic Scholar rate limit (429)");
    }
  }
  if (!res.ok) return [];
  const json = await res.json();
  return ((json.data ?? []) as S2Paper[]).map((p): LitPaper => ({
    source: "s2",
    externalId: p.externalIds?.DOI?.toLowerCase(),
    title: p.title ?? "",
    abstract: p.abstract ?? null,
    year: p.year ?? null,
    authors: (p.authors ?? []).slice(0, 5).map((a: { name: string }) => a.name),
    venue: p.venue ?? null,
    citationCount: p.citationCount ?? null,
    url: p.url || (p.externalIds?.DOI
      ? `https://doi.org/${p.externalIds.DOI}`
      : `https://www.semanticscholar.org/paper/${p.paperId}`),
  }));
}

async function searchOpenAlex(q: string, timeoutMs = DEFAULT_TIMEOUT): Promise<LitPaper[]> {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("filter", `title_and_abstract.search:${q}`);
  url.searchParams.set("per-page", "8");
  url.searchParams.set("sort", "relevance_score:desc");
  url.searchParams.set("mailto", "ai-scientist@lovable.dev");
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return [];
  const json = await res.json();
  return ((json.results ?? []) as OpenAlexWork[]).map((w): LitPaper => {
    // OpenAlex serves abstracts as inverted-index — reconstruct the rough text.
    const inv = w.abstract_inverted_index ?? undefined;
    let abstract: string | null = null;
    if (inv) {
      const positions: Array<[number, string]> = [];
      for (const [word, idxs] of Object.entries(inv)) {
        for (const i of idxs) positions.push([i, word]);
      }
      positions.sort((a, b) => a[0] - b[0]);
      abstract = positions.map(([, w]) => w).join(" ").slice(0, 1500);
    }
    const doi: string | undefined = w.doi ? String(w.doi).replace("https://doi.org/", "").toLowerCase() : undefined;
    return {
      source: "openalex",
      externalId: doi,
      title: w.title ?? "",
      abstract,
      year: w.publication_year ?? null,
      authors: (w.authorships ?? [])
        .slice(0, 5)
        .map((a) => a.author?.display_name)
        .filter(isString),
      venue: w.host_venue?.display_name ?? w.primary_location?.source?.display_name ?? null,
      citationCount: w.cited_by_count ?? null,
      url: w.id || (doi ? `https://doi.org/${doi}` : undefined),
    };
  });
}

export async function searchPubMed(
  q: string,
  timeoutMs = DEFAULT_TIMEOUT,
  fetchFn: typeof fetch = fetch,
): Promise<LitPaper[]> {
  // 1) esearch for PMIDs. sort=relevance is PubMed's "Best Match". Without
  //    it E-utilities return the most recently added PMIDs first: for
  //    "ELISA method protocol" that was this month's papers on HTLV-1 in
  //    blood donors and a virus RT-LAMP assay, instead of the ELISA methods
  //    reviews Best Match puts first.
  const search = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
  search.searchParams.set("db", "pubmed");
  search.searchParams.set("term", q);
  search.searchParams.set("retmode", "json");
  search.searchParams.set("retmax", "8");
  search.searchParams.set("sort", "relevance");
  const sRes = await fetchFn(search.toString(), {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!sRes.ok) return [];
  const sJson = await sRes.json();
  const ids: string[] = sJson.esearchresult?.idlist ?? [];
  if (ids.length === 0) return [];
  // 2) esummary for metadata
  const sum = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi");
  sum.searchParams.set("db", "pubmed");
  sum.searchParams.set("id", ids.join(","));
  sum.searchParams.set("retmode", "json");
  const uRes = await fetchFn(sum.toString(), {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!uRes.ok) return [];
  const uJson = await uRes.json();
  const result = uJson.result ?? {};
  const out: LitPaper[] = [];
  for (const id of ids) {
    const r = result[id] as PubMedSummary | undefined;
    if (!r) continue;
    const doi: string | undefined = (r.articleids ?? [])
      .find((a) => a.idtype === "doi")?.value?.toLowerCase();
    out.push({
      source: "pubmed",
      externalId: doi ?? `pmid:${id}`,
      title: r.title ?? "",
      abstract: null,
      year: r.pubdate ? parseInt(String(r.pubdate).slice(0, 4), 10) || null : null,
      authors: (r.authors ?? []).slice(0, 5).map((a) => a.name).filter(isString),
      venue: r.fulljournalname ?? r.source ?? null,
      citationCount: null,
      url: doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
    });
  }
  return out;
}

/** Normalise a title for fuzzy dedup keying. */
function titleKey(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

/**
 * For a single source, try each query in order until one returns results.
 * Uses shorter timeouts for degraded (non-first) queries.
 */
async function searchSourceWithFallback(
  sourceFn: (q: string, t: number) => Promise<LitPaper[]>,
  queries: string[],
): Promise<{ papers: LitPaper[]; status: PromiseSettledResult<LitPaper[]>["status"] }> {
  // Keep firing queries (full → expanded → degraded → expanded-degraded)
  // and merge results, deduped by externalId/title, until we have ≥10
  // candidates or run out of queries. Earlier (more-specific) queries
  // are tried first; later queries top-up recall — important when an
  // abbreviation expansion (5-FU → 5-fluorouracil) surfaces classic
  // papers that the abbreviated query missed.
  const merged: LitPaper[] = [];
  const seen = new Set<string>();
  let anyOk = false;
  let lastErr = false;
  const TARGET = 10;
  for (let i = 0; i < queries.length; i++) {
    if (merged.length >= TARGET) break;
    const timeout = i === 0 ? DEFAULT_TIMEOUT : DEGRADED_TIMEOUT;
    try {
      const papers = await sourceFn(queries[i], timeout);
      anyOk = true;
      for (const p of papers) {
        const key = (p.externalId && p.externalId.startsWith("10.") ? p.externalId : titleKey(p.title ?? ""))?.toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.push(p);
        if (merged.length >= TARGET) break;
      }
    } catch {
      lastErr = true;
    }
  }
  if (merged.length > 0) return { papers: merged, status: "fulfilled" };
  if (anyOk) return { papers: [], status: "fulfilled" };
  return { papers: [], status: lastErr ? "rejected" : "fulfilled" };
}

/** How many merged candidates searchLiterature returns (the caller re-ranks and keeps 8). */
export const MAX_CANDIDATES = 12;

/**
 * `rankText` (the hypothesis; defaults to `query`) decides which of the
 * merged hits are kept: the ones that cover most of its weighted concepts.
 * The merged list used to be sorted by "has an abstract" and citation count
 * before it was cut to 10, so highly cited papers from the broadest keyword
 * query pushed out the specific ones.
 */
export async function searchLiterature(query: string, rankText?: string): Promise<LitResult> {
  // Fire all three sources in parallel. Each source independently tries
  // degraded queries, so worst-case wall-time = max(single-source cascade)
  // instead of sum(all-sources × all-queries).
  const queries = degradedQueries(query);

  const [s2Result, oaResult, pmResult] = await Promise.all([
    searchSourceWithFallback(searchS2, queries),
    searchSourceWithFallback(searchOpenAlex, queries),
    searchSourceWithFallback(searchPubMed, queries),
  ]);

  const s2Papers = s2Result.papers;
  const oaPapers = oaResult.papers;
  const pmPapers = pmResult.papers;
  const s2Status = s2Result.status;
  const oaStatus = oaResult.status;
  const pmStatus = pmResult.status;

  const total = s2Papers.length + oaPapers.length + pmPapers.length;
  if (total > 0 && queries.length > 1) {
    console.log(`[literature] parallel degraded search recovered ${total} hits`);
  }

  // Dedup priority: prefer the source with abstract (S2 / OpenAlex over PubMed).
  const merged: LitPaper[] = [];
  const seenDoi = new Set<string>();
  const seenTitle = new Set<string>();
  for (const p of [...s2Papers, ...oaPapers, ...pmPapers]) {
    if (!p.title) continue;
    const doiKey = p.externalId && p.externalId.startsWith("10.") ? p.externalId : null;
    const tKey = titleKey(p.title);
    if (doiKey && seenDoi.has(doiKey)) continue;
    if (!doiKey && seenTitle.has(tKey)) continue;
    if (doiKey) seenDoi.add(doiKey);
    seenTitle.add(tKey);
    merged.push(p);
  }
  // Sort: coverage of the hypothesis first, then papers with abstracts
  // (more useful for novelty classification), then citation count.
  const concepts = hypothesisConcepts(rankText ?? query);
  const score = new Map<LitPaper, number>(merged.map((p) => [p, paperRelevance(concepts, p.title, p.abstract).score]));
  merged.sort((a, b) => {
    const d = (score.get(b) ?? 0) - (score.get(a) ?? 0);
    if (Math.abs(d) > 1e-9) return d;
    const aHas = a.abstract ? 1 : 0;
    const bHas = b.abstract ? 1 : 0;
    if (aHas !== bHas) return bHas - aHas;
    return (b.citationCount ?? 0) - (a.citationCount ?? 0);
  });

  return {
    papers: merged.slice(0, MAX_CANDIDATES),
    sources: {
      s2: s2Status === "fulfilled" && s2Papers.length > 0,
      openalex: oaStatus === "fulfilled" && oaPapers.length > 0,
      pubmed: pmStatus === "fulfilled" && pmPapers.length > 0,
    },
    // If everyone returned 0 AND at least one rejected, treat as rate-limited.
    rateLimited:
      merged.length === 0 &&
      [s2Status, oaStatus, pmStatus].some((s) => s === "rejected"),
  };
}
