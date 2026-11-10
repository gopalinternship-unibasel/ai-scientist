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
// Strict budget: at most TOP_N reagents are checked, two at a time (PubChem
// allows 5 requests a second), each with a few short sequential requests
// (one per brand suffix). Any failure (network, throttling, unexpected JSON)
// returns "unknown" rather than a false positive.
//
// Every result is reported (lookupMaterialsLive). Until QA round 3 only a
// SKU that resolved to a clearly different product was reported, and a
// number PubChem does not know was silently accepted, so an invented
// "Sigma S1000" for sodium butyrate (run 92185b64) was shown as a real
// catalog number. Such a number is now "not_found": not proof that it is
// wrong (Sigma does not deposit antibodies, kits or cell lines in PubChem),
// so the plan marks it unverified instead of removing it.
//
// "Verified" needs more than a shared word. The first version of that status
// (10 Nov 2026) called a number confirmed when the declared name and the
// supplier's name shared one word of four letters, or when the declared name
// was only an acronym: "Sodium butyrate" with the number of sodium chloride
// and "BSA" with the number of DMSO both came out verified. The names must
// now agree (nameAgreement), by the supplier's product name or by one of the
// names PubChem lists for that compound ("Metformin" for Sigma's
// "1,1-Dimethylbiguanide hydrochloride"). A number found under a name that
// only partly fits is "unconfirmed": the plan shows it as unverified with
// the supplier's name next to it.

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
const TOP_N = 8;
const CONCURRENCY = 2;
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

// PubChem asks for at most five requests a second and answers 503 above
// that. Two materials are looked up at a time, each with several requests
// (brand suffixes, the compound, its names), so the real requests are
// spaced out and a throttled one is tried once more. Stubs in tests are not
// slowed down.
const MIN_GAP_MS = 250;
let nextSlot = 0;

