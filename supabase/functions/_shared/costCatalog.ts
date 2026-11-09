// Reference cost catalog injected into the planning prompt so budgets are
// grounded in plausible 2024-2025 USD prices instead of hallucinated.
// Numbers are list prices from Sigma-Aldrich, Thermo Fisher, IDT, Promega,
// Qiagen, ATCC, Addgene, NEB, BioRad, Eppendorf and common CRO/labour rates.
//
// The items are grouped by topic, and the planner only sees the groups that
// fit the hypothesis (costCatalogPrompt). Until 9 Nov 2026 the whole catalog
// went into every prompt, and the small local model copied its first items
// into the materials list whatever the experiment was: an NAD+ assay in
// SH-SY5Y cells got Taq polymerase, Q5, a DNA ladder and agarose. The prompt
// now also says the catalog is a price reference, not a shopping list, and
// run-experiment flags catalog items from groups that do not fit the
// hypothesis (planGuards.ts).

export interface CatalogGroup {
  id: string;
  label: string;
  /** Hypothesis wording that makes this group relevant. Null = always shown. */
  keywords: RegExp | null;
  items: Record<string, number | string>;
}

export const CATALOG_GROUPS: CatalogGroup[] = [
  {
    id: "molecular_biology",
    label: "Molecular biology (PCR, cloning, nucleic acids)",
    keywords: /\b(?:q?pcr|rt-?q?pcr|dna|rna|cdna|mrna|sirna|shrna|plasmids?|clon(?:e|ed|es|ing)|primers?|amplif\w*|sequenc\w*|genes?|genetic\w*|genom\w*|crispr|cas9|transfect\w*|knock-?(?:out|down|in)|mutants?|mutagen\w*|vectors?|oligo\w*|gblocks?|transcript\w*|gel electrophoresis|agarose|ligation|restriction enzymes?)\b/i,
    items: {
      "Taq polymerase (500 U)": 180,
      "Q5 high-fidelity polymerase (100 U)": 250,
      "DNA ladder (50 lanes)": 75,
      "Agarose, molecular grade (500 g)": 220,
      "TBE buffer 10x (1 L)": 45,
      "SYBR Safe gel stain (400 uL)": 95,
      "QIAprep miniprep kit (250)": 720,
      "QIAquick gel extraction kit (250)": 680,
      "RNeasy mini kit (250)": 950,
      "Lipofectamine 3000 (1.5 mL)": 530,
      "Custom DNA oligo, 25 nmol (per oligo)": 12,
      "gBlock gene fragment, 500 bp (per construct)": 95,
      "Sanger sequencing (per reaction)": 6,
      "Thermocycler (PCR), amortised per month": 120,
      "Real-time qPCR machine, amortised per month": 380,
      "Illumina MiSeq lane": 1400,
    },
  },
  {
    id: "cell_culture",
    label: "Cell culture",
    keywords: /\b(?:cells?|cell lines?|cultur\w*|in vitro|hela|hek ?293t?|sh-?sy5y|fibroblasts?|neurons?|neuronal|neuroblastoma|organoids?|cho|jurkat|mcf-?7|a549|hepg2|ipscs?|stem cells?|keratinocytes?|macrophages?|confluen\w*)\b/i,
    items: {
      "DMEM (500 mL)": 35,
      "FBS, qualified (500 mL)": 480,
      "Pen/Strep 100x (100 mL)": 50,
      "PBS sterile (1 L)": 28,
      "Trypsin-EDTA 0.25% (100 mL)": 32,
      "T75 culture flask (case of 100)": 280,
      "HEK293T (ATCC vial)": 580,
      "HeLa (ATCC vial)": 580,
      "Biosafety cabinet, amortised per month": 65,
      "CO2 incubator, amortised per month": 45,
      "Confocal microscope (shared core, per hour)": 90,
      "Flow cytometer (shared core, per hour)": 75,
    },
  },
  {
    id: "protein_immunoassay",
    label: "Proteins and immunoassays",
    keywords: /\b(?:proteins?|antibod\w*|elisa|western|blots?|immuno\w*|cytokines?|crp|c-reactive|biomarkers?|serum|plasma|il-?\d+|tnf\w*|phospho\w*|kinases?|enzymes?|biosensors?)\b/i,
    items: {
      "Antibody, primary unconjugated (100 ug)": 420,
      "Antibody, secondary HRP (200 ug)": 280,
      "ELISA kit, single-target (96 tests)": 650,
      "Western blot ECL substrate (100 mL)": 220,
      "BCA protein assay kit (500 tests)": 240,
    },
  },
  {
    id: "animals",
    label: "Animal work",
    keywords: /\b(?:mouse|mice|murine|rats?|rodents?|in vivo|animals?|zebrafish|c57bl\S*|sprague)\b/i,
    items: {
      "C57BL/6J mouse (per animal)": 35,
      "Sprague-Dawley rat (per animal)": 65,
      "Mouse housing (per cage / week)": 12,
      "IACUC protocol fee (one-time)": 1200,
    },
  },
  {
    id: "general",
    label: "General lab consumables and shared equipment",
    keywords: null,
    items: {
      "96-well plate (case of 100)": 320,
      "Pipette tips, filtered, racked (case 960)": 240,
      "Microcentrifuge tubes 1.5 mL (1000)": 95,
      "Plate reader (multimode), amortised per month": 280,
      "Mass spec (shared core, per sample)": 95,
      "-80 C freezer (shared), per month": 40,
    },
  },
  {
    id: "labour",
    label: "Labour, USD per month at 1 FTE",
    keywords: null,
    items: {
      "Principal investigator": 18000,
      "Postdoctoral researcher": 7500,
      "Senior research scientist": 11000,
      "Research associate / technician": 5500,
      "Graduate student (with stipend + tuition)": 6800,
      "Bioinformatician": 9500,
      "Lab manager": 8500,
      "Statistician (consulting, hourly @ $180)": 2880,
    },
  },
  {
    id: "overhead",
    label: "Overhead",
    keywords: null,
    items: {
      "Institutional indirect cost (% of direct)": "typically 25-65% of direct costs",
      "Shipping / cold chain (per study)": 800,
      "Publication APC (open access journal)": 3200,
    },
  },
];

/** Topic groups that fit a hypothesis (always-on groups included). */
export function relevantCatalogGroups(text: string): CatalogGroup[] {
  return CATALOG_GROUPS.filter((g) => !g.keywords || g.keywords.test(text));
}

/** Prompt block with only the catalog groups that fit the hypothesis. */
export function costCatalogPrompt(text: string): string {
  const groups = relevantCatalogGroups(text);
  const body: Record<string, Record<string, number | string>> = {};
  for (const g of groups) body[g.label] = g.items;
  return `
REFERENCE COST CATALOG (USD list prices). It is a PRICE REFERENCE, not a shopping list: use it to price items your protocol actually needs (adjust +-20% if justified). Do NOT add a catalog item to the materials unless the protocol uses it. Items the experiment needs that are not listed (the compound under test, assay kits, cell lines, organisms) must still be in the materials with your best price estimate.
${JSON.stringify(body, null, 2)}
`;
}

/** Back-compat: the whole catalog (every group). */
export const COST_CATALOG = Object.fromEntries(CATALOG_GROUPS.map((g) => [g.id, g.items]));
