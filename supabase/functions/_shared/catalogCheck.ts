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
  // The planner prompt used T9531 as its Sigma example until 9 Nov 2026 and
  // the local model copied it onto metformin (QA round 2). PubChem lists
  // T9531_SIGMA as "D-(+)-Trehalose dihydrate, from Saccharomyces
  // cerevisiae, >=99%" (checked 9 Nov 2026).
  "T9531":   { name: "D-(+)-Trehalose dihydrate (Sigma-Aldrich T9531)",
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
  reason: "name_mismatch" | "form_mismatch" | "format_mismatch";
}

// Supplier-specific catalog-number formats. We use these as a structural
// sanity check: a "Sigma-Aldrich" item with catalog number "ABC123XYZ" or a
// random 7-digit string is almost certainly hallucinated. These regexes are
// deliberately permissive — only blatant format violations get flagged.
const SUPPLIER_FORMATS: Array<{ match: RegExp; cat: RegExp; canonical: string }> = [
  // Sigma-Aldrich / MilliporeSigma: 1-2 letters + 3-7 digits, optional pack-size suffix
  { match: /sigma|millipore|aldrich|supelco/i,
    cat: /^[A-Z]{1,3}\d{3,7}(?:[-\s]?\d{1,4}\s?[A-Z]{0,4})?$/,
    canonical: "Sigma SKUs are typically 1–2 letters followed by 3–7 digits (e.g. T9531, PHR1084-1G)." },
  // Thermo Fisher / Invitrogen / Gibco: 7-9 digits, OR letter + 6-7 digits
  { match: /thermo|invitrogen|gibco|fisher/i,
    cat: /^(?:\d{7,9}|[A-Z]\d{6,7}|[A-Z]{1,2}\d{4,6})$/,
    canonical: "Thermo Fisher/Invitrogen catalog numbers are typically 7–9 digits (e.g. 11965092) or letter+digits (e.g. A3160401)." },
  // IDT — Alt-R catalog numbers are documented in the 108xxxx series. Custom
  // synthesised oligos are catalogued as "Custom". 7-digit numbers outside
  // 108xxxx are almost always hallucinated.
  { match: /^idt$|integrated\s+dna/i,
    cat: /^(?:Custom|10[78]\d{4})$/i,
    canonical: "IDT Alt-R catalog numbers are in the 107xxxx–108xxxx range (e.g. 1081058, 1072558). Use 'Custom' for synthesised oligos." },
  // ATCC: letters + dash + digits (CRL-3216, CCL-2, HTB-22) or pure digits
  { match: /^atcc$/i,
    // Sub-lines carry a decimal (HeLa S3 is CCL-2.2); primary cells are PCS-nnn-nnn.
    cat: /^(?:[A-Z]{2,4}-\d{1,5}(?:\.\d{1,2})?|PCS-\d{3}-\d{3}|\d{4,6}|VR-\d{2,5})$/,
    canonical: "ATCC catalog numbers are letters-dash-digits (e.g. CRL-3216, CCL-2, HTB-22)." },
  // Promega: letter + 4 digits (G3041, G7572) or letter + 4 digits + letter
  { match: /promega/i,
    cat: /^[A-Z]\d{3,4}[A-Z]?$/,
    canonical: "Promega catalog numbers are a letter followed by 3–4 digits (e.g. G3041)." },
  // NEB: letter + 4 digits + size suffix (M0491S, B7202S)
  { match: /^neb$|new\s+england/i,
    cat: /^[A-Z]\d{3,4}[A-Z]?$/,
    canonical: "NEB catalog numbers are letter + 4 digits + size suffix (e.g. M0491S)." },
  // Qiagen: 5 digits (69504, 74104)
  { match: /qiagen/i,
    cat: /^\d{4,6}$/,
    canonical: "Qiagen catalog numbers are 4–6 digits (e.g. 69504, 74104)." },
];