async function pubchemGet(url: string, fetchFn: FetchFn): Promise<Response> {
  const real = fetchFn === fetch;
  for (let attempt = 0; ; attempt++) {
    if (real) {
      const now = Date.now();
      const at = Math.max(now, nextSlot);
      nextSlot = at + MIN_GAP_MS;
      if (at > now) await new Promise((r) => setTimeout(r, at - now));
    }
    const res = await fetchFn(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if ((res.status === 503 || res.status === 429) && attempt === 0 && real) {
      try { await res.body?.cancel(); } catch { /* noop */ }
      await new Promise((r) => setTimeout(r, 1200));
      continue;
    }
    return res;
  }
}

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
      const res = await pubchemGet(`${PUBCHEM}/${encodeURIComponent(sourceId)}/synonyms/JSON`, fetchFn);
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

// --- do two names mean the same product? ---------------------------------------

// Words that describe the form or grade of a product, not what it is.
const DESCRIPTORS = new Set([
  "solution", "stock", "powder", "grade", "reagent", "reagentplus", "bioreagent", "bioxtra", "bioultra",
  "sterile", "filtered", "anhydrous", "hydrate", "monohydrate", "dihydrate", "trihydrate", "tetrahydrate",
  "pentahydrate", "hexahydrate", "heptahydrate", "hydrochloride", "monohydrochloride", "dihydrochloride",
  "hcl", "salt", "free", "base", "purity", "pure", "purified", "standard", "analytical", "molecular",
  "biology", "tested", "suitable", "for", "the", "and", "with", "from", "in", "of", "an", "high", "low",
  "liquid", "solid", "lyophilized", "lyophilised", "crystalline", "crystals", "working", "concentrate",
  "concentrated", "culture", "cell", "acs", "usp", "hplc", "gc", "ultrapure", "certified", "plant",
  "insect", "vetec", "sigmaultra", "acid", "tm", "alpha", "beta", "gamma", "delta", "dl", "cis", "trans",
  "aqueous", "buffered", "ready", "use", "to", "by", "at", "approx", "ca",
]);
// Ions that many unrelated products share: "sodium" alone does not relate two names.
const COMMON_IONS = new Set([
  "sodium", "potassium", "calcium", "magnesium", "lithium", "ammonium", "zinc", "iron", "copper", "disodium",
  "trisodium", "dipotassium", "chloride", "bromide", "iodide", "fluoride", "sulfic", "phosphic", "nitric",
  "carbonic", "bicarbonic", "hydroxide", "oxide", "monobasic", "dibasic", "tribasic",
]);

/** Plural stem, and the salt name as its acid ("palmitate" and "palmitic" are one compound family). */
function canonWord(w: string): string {
  let t = w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
  if (t.length > 5 && t.endsWith("ate")) t = `${t.slice(0, -3)}ic`;
  return t;
}

/** The words of a product name that say what it is (amounts, grades and forms dropped). */
export function productWords(name: string): Set<string> {
  const cleaned = (name ?? "").normalize("NFKC").toLowerCase()
    .replace(/[µμ]/g, "u")
    .replace(/[<>=≥≤~]*\s*\d+(?:[.,]\d+)?\s*%/g, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:x|mg|g|kg|ug|ng|ml|l|ul|mm|um|nm|pm|m|u|iu|units?|vials?|pack|pk|ea)\b/g, " ");
  const out = new Set<string>();
  for (const raw of cleaned.split(/[^a-z0-9]+/)) {
    // One character says nothing ("O" of Oil Red O, "X" of X-100, the "1" of 1,1-dimethyl...);
    // a number of two digits or more does ("Tween 20" is not "Tween 80").
    if (raw.length < 2 || DESCRIPTORS.has(raw)) continue;
    const w = canonWord(raw);
    if (!DESCRIPTORS.has(w)) out.add(w);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / (a.size + b.size - both);
}

/** A name's readings: all of it, the part before the first comma, and each bracketed alternative. */
function nameReadings(name: string, ignore?: Set<string>): Set<string>[] {
  const brackets = [...(name ?? "").matchAll(/\(([^()]*)\)/g)].map((m) => m[1]);
  const outside = (name ?? "").replace(/\([^()]*\)/g, " ");
  const seen = new Set<string>();
  const out: Set<string>[] = [];
  for (const part of [outside, outside.split(",")[0], ...brackets]) {
    const words = productWords(part);
    if (ignore) for (const w of ignore) words.delete(w);
    const key = [...words].sort().join(" ");
    if (words.size > 0 && !seen.has(key)) {
      seen.add(key);
      out.push(words);
    }
  }
  return out;
}

/** Share of words two names must have in common to be the same product (two of three). */
export const SAME_PRODUCT_SHARE = 0.66;

export type NameAgreement = "same" | "related" | "different";

/**
 * Whether a material's declared name and the names a catalogue gives a
 * number are the same product:
 *  - "same": one reading of the declared name and one catalogue name share
 *    at least two thirds of their words ("Sodium butyrate" and "Sodium
 *    butyrate, >=98.5% (GC)"; "DMSO" and the PubChem name "DMSO");
 *  - "related": not the same, but they share a word that says something
 *    ("Glucose" and "Glucose oxidase from Aspergillus niger");
 *  - "different": nothing but form words or common ions in common ("Sodium
 *    butyrate" and "Sodium chloride"; "BSA" and "Dimethyl sulfoxide").
 * `matched` is the catalogue name that agreed.
 */
export function nameAgreement(
  declared: string,
  catalogueNames: string[],
  /** Words left out on both sides (the cations, when the material names none: a bare "palmitate"). */
  ignore?: Set<string>,
): { agreement: NameAgreement; matched?: string } {
  const mine = nameReadings(declared, ignore);
  let related = false;
  for (const theirs of catalogueNames) {
    for (const t of nameReadings(theirs, ignore)) {
      for (const m of mine) {
        if (jaccard(m, t) >= SAME_PRODUCT_SHARE) return { agreement: "same", matched: theirs };
        if (related) continue;
        for (const w of m) {
          if (t.has(w) && !COMMON_IONS.has(w) && (w.length >= 4 || /\d/.test(w))) {
            related = true;
            break;
          }
        }
      }
    }
  }
  return { agreement: related ? "related" : "different" };
}

/**
 * True unless the two names have nothing in common (for callers that only
 * ask "is this clearly another product?"). A name without a comparable word
 * (form words only) is not called different.
 */
export function nameLooksRelated(declared: string, canonical: string): boolean {
  if (nameReadings(declared).length === 0 || nameReadings(canonical).length === 0) return true;
  return nameAgreement(declared, [canonical]).agreement !== "different";
}

const PUBCHEM_COMPOUND = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid";
/** How many of a compound's PubChem names are compared (PubChem lists the most used first). */
const MAX_SYNONYMS = 250;

/**
 * The names PubChem lists for the compound behind a Sigma-Aldrich source ID.
 * An empty list means the product is not a single compound (no CID); null
 * means the question could not be answered (network, throttling).
 */
export async function compoundNames(sourceId: string, fetchFn: FetchFn = fetch): Promise<string[] | null> {
  try {
    const res = await pubchemGet(`${PUBCHEM}/${encodeURIComponent(sourceId)}/cids/JSON`, fetchFn);
    if (res.status === 400 || res.status === 404) {
      try { await res.body?.cancel(); } catch { /* noop */ }
      return [];
    }
    if (!res.ok) return null;
    const j = await res.json().catch(() => null);
    const cid = j?.InformationList?.Information?.[0]?.CID?.[0];
    if (!Number.isInteger(cid)) return [];
    const syn = await pubchemGet(`${PUBCHEM_COMPOUND}/${cid}/synonyms/JSON`, fetchFn);
    if (!syn.ok) {
      try { await syn.body?.cancel(); } catch { /* noop */ }
      return null;
    }
    const names = (await syn.json().catch(() => null))?.InformationList?.Information?.[0]?.Synonym;
    if (!Array.isArray(names)) return null;
    return names.filter((n: unknown): n is string => typeof n === "string" && /[a-z]{3}/i.test(n)).slice(0, MAX_SYNONYMS);
  } catch {
    return null;
  }
}

/** One live lookup result, for planContentChecks.checkCatalogNumbers. */
export interface LiveSkuResult {
  material_index: number;
  catalog_number: string;
  /**
   * match: the catalogue lists the number as this product. mismatch: as
   * another product. unconfirmed: found, but the names only partly fit (or
   * the compound's other names could not be fetched). not_found: PubChem has
   * no such Sigma-Aldrich number. unknown: the lookup failed.
   */
  status: "match" | "mismatch" | "unconfirmed" | "not_found" | "unknown";
  /** For a mismatch or an unconfirmed number: what Sigma-Aldrich calls the product. */
  supplier_hint?: string;
  /** For a match: the PubChem source ID (and the compound name that agreed, when it was not the product name). */
  source?: string;
}

const SIGMA_SUPPLIER = /sigma|millipore|aldrich|supelco|merck|fluka/;

/** Compare one found number with the material's name; the compound's other names are fetched only when needed. */
async function judgeFound(
  declared: string,
  found: { name: string; source_id: string },
  fetchFn: FetchFn,
): Promise<Pick<LiveSkuResult, "status" | "supplier_hint" | "source">> {
  const listed = `Sigma-Aldrich lists this SKU as "${found.name}".`;
  // A name made only of form words ("Stock solution") cannot be compared.
  if (productWords(declared).size === 0) return { status: "unconfirmed", supplier_hint: listed };
  // A material that names no cation ("palmitate", "butyrate") is compared
  // without them: it may be the acid or any salt. One that does name a form
  // is held to it (saltConflict).
  const ignore = cations(declared) === "" ? CATION_SET : undefined;
  const byName = nameAgreement(declared, [found.name], ignore);
  if (byName.agreement === "same") {
    return saltConflict(declared, found.name) ? { status: "unconfirmed", supplier_hint: listed } : { status: "match", source: found.source_id };
  }
  const names = await compoundNames(found.source_id, fetchFn);
  if (names === null) {
    // Without the compound's other names, "Metformin" for Sigma's
    // "1,1-Dimethylbiguanide hydrochloride" cannot be told from a wrong number.
    return { status: "unconfirmed", supplier_hint: listed };
  }
  const bySynonym = names.length > 0 ? nameAgreement(declared, names, ignore) : byName;
  if (bySynonym.agreement === "same") {
    // PubChem files a salt's names under the acid's compound and the other
    // way round ("Sodium palmitate" is listed for palmitic acid). The number
    // is one of the two: when the material names a salt and the product is
    // the acid (or another salt), it is the same compound family but not
    // confirmed as this product.
    if (saltConflict(declared, found.name)) return { status: "unconfirmed", supplier_hint: listed };
    return { status: "match", source: `${found.source_id}; PubChem also names this compound "${shortName(bySynonym.matched ?? "")}"` };
  }
  const related = byName.agreement === "related" || bySynonym.agreement === "related";
  return related ? { status: "unconfirmed", supplier_hint: listed } : { status: "mismatch", supplier_hint: listed };
}

const CATIONS = ["sodium", "disodium", "trisodium", "potassium", "dipotassium", "calcium", "magnesium", "lithium", "ammonium", "zinc"];
const CATION_SET = new Set(CATIONS);

/** The salt-forming cations a product name states ("sodium"), as a sorted key. */
function cations(name: string): string {
  const words = new Set((name ?? "").toLowerCase().split(/[^a-z]+/));
  return CATIONS.filter((c) => words.has(c)).sort().join("+");
}

/**
 * The material names one form and the product is another: a named salt
 * against the acid or another salt, or the acid against a salt. A bare
 * "palmitate" fits either.
 */
function saltConflict(declared: string, product: string): boolean {
  const d = cations(declared);
  const p = cations(product);
  if (d) return d !== p;
  return /\bacid\b/i.test(declared) && p !== "";
}

function shortName(name: string): string {
  const first = name.split(",")[0].trim();
  return first.length > 80 ? `${first.slice(0, 77)}...` : first;
}

/**
 * Look up the catalog numbers of up to TOP_N Sigma-Aldrich / Merck
 * materials (other suppliers have no public unauthenticated catalogue).
 * Designed to never block: a failed lookup is "unknown".
 */
export async function lookupMaterialsLive(
  materials: Material[] | undefined,
  fetchFn: FetchFn = fetch,
): Promise<LiveSkuResult[]> {
  if (!Array.isArray(materials)) return [];
  const targets: Array<{ idx: number; m: Material }> = [];
  for (let i = 0; i < materials.length; i++) {
    const m = materials[i];
    const supplier = (m?.supplier ?? "").toLowerCase();
    const cat = String(m?.catalog_number ?? "").trim();
    if (!cat || /^custom$/i.test(cat)) continue;
    if (!SIGMA_SUPPLIER.test(supplier)) continue;
    targets.push({ idx: i, m });
    if (targets.length >= TOP_N) break;
  }
  const results: LiveSkuResult[] = new Array(targets.length);
  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const k = next++;
      const { idx, m } = targets[k];
      const cat = String(m.catalog_number ?? "").trim();
      const base = { material_index: idx, catalog_number: cat };
      try {
        const r = await lookupSigmaSku(cat, m.supplier ?? "", fetchFn);
        results[k] = r.status === "found"
          ? { ...base, ...(await judgeFound(String(m.name ?? ""), r, fetchFn)) }
          : { ...base, status: r.status };
        console.log(JSON.stringify({ step: "sku_verify", catalog_number: cat, status: results[k].status, ...(r.status === "found" ? { pubchem: r.source_id } : {}) }));
      } catch {
        results[k] = { ...base, status: "unknown" };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
  return results;
}

/**
 * The mismatches only (a SKU that resolves to another product), in the
 * older issue shape.
 */
export async function verifyMaterialsLive(
  materials: Material[] | undefined,
  fetchFn: FetchFn = fetch,
): Promise<SkuIssue[]> {
  const all = await lookupMaterialsLive(materials, fetchFn);
  return all.filter((r) => r.status === "mismatch").map((r) => ({
    material_index: r.material_index,
    catalog_number: r.catalog_number,
    declared_name: materials?.[r.material_index]?.name ?? "",
    reason: "name_mismatch_on_supplier" as const,
    supplier_hint: r.supplier_hint,
  }));
}
