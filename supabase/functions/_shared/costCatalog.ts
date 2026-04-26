// Reference cost catalog injected into the planning prompt so budgets are
// grounded in plausible 2024-2025 USD prices instead of hallucinated.
// Numbers are list prices from Sigma-Aldrich, Thermo Fisher, IDT, Promega,
// Qiagen, ATCC, Addgene, NEB, BioRad, Eppendorf and common CRO/labour rates.
// Keep this short — tokens cost money. Only the most common items.

export const COST_CATALOG = {
  reagents_consumables_usd: {
    "Taq polymerase (500 U)": 180,
    "Q5 high-fidelity polymerase (100 U)": 250,
    "DNA ladder (50 lanes)": 75,
    "Agarose, molecular grade (500 g)": 220,
    "TBE buffer 10x (1 L)": 45,
    "Ethidium bromide alt. SYBR Safe (400 µL)": 95,
    "QIAprep miniprep kit (250)": 720,
    "QIAquick gel extraction kit (250)": 680,
    "RNeasy mini kit (250)": 950,
    "Lipofectamine 3000 (1.5 mL)": 530,
    "DMEM (500 mL)": 35,
    "FBS, qualified (500 mL)": 480,
    "Pen/Strep 100x (100 mL)": 50,
    "PBS sterile (1 L)": 28,
    "Trypsin-EDTA 0.25% (100 mL)": 32,
    "T75 culture flask (case of 100)": 280,
    "96-well plate, tissue culture (case of 100)": 320,
    "Pipette tips, filtered, racked (case 960)": 240,
    "Eppendorf tubes 1.5 mL (1000)": 95,
    "Custom DNA oligo, 25 nmol (per oligo)": 12,
    "gBlock gene fragment, 500 bp (per construct)": 95,
    "Sanger sequencing (per reaction)": 6,
    "Antibody, primary unconjugated (100 µg)": 420,
    "Antibody, secondary HRP (200 µg)": 280,
    "ELISA kit, single-target (96 tests)": 650,
    "Western blot ECL substrate (100 mL)": 220,
    "BCA protein assay kit (500 tests)": 240,
  },
  cell_lines_animals_usd: {
    "HEK293T (ATCC vial)": 580,
    "HeLa (ATCC vial)": 580,
    "C57BL/6J mouse (per animal)": 35,
    "Sprague-Dawley rat (per animal)": 65,
    "Mouse housing (per cage / week)": 12,
    "IACUC protocol fee (one-time)": 1200,
  },
  equipment_amortised_usd_per_month: {
    "Thermocycler (PCR)": 120,
    "Real-time qPCR machine": 380,
    "Plate reader (multimode)": 280,
    "Confocal microscope (shared core / hour)": 90,
    "Flow cytometer (shared core / hour)": 75,
    "Sequencing (Illumina MiSeq lane)": 1400,
    "Mass spec (shared core / sample)": 95,
    "Biosafety cabinet": 65,
    "Incubator (CO2)": 45,
    "−80 °C freezer (shared)": 40,
  },
  labour_rates_usd_per_month_at_1_fte: {
    "Principal investigator": 18000,
    "Postdoctoral researcher": 7500,
    "Senior research scientist": 11000,
    "Research associate / technician": 5500,
    "Graduate student (with stipend + tuition)": 6800,
    "Bioinformatician": 9500,
    "Lab manager": 8500,
    "Statistician (consulting, hourly @ $180)": 2880,
  },
  overhead_usd: {
    "Institutional indirect cost (% of direct)": "typically 25-65% of direct costs",
    "Shipping / cold chain (per study)": 800,
    "Publication APC (open access journal)": 3200,
  },
} as const;

export const COST_CATALOG_PROMPT = `
REFERENCE COST CATALOG (USD, list prices, use these as anchors — adjust ±20% if justified):
${JSON.stringify(COST_CATALOG, null, 2)}
`;
