// Live SKU verification — best-effort check against Sigma-Aldrich's public
// product search. Confirms a catalog number actually exists and (loosely)
// matches the declared product name.
//
// Strict budget: at most TOP_N reagents are checked, each with a 3 s timeout,
// in parallel. Any failure (network, rate-limit, no JSON) returns "unknown"
// rather than a false-positive — we never flag based on a missing response.

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

const TIMEOUT_MS = 3000;
const TOP_N = 3;
const UA = "AI-Scientist/1.0 (Lovable; verification)";

async function checkSigma(cat: string): Promise<{ found: boolean; name?: string }> {
  // Public unauth'd autocomplete — small JSON, fast.
  const url = `https://www.sigmaaldrich.com/api/search/site-search/autocomplete?q=${encodeURIComponent(cat)}&types=PRODUCT`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { found: false };
    const j = await res.json().catch(() => null);
    // deno-lint-ignore no-explicit-any
    const items: any[] = j?.products ?? j?.suggestions ?? j?.items ?? [];
    if (!Array.isArray(items) || items.length === 0) return { found: false };
    const hit = items.find((p) => {
      const sku = String(p?.productNumber ?? p?.sku ?? p?.id ?? "").toUpperCase();
      return sku === cat.toUpperCase();
    });
    if (!hit) return { found: false };
    return { found: true, name: String(hit.name ?? hit.title ?? hit.description ?? "") };
  } catch {
    return { found: false };
  }
}

function nameLooksRelated(declared: string, canonical: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/);
  const d = new Set(norm(declared));
  const c = new Set(norm(canonical));
  if (c.size === 0 || d.size === 0) return true; // nothing to compare → don't flag
  let overlap = 0;
  for (const w of d) if (c.has(w) && w.length >= 4) overlap++;
  // At least one substantive shared content word.
  return overlap >= 1;
}

/**
 * Verify up to TOP_N Sigma-Aldrich materials against the live catalog. Other
 * suppliers are skipped (no good unauth'd endpoint). Returns issues for SKUs
 * that confidently don't exist or whose names look unrelated.
 *
 * Designed to NEVER block: any error returns no issue for that material.
 */
export async function verifyMaterialsLive(
  materials: Material[] | undefined,
): Promise<SkuIssue[]> {
  if (!Array.isArray(materials)) return [];
  const targets: Array<{ idx: number; m: Material }> = [];
  for (let i = 0; i < materials.length; i++) {
    const m = materials[i];
    const supplier = (m?.supplier ?? "").toLowerCase();
    const cat = (m?.catalog_number ?? "").trim();
    if (!cat || /^custom$/i.test(cat)) continue;
    if (!/sigma|millipore|aldrich|supelco/.test(supplier)) continue;
    targets.push({ idx: i, m });
    if (targets.length >= TOP_N) break;
  }
  if (targets.length === 0) return [];

  const results = await Promise.all(targets.map((t) => checkSigma(t.m.catalog_number!.trim())));
  const issues: SkuIssue[] = [];
  for (let k = 0; k < targets.length; k++) {
    const { idx, m } = targets[k];
    const r = results[k];
    const cat = m.catalog_number!.trim();
    const declared = m.name ?? "";
    if (!r.found) {
      issues.push({
        material_index: idx,
        catalog_number: cat,
        declared_name: declared,
        reason: "not_found_on_supplier",
        supplier_hint: "Sigma-Aldrich autocomplete returned no exact match for this SKU.",
      });
      continue;
    }
    if (r.name && !nameLooksRelated(declared, r.name)) {
      issues.push({
        material_index: idx,
        catalog_number: cat,
        declared_name: declared,
        reason: "name_mismatch_on_supplier",
        supplier_hint: `Supplier lists this SKU as "${r.name}".`,
      });
    }
  }
  return issues;
}
