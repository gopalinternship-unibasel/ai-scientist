// Live SKU verification — best-effort check that a Sigma-Aldrich catalog
// number really is the product the plan says it is.
//
// The original check called Sigma-Aldrich's site-search autocomplete. That
// endpoint became a GraphQL API that rejects plain GET requests (HTTP 400),
// and the old code treated every failed lookup as "SKU not found", so every
// Sigma reagent in every plan was flagged. Lookups now go to PubChem's
// public PUG REST API, where Sigma-Aldrich deposits its catalogue as
// substances whose source ID is "<product number>_<brand>" (for example
// T0167_SIGMA = "D-(+)-Trehalose dihydrate ... BioReagent").
//
// Strict budget: at most TOP_N reagents are checked, in parallel, each with a
// few short sequential requests (one per brand suffix). Any failure (network,
// throttling, unexpected JSON) returns "unknown" rather than a false
// positive. A catalog number PubChem does not know is also "unknown": Sigma
// does not deposit antibodies, kits or cell lines there, so absence proves
// nothing. Only a SKU that resolves to a clearly different product is
// reported.

interface Material {
  name?: string;
  catalog_number?: string;
  supplier?: string;
}

export interface SkuIssue {
  material_index: number;
  catalog_number: string;
  declared_name: string;
  reason: "not_found_on_supplier" | "name_mismatch_on_supplier";
  supplier_hint?: string;
}

export type SkuLookup =
  | { status: "found"; name: string; source_id: string }
  | { status: "not_found" }
  | { status: "unknown" };

const TIMEOUT_MS = 5000;
const TOP_N = 3;
const PUBCHEM = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/substance/sourceid/Sigma-Aldrich";
// Brand suffixes Sigma-Aldrich uses for its PubChem source IDs.
const BRANDS = ["SIGMA", "SIAL", "ALDRICH", "SUPELCO", "FLUKA"];

/** "PHR1084-1G" → "PHR1084" (drops a trailing pack size); otherwise unchanged. */
export function baseProductNumber(cat: string): string {
  const t = cat.trim().toUpperCase();
  const m = t.match(/^([A-Z0-9]+)-(\d+(?:\.\d+)?)(G|MG|KG|ML|L|UL|EA|VL|U|KU|MU|PAK|PKG)$/);
  return m ? m[1] : t;
}

function brandOrder(supplier: string): string[] {
  const s = supplier.toLowerCase();
  const first = /supelco/.test(s) ? "SUPELCO" : /fluka/.test(s) ? "FLUKA"
    : /aldrich/.test(s) && !/sigma/.test(s) ? "ALDRICH" : "SIGMA";
  return [first, ...BRANDS.filter((b) => b !== first)];
}

type FetchFn = typeof fetch;

/** Look one catalog number up in PubChem's Sigma-Aldrich deposits. */
export async function lookupSigmaSku(
  cat: string,
  supplier = "",
  fetchFn: FetchFn = fetch,
): Promise<SkuLookup> {
  const base = baseProductNumber(cat);
  if (!/^[A-Z0-9]{3,12}$/.test(base)) return { status: "unknown" };
  for (const brand of brandOrder(supplier)) {
    const sourceId = `${base}_${brand}`;
    try {
      const res = await fetchFn(`${PUBCHEM}/${encodeURIComponent(sourceId)}/synonyms/JSON`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 400 || res.status === 404) {
        // PubChem answers "Invalid identifier" for a source ID it does not
        // have; try the next brand suffix.
        try { await res.body?.cancel(); } catch { /* noop */ }
        continue;
      }
      if (!res.ok) return { status: "unknown" }; // throttled / server error
      const j = await res.json().catch(() => null);
      const name = j?.InformationList?.Information?.[0]?.Synonym?.[0];
      if (typeof name !== "string" || !name.trim()) return { status: "unknown" };
      return { status: "found", name: name.trim(), source_id: sourceId };
    } catch {
      return { status: "unknown" };
    }
  }
  return { status: "not_found" };
}

/**
 * True when the declared name and the supplier's product name share at least
 * one substantive word, or when the declared name has no word we can compare
 * (e.g. only an acronym such as "DMSO").
 */
export function nameLooksRelated(declared: string, canonical: string): boolean {
  const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  // Substantive words of the declared name: 4+ letters and not an acronym
  // written in capitals in the original text.
  const acronyms = new Set((declared.match(/\b[A-Z0-9]{2,6}\b/g) ?? []).map((a) => a.toLowerCase()));
  const d = words(declared).filter((w) => w.length >= 4 && !acronyms.has(w));
  const c = new Set(words(canonical));
  if (c.size === 0 || d.length === 0) return true; // nothing to compare → don't flag
  return d.some((w) => c.has(w));
}

/**
 * Verify up to TOP_N Sigma-Aldrich / Merck materials. Other suppliers are
 * skipped (no public unauthenticated catalogue). Returns issues only for SKUs
 * that resolve to a product whose name looks unrelated to the declared one.
 *
 * Designed to NEVER block: any error returns no issue for that material.
 */
export async function verifyMaterialsLive(
  materials: Material[] | undefined,
  fetchFn: FetchFn = fetch,
): Promise<SkuIssue[]> {
  if (!Array.isArray(materials)) return [];
  const targets: Array<{ idx: number; m: Material }> = [];
  for (let i = 0; i < materials.length; i++) {
    const m = materials[i];
    const supplier = (m?.supplier ?? "").toLowerCase();
    const cat = (m?.catalog_number ?? "").trim();
    if (!cat || /^custom$/i.test(cat)) continue;
    if (!/sigma|millipore|aldrich|supelco|merck|fluka/.test(supplier)) continue;
    targets.push({ idx: i, m });
    if (targets.length >= TOP_N) break;
  }
  if (targets.length === 0) return [];

  const results = await Promise.all(
    targets.map((t) => lookupSigmaSku(t.m.catalog_number!.trim(), t.m.supplier ?? "", fetchFn)),
  );
  const issues: SkuIssue[] = [];
  for (let k = 0; k < targets.length; k++) {
    const { idx, m } = targets[k];
    const r = results[k];
    const cat = m.catalog_number!.trim();
    const declared = m.name ?? "";
    console.log(JSON.stringify({ step: "sku_verify", catalog_number: cat, status: r.status, ...(r.status === "found" ? { pubchem: r.source_id } : {}) }));
    if (r.status === "found" && !nameLooksRelated(declared, r.name)) {
      issues.push({
        material_index: idx,
        catalog_number: cat,
        declared_name: declared,
        reason: "name_mismatch_on_supplier",
        supplier_hint: `Sigma-Aldrich lists this SKU as "${r.name}".`,
      });
    }
  }
  return issues;
}
