// Multi-source literature search. Queries Semantic Scholar, OpenAlex and
// PubMed in parallel, normalises results into a single shape, and dedupes by
// DOI (then by lowercased-title prefix).
//
// All three sources are best-effort: a failure or rate-limit on one source
// just contributes zero rows. We surface which sources actually returned
// results so the caller can degrade gracefully.

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

export interface LitResult {
  papers: LitPaper[];
  sources: { s2: boolean; openalex: boolean; pubmed: boolean };
  rateLimited: boolean;
}

const UA = "AI-Scientist/1.0 (Lovable)";

async function searchS2(q: string): Promise<LitPaper[]> {
  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", q);
  url.searchParams.set("limit", "8");
  url.searchParams.set(
    "fields",
    "title,abstract,year,authors.name,venue,citationCount,url,externalIds",
  );
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const json = await res.json();
  // deno-lint-ignore no-explicit-any
  return (json.data ?? []).map((p: any): LitPaper => ({
    source: "s2",
    externalId: p.externalIds?.DOI?.toLowerCase(),
    title: p.title ?? "",
    abstract: p.abstract ?? null,
    year: p.year ?? null,
    authors: (p.authors ?? []).slice(0, 5).map((a: { name: string }) => a.name),
    venue: p.venue ?? null,
    citationCount: p.citationCount ?? null,
    url: p.url ?? (p.externalIds?.DOI
      ? `https://doi.org/${p.externalIds.DOI}`
      : `https://www.semanticscholar.org/paper/${p.paperId}`),
  }));
}

async function searchOpenAlex(q: string): Promise<LitPaper[]> {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", q);
  url.searchParams.set("per-page", "8");
  url.searchParams.set("mailto", "ai-scientist@lovable.dev"); // polite pool
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const json = await res.json();
  // deno-lint-ignore no-explicit-any
  return (json.results ?? []).map((w: any): LitPaper => {
    // OpenAlex serves abstracts as inverted-index — reconstruct the rough text.
    const inv: Record<string, number[]> | undefined = w.abstract_inverted_index;
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
        // deno-lint-ignore no-explicit-any
        .map((a: any) => a.author?.display_name)
        .filter(Boolean),
      venue: w.host_venue?.display_name ?? w.primary_location?.source?.display_name ?? null,
      citationCount: w.cited_by_count ?? null,
      url: w.id || (doi ? `https://doi.org/${doi}` : undefined),
    };
  });
}

async function searchPubMed(q: string): Promise<LitPaper[]> {
  // 1) esearch for PMIDs
  const search = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
  search.searchParams.set("db", "pubmed");
  search.searchParams.set("term", q);
  search.searchParams.set("retmode", "json");
  search.searchParams.set("retmax", "8");
  const sRes = await fetch(search.toString(), {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(8000),
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
  const uRes = await fetch(sum.toString(), {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(8000),
  });
  if (!uRes.ok) return [];
  const uJson = await uRes.json();
  const result = uJson.result ?? {};
  const out: LitPaper[] = [];
  for (const id of ids) {
    const r = result[id];
    if (!r) continue;
    const doi: string | undefined = (r.articleids ?? [])
      // deno-lint-ignore no-explicit-any
      .find((a: any) => a.idtype === "doi")?.value?.toLowerCase();
    out.push({
      source: "pubmed",
      externalId: doi ?? `pmid:${id}`,
      title: r.title ?? "",
      abstract: null,
      year: r.pubdate ? parseInt(String(r.pubdate).slice(0, 4), 10) || null : null,
      // deno-lint-ignore no-explicit-any
      authors: (r.authors ?? []).slice(0, 5).map((a: any) => a.name),
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

export async function searchLiterature(query: string): Promise<LitResult> {
  const q = query.replace(/\s+/g, " ").trim().slice(0, 280);
  const [s2, oa, pm] = await Promise.allSettled([
    searchS2(q),
    searchOpenAlex(q),
    searchPubMed(q),
  ]);
  const s2Papers = s2.status === "fulfilled" ? s2.value : [];
  const oaPapers = oa.status === "fulfilled" ? oa.value : [];
  const pmPapers = pm.status === "fulfilled" ? pm.value : [];

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
  // Sort: papers with abstracts first (more useful for novelty classification),
  // then by citation count desc.
  merged.sort((a, b) => {
    const aHas = a.abstract ? 1 : 0;
    const bHas = b.abstract ? 1 : 0;
    if (aHas !== bHas) return bHas - aHas;
    return (b.citationCount ?? 0) - (a.citationCount ?? 0);
  });

  return {
    papers: merged.slice(0, 10),
    sources: {
      s2: s2.status === "fulfilled" && s2Papers.length > 0,
      openalex: oa.status === "fulfilled" && oaPapers.length > 0,
      pubmed: pm.status === "fulfilled" && pmPapers.length > 0,
    },
    // If everyone returned 0 AND at least one rejected, treat as rate-limited.
    rateLimited:
      merged.length === 0 &&
      [s2, oa, pm].some((r) => r.status === "rejected"),
  };
}