function looksLikeFormatViolation(supplier: string, cat: string):
  { violated: true; canonical: string } | { violated: false } {
  if (!supplier || !cat) return { violated: false };
  // Skip vendor-agnostic "Custom" entries — common for synthesised oligos.
  if (/^custom/i.test(cat)) return { violated: false };
  const rule = SUPPLIER_FORMATS.find((r) => r.match.test(supplier));
  if (!rule) return { violated: false };
  if (rule.cat.test(cat)) return { violated: false };
  return { violated: true, canonical: rule.canonical };
}

/**
 * Returns up to 8 issues. We cap so the critique block stays readable.
 * Comparison is case-insensitive and tolerant of trademark / whitespace junk.
 */
export function findCatalogIssues(
  // deno-lint-ignore no-explicit-any
  materials: Array<{ name?: string; catalog_number?: string; supplier?: string }> | undefined,
): CatalogIssue[] {
  if (!Array.isArray(materials)) return [];
  const out: CatalogIssue[] = [];

  for (let i = 0; i < materials.length; i++) {
    const m = materials[i];
    const cat = (m?.catalog_number ?? "").toString().trim();
    const name = (m?.name ?? "").toString();
    const supplier = (m?.supplier ?? "").toString();
    if (!cat || !name) continue;

    // Try exact, then upper-cased lookup.
    const entry = CATALOG[cat] ?? CATALOG[cat.toUpperCase()];
    if (entry) {
      const lowerName = name.toLowerCase();

      // Definite-mismatch substrings get priority — clearer signal.
      if (entry.mismatches?.some((m) => lowerName.includes(m.toLowerCase()))) {
        out.push({
          material_index: i, catalog_number: cat, declared_name: name,
          canonical_name: entry.name, reason: "form_mismatch",
        });
        if (out.length >= 8) break;
        continue;
      }

      // Otherwise require AT LEAST ONE expected substring to be present.
      const matchesExpected = entry.expects.some((e) => lowerName.includes(e.toLowerCase()));
      if (!matchesExpected) {
        out.push({
          material_index: i, catalog_number: cat, declared_name: name,
          canonical_name: entry.name, reason: "name_mismatch",
        });
        if (out.length >= 8) break;
      }
      continue;
    }

    // Fall through: catalog number not in dictionary. Run the format guard.
    const fmt = looksLikeFormatViolation(supplier, cat);
    if (fmt.violated) {
      out.push({
        material_index: i, catalog_number: cat, declared_name: name,
        canonical_name: fmt.canonical, reason: "format_mismatch",
      });
      if (out.length >= 8) break;
    }
  }
  return out;
}

// --- ATCC cell lines -----------------------------------------------------------
//
// ATCC numbers of common cell lines. QA round 3 (run 92185b64): the default
// local model gave Caco-2 cells "ATCC CCL-22" (Caco-2 is HTB-37), and no
// check knew better. A material that names one of these lines gets this
// number: a wrong one is corrected, a missing one filled in, and the number is
// shown as verified. Each pair was checked on 10 Nov 2026 with a PubMed
// Central search for the number together with the line's name: 838-8,704
// full-text papers per pair, against 33 for the QA's wrong "CCL-22" with
// Caco-2 (script check-atcc-pubmed.py in _e2e/ai-research-assistant-fix/round4/
// on Gopal's PC).
export interface CellLineEntry {
  /** ATCC catalogue number. */
  atcc: string;
  /** Usual name. */
  label: string;
  /** Spellings, compared with letters and digits only ("SH-SY5Y" = "shsy5y"). */
  aliases: string[];
}

