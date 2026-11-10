// How a material's catalog number is shown (plan view and PDF).
//
// The plan checks (supabase/functions/_shared/planContentChecks.ts) mark a
// number "verified" only when a catalogue confirmed it for that product (the
// ATCC cell-line list, the local dictionary, or Sigma-Aldrich through
// PubChem). Every other number, and every number of a plan saved before QA
// round 3 (no status at all), is shown as unverified: until then invented
// numbers such as Sigma "S1000" appeared as real catalog numbers.
export interface CatalogFields {
  catalog_number?: string;
  catalog_status?: "verified" | "unverified";
  catalog_check?: string;
}

export interface CatalogDisplay {
  number: string;
  verified: boolean;
  /** Where it was confirmed, or why it could not be. */
  note: string;
}

export function catalogDisplay(m: CatalogFields): CatalogDisplay | null {
  const number = (m.catalog_number ?? "").toString().trim();
  if (!number) return null;
  const verified = m.catalog_status === "verified";
  const note = m.catalog_check
    ?? (m.catalog_status ? "" : "checked before the catalogue lookups existed; not confirmed");
  return { number, verified, note };
}
