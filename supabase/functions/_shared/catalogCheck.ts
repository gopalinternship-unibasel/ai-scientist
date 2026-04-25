// Catalog cross-check. The model often pairs a real catalog number with the
// wrong product description (e.g. Sigma L7026 = "8M LiCl SOLUTION", not
// "anhydrous powder"). We can't call supplier APIs from the edge runtime, so
// instead we ship a small dictionary of frequently-cited cat# → canonical
// description mappings and flag mismatches in the critique.
//
// This won't catch every hallucination, but it catches the recurring ones the
// model drifts toward most often.

interface CanonicalEntry {
  /** Canonical product name as listed by the supplier. */
  name: string;
  /** Substrings that, if present in the model's name, indicate a likely correct match. */
  expects: string[];
  /** Substrings that indicate a definite mismatch (e.g. "powder" when product is solution). */
  mismatches?: string[];
}

const CATALOG: Record<string, CanonicalEntry> = {
  // Sigma-Aldrich
  "T0167":   { name: "D-(+)-Trehalose dihydrate, BioReagent",
               expects: ["trehalose"] },
  "D2650":   { name: "Dimethyl sulfoxide (DMSO) Hybri-Max, sterile-filtered",
               expects: ["dmso", "dimethyl sulfoxide"] },
  "L7026":   { name: "Lithium chloride solution 8 M (molecular biology grade)",
               expects: ["lithium chloride"],
               mismatches: ["anhydrous", "powder", "solid"] },
  "P2172":   { name: "C-Phycocyanin from Spirulina sp. (lyophilized powder)",
               expects: ["phycocyanin"] },
  "G7021":   { name: "D-(+)-Glucose",
               expects: ["glucose"] },
  "C6784":   { name: "Casein from bovine milk",
               expects: ["casein"] },
  "L1281":   { name: "Losartan potassium",
               expects: ["losartan"] },

  // Thermo Fisher / Invitrogen
  "11668019": { name: "Lipofectamine 2000 Transfection Reagent (1.5 mL)",
                expects: ["lipofectamine"],
                mismatches: ["lipofectamine 3000", "lipofectamine\u00a03000"] },
  "L3000015": { name: "Lipofectamine 3000 Transfection Reagent",
                expects: ["lipofectamine 3000"],
                mismatches: ["lipofectamine 2000"] },
  "11965092": { name: "DMEM, high glucose (500 mL)",
                expects: ["dmem"] },
  "12430054": { name: "DMEM, high glucose, GlutaMAX (500 mL)",
                expects: ["dmem"] },
  "A3160401": { name: "Fetal Bovine Serum, qualified, US origin (500 mL)",
                expects: ["fbs", "fetal bovine"] },
  "C10337":   { name: "Click-iT EdU Alexa Fluor 488 Imaging Kit",
                expects: ["edu", "click-it", "click-it"] },
  "S7563":    { name: "SYBR Safe DNA Gel Stain",
                expects: ["sybr safe"] },

  // ATCC
  "CRL-3216": { name: "293T (HEK293T) cell line",
                expects: ["293t", "hek293t", "hek 293t"] },
  "CCL-2":    { name: "HeLa cell line",
                expects: ["hela"] },
  "VR-1542":  { name: "Encephalomyocarditis virus",
                expects: ["encephalomyocarditis", "emcv"] },
  "700922":   { name: "Halobacterium salinarum NRC-1",
                expects: ["halobacterium"] },
  "CRL-3216 ": { name: "293T cell line",
                expects: ["293t", "hek293t"] },

  // Jackson Laboratory
  "000664":   { name: "C57BL/6J mice",
                expects: ["c57bl/6", "c57bl"] },

  // NEB
  "M0491S":   { name: "Q5 High-Fidelity DNA Polymerase (100 U)",
                expects: ["q5", "high-fidelity"] },

  // Qiagen
  "69504":    { name: "DNeasy Blood & Tissue Kit",
                expects: ["dneasy"] },
  "74104":    { name: "RNeasy Mini Kit (50 reactions)",
                expects: ["rneasy"] },

  // IDT
  "1081058":  { name: "Alt-R S.p. Cas9 Nuclease V3",
                expects: ["cas9"] },

  // Illumina
  "20020594": { name: "TruSeq Stranded mRNA Library Prep Kit",
                expects: ["truseq", "library prep"] },
};

export interface CatalogIssue {
  material_index: number;
  catalog_number: string;
  declared_name: string;
  canonical_name: string;
  reason: "name_mismatch" | "form_mismatch";
}

/**
 * Returns up to 8 issues. We cap so the critique block stays readable.
 * Comparison is case-insensitive and tolerant of trademark / whitespace junk.
 */
export function findCatalogIssues(
  // deno-lint-ignore no-explicit-any
  materials: Array<{ name?: string; catalog_number?: string }> | undefined,
): CatalogIssue[] {
  if (!Array.isArray(materials)) return [];
  const out: CatalogIssue[] = [];

  for (let i = 0; i < materials.length; i++) {
    const m = materials[i];
    const cat = (m?.catalog_number ?? "").toString().trim();
    const name = (m?.name ?? "").toString();
    if (!cat || !name) continue;

    // Try exact, then upper-cased lookup.
    const entry = CATALOG[cat] ?? CATALOG[cat.toUpperCase()];
    if (!entry) continue;

    const lowerName = name.toLowerCase();

    // Definite-mismatch substrings get priority — clearer signal.
    if (entry.mismatches?.some((m) => lowerName.includes(m.toLowerCase()))) {
      out.push({
        material_index: i,
        catalog_number: cat,
        declared_name: name,
        canonical_name: entry.name,
        reason: "form_mismatch",
      });
      if (out.length >= 8) break;
      continue;
    }

    // Otherwise require AT LEAST ONE expected substring to be present.
    const matchesExpected = entry.expects.some((e) => lowerName.includes(e.toLowerCase()));
    if (!matchesExpected) {
      out.push({
        material_index: i,
        catalog_number: cat,
        declared_name: name,
        canonical_name: entry.name,
        reason: "name_mismatch",
      });
      if (out.length >= 8) break;
    }
  }
  return out;
}