export const ATCC_CELL_LINES: CellLineEntry[] = [
  { atcc: "HTB-37", label: "Caco-2", aliases: ["caco2"] },
  { atcc: "HB-8065", label: "Hep G2", aliases: ["hepg2"] },
  { atcc: "CRL-2266", label: "SH-SY5Y", aliases: ["shsy5y"] },
  { atcc: "CCL-2", label: "HeLa", aliases: ["hela"] },
  { atcc: "CRL-1573", label: "HEK-293", aliases: ["hek293", "293"] },
  { atcc: "CRL-3216", label: "293T (HEK293T)", aliases: ["hek293t", "293t"] },
  { atcc: "HTB-22", label: "MCF7", aliases: ["mcf7"] },
  { atcc: "CCL-185", label: "A549", aliases: ["a549"] },
  { atcc: "CCL-247", label: "HCT 116", aliases: ["hct116"] },
  { atcc: "HTB-38", label: "HT-29", aliases: ["ht29"] },
  { atcc: "HTB-26", label: "MDA-MB-231", aliases: ["mdamb231"] },
  { atcc: "TIB-152", label: "Jurkat, Clone E6-1", aliases: ["jurkat"] },
  { atcc: "TIB-71", label: "RAW 264.7", aliases: ["raw2647"] },
  { atcc: "TIB-202", label: "THP-1", aliases: ["thp1"] },
  { atcc: "CRL-1435", label: "PC-3", aliases: ["pc3"] },
  { atcc: "CRL-1740", label: "LNCaP clone FGC", aliases: ["lncap"] },
  { atcc: "CCL-81", label: "Vero", aliases: ["vero"] },
  { atcc: "CCL-61", label: "CHO-K1", aliases: ["chok1"] },
  { atcc: "CRL-1658", label: "NIH/3T3", aliases: ["nih3t3"] },
  { atcc: "CRL-1772", label: "C2C12", aliases: ["c2c12"] },
  { atcc: "CL-173", label: "3T3-L1", aliases: ["3t3l1"] },
  { atcc: "HTB-96", label: "U-2 OS", aliases: ["u2os"] },
  { atcc: "HTB-14", label: "U-87 MG", aliases: ["u87mg", "u87"] },
  { atcc: "CCL-243", label: "K-562", aliases: ["k562"] },
  { atcc: "CCL-240", label: "HL-60", aliases: ["hl60"] },
];

/** Words of a name as letters-and-digits keys, plus adjacent pairs ("HEK 293T" -> "hek293t"). */
function nameKeys(name: string): Set<string> {
  const words = (name ?? "").toLowerCase().split(/[\s,;:()[\]/]+/).map((w) => w.replace(/[^a-z0-9]/g, "")).filter(Boolean);
  const keys = new Set(words);
  for (let i = 0; i + 1 < words.length; i++) keys.add(words[i] + words[i + 1]);
  for (let i = 0; i + 2 < words.length; i++) keys.add(words[i] + words[i + 1] + words[i + 2]);
  return keys;
}

/** The ATCC cell line a material name refers to, if it is in ATCC_CELL_LINES. */
export function cellLineIn(name: string | undefined): CellLineEntry | null {
  const keys = nameKeys(name ?? "");
  // Longest alias first: "HEK293T" is 293T, not HEK-293.
  let best: CellLineEntry | null = null;
  let bestLen = 0;
  for (const e of ATCC_CELL_LINES) {
    for (const a of e.aliases) {
      if (a.length > bestLen && keys.has(a) && (a.length >= 4 || /cell|line|atcc/i.test(name ?? ""))) {
        best = e;
        bestLen = a.length;
      }
    }
  }
  return best;
}

// Words a cell-line material may carry besides the line's own name and
// still be that plain line ("HepG2 cells, human hepatocellular carcinoma, 1 vial").
const CELL_NAME_WORDS = new Set([
  "cell", "cells", "line", "lines", "human", "mouse", "murine", "rat", "monkey", "hamster", "atcc", "the", "of",
  "from", "a", "an", "and", "for", "per", "vial", "vials", "frozen", "cryovial", "cryopreserved", "stock",
  "passage", "low", "early", "hepatocellular", "carcinoma", "adenocarcinoma", "hepatoma", "hepatocyte",
  "hepatocytes", "neuroblastoma", "colorectal", "colon", "epithelial", "epithelium", "breast", "cancer", "lung",
  "kidney", "embryonic", "cervical", "leukemia", "leukaemia", "monocyte", "monocytes", "macrophage",
  "macrophages", "myoblast", "myoblasts", "fibroblast", "fibroblasts", "preadipocyte", "preadipocytes",
  "adipocyte", "adipocytes", "osteosarcoma", "glioblastoma", "prostate", "liver", "intestinal", "differentiated",
  "undifferentiated", "certified", "authenticated", "mycoplasma", "free", "tested", "culture", "cultured",
  "parental", "wild", "type", "wt", "adherent", "suspension", "ovary", "chinese", "african", "green",
  "lymphocyte", "lymphocytes", "lymphoblast", "neuronal", "neuron", "neurons", "tumor", "tumour", "x", "ml",
  "million", "t", "b",
]);

const alnumKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The ATCC cell line a material is, when its name is that line and nothing
 * else. A sub-line or an engineered variant has its own number ("Vero E6" is
 * CRL-1586, not Vero's CCL-81; "HeLa S3" is CCL-2.2; "HepG2/C3A",
 * "HEK293 cells stably expressing GFP"), so any word in the name that is not
 * part of the line's name, its ATCC number or a general description means
 * the list has no answer.
 */
export function plainCellLineIn(name: string | undefined): CellLineEntry | null {
  const e = cellLineIn(name);
  if (!e) return null;
  const own = [...e.aliases, alnumKey(e.label), alnumKey(e.atcc)];
  for (const token of (name ?? "").split(/[\s,;:()[\]/]+/)) {
    const key = alnumKey(token);
    if (!key || /^\d+$/.test(key) || CELL_NAME_WORDS.has(key)) continue;
    if (key.length >= 2 && own.some((o) => o.includes(key))) continue;
    if (atccShaped(token)) continue; // a number written into the name is judged as the number
    return null;
  }
  return e;
}

/** Whether a catalog number has ATCC's letters-dash-digits shape. */
export function atccShaped(cat: string): boolean {
  return /^[A-Z]{2,4}-\d{1,5}(?:\.\d{1,2})?$/i.test((cat ?? "").trim());
}

/**
 * Catalog numbers that look made up: a letter or two and a round number
 * (QA round 3, run 92185b64: Sigma "S1000", Thermo "A1000", "T1000",
 * "E1000"), a repeated digit ("A1111"), a counting sequence ("123456"), or a
 * placeholder word. ATCC-shaped numbers are left to the cell-line list.
 */
export function looksLikePlaceholder(cat: string | undefined): boolean {
  const raw = (cat ?? "").trim();
  if (!raw) return false;
  if (/^(?:x+|tbd|n\/?a|none|unknown|various|see notes?|placeholder|catalog(?:ue)? number)$/i.test(raw)) return true;
  if (atccShaped(raw)) return false;
  const t = raw.toUpperCase().replace(/[\s-]/g, "");
  return /^[A-Z]{0,3}[1-9]0{3,}$/.test(t)
    || /^[A-Z]{0,3}(\d)\1{3,}$/.test(t)
    || /^[A-Z]{0,3}(?:1234|12345|123456|1234567|12345678|123456789)$/.test(t);
}

/**
 * A catalog number the local dictionary knows as THIS product (the number
 * is listed and the material's name matches its expected words).
 */
export function dictionaryConfirms(cat: string | undefined, name: string | undefined): string | null {
  const c = (cat ?? "").toString().trim();
  const entry = CATALOG[c] ?? CATALOG[c.toUpperCase()];
  if (!entry) return null;
  const lower = (name ?? "").toLowerCase();
  if (entry.mismatches?.some((m) => lower.includes(m.toLowerCase()))) return null;
  return entry.expects.some((e) => lower.includes(e.toLowerCase())) ? entry.name : null;
}
