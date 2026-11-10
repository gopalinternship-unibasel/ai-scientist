// Adversarial inputs for the checks written after QA round 3 (review of 10
// Nov 2026). The first version of those checks passed the tester's examples
// and got these wrong:
//  - "Filter the palmitate solution (0.22 um)" was read as a 0.22 uM dose;
//  - "100 uL of 10 mM NMN into 10 mL" passed a 10 mM hypothesis (it is 99 uM);
//  - "0, 1, 10 and 100 uM metformin" failed a 10 uM hypothesis;
//  - "Sodium butyrate" with sodium chloride's Sigma number was "verified";
//  - a model that wrote "catalog_status": "verified" itself was believed;
//  - "Vero E6" (CRL-1586) was "corrected" to Vero's CCL-81;
//  - a real number shaped like a placeholder was removed although the
//    catalogue had confirmed it;
//  - "Culture until differentiated, medium every 2 days" (3 weeks) was a
//    duration error;
//  - "Extend the treatment to 2 weeks" became a 2-week cap on the timeline,
//    and "raise n to 12" next to the word budget a $12 budget cap;
//  - "an EVOM2 alone costs over $3,000" was dropped from the critique as an
//    invented budget claim.
// Run: deno test --allow-net --allow-env --allow-read --no-lock supabase/functions/_shared/
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { effectiveConstraints, hypothesisBudgetCap, parseRefinementConstraints, refinementConstraintPrompt, repairableIssues, verifyPlan } from "./planGuards.ts";
import {
  checkCatalogNumbers, dilutionIssues, doseIssues, hypothesisCellLines, hypothesisDoses, missingMaterials,
  readoutMissing, stepDurationIssues, stripStepCatalogNumbers,
} from "./planContentChecks.ts";
import { reconcileMaterialsLine } from "./planIntegrity.ts";
import { plainCellLineIn } from "./catalogCheck.ts";
import { parseDurationToHours } from "./timelineCheck.ts";
import { claimedBudgetAbove, cleanCritique } from "./critiqueGuards.ts";

const METFORMIN = "Treating HepG2 hepatocytes with 10 µM metformin for 24 h before a 0.5 mM palmitate challenge will reduce intracellular lipid accumulation, measured by Oil Red O staining, by at least 30% compared with vehicle-treated palmitate controls.";
const BUTYRATE = "Treating differentiated Caco-2 monolayers with 2 mM sodium butyrate for 72 hours will increase transepithelial electrical resistance (TEER) by at least 25% compared with untreated monolayers, measured with an epithelial voltohmmeter.";
const NMN_10 = "Treating SH-SY5Y neuroblastoma cells with 10 mM nicotinamide mononucleotide (NMN) for 24 hours will raise intracellular NAD+ levels by at least 40%.";

const steps = (...descriptions: string[]) => descriptions.map((description) => ({ description }));
const kinds = (v: { issues: { kind: string }[] }) => v.issues.map((i) => i.kind);

// --- doses -----------------------------------------------------------------------------------

Deno.test("doses: wavelengths, pore sizes, dish sizes and clock times are not concentrations", () => {
  for (const text of [
    "Elute the stain and read the metformin and vehicle cells at 510 nm.",
    "Read absorbance of the metformin-treated cells at 510 nm using a plate reader.",
    "Filter the palmitate solution (0.22 um) before use.",
    "Pass the palmitate-BSA complex through a 0.22 µm filter.",
    "Treat the cells with metformin in 35 mm dishes.",
    "Start the metformin treatment at 2 pm.",
    "Image the palmitate-loaded cells at 40 um depth.",
  ]) {
    assertEquals(doseIssues(METFORMIN, steps(text)), [], text);
  }
});

Deno.test("doses: a lower-case unit directly before the substance is still read as a concentration", () => {
  assertEquals(doseIssues(METFORMIN, steps("Add 10 um metformin to the cells.")), []);
  assertEquals(doseIssues(METFORMIN, steps("Add 10 mm metformin to the cells."))[0]?.plan, ["10 mM"]);
  assertEquals(hypothesisDoses("10 um metformin lowers lipid in HepG2 cells").map((d) => d.text), ["10 uM"]);
});

Deno.test("doses: the concentration a dilution starts from is a stock, with or without the word", () => {
  const diluted = steps("Add 100 uL of 10 mM NMN to 10 mL of medium on the cells.");
  const issues = doseIssues(NMN_10, diluted);
  assertEquals(issues.length, 1, "10 mM diluted 1:101 is about 99 uM, not the hypothesis' 10 mM");
  assertEquals(issues[0].plan, ["about 99 uM (100 uL of 10 mM into 10 mL)"]);
  // The same sentence with the right arithmetic passes.
  assertEquals(doseIssues(NMN_10, steps("Add 1 mL of 100 mM NMN to 9 mL of medium on the cells.")), []);
  assertEquals(dilutionIssues(steps("Add 1 mL of 100 mM NMN to 9 mL of medium to give 10 mM.")), []);
  assertEquals(dilutionIssues(steps("Add 1 mL of 100 mM NMN to 9 mL of medium to give 1 mM.")).length, 1);
});

Deno.test("doses: a dose series or a range that contains the hypothesis' dose passes", () => {
  assertEquals(doseIssues(METFORMIN, steps("Treat the cells with 0, 1, 10 and 100 µM metformin for 24 h.")), []);
  assertEquals(doseIssues(METFORMIN, steps("Treat the cells with 1, 10 or 100 µM metformin for 24 h.")), []);
  assertEquals(doseIssues(METFORMIN, steps("Treat the cells with 1-100 µM metformin for 24 h.")), []);
  assertEquals(doseIssues(METFORMIN, steps("Treat the cells with 5 to 20 µM metformin for 24 h.")), []);
  // A series or a range without it does not.
  assertEquals(doseIssues(METFORMIN, steps("Treat the cells with 50, 100 and 200 µM metformin for 24 h.")).length, 1);
  assertEquals(doseIssues(METFORMIN, steps("Treat the cells with 50-100 µM metformin for 24 h.")).length, 1);
  // In the hypothesis a number before the dose is not another dose.
  assertEquals(hypothesisDoses("From day 3, 10 µM metformin lowers lipid in HepG2 cells.").map((d) => d.text), ["10 uM"]);
});

Deno.test("doses: an acronym in the hypothesis belongs to the words it abbreviates", () => {
  const H = "Treating Caco-2 monolayers with 2 mM butyrate to raise resistance (TEER) by at least 25%, measured with an epithelial voltohmmeter.";
  // The 20 mM belongs to the buffer of a TEER sentence, not to butyrate.
  assertEquals(doseIssues(H, steps("Add butyrate to the wells.", "Dilute the buffer to 20 mM and measure TEER.")), []);
  // The measured quantity's acronym still finds the readout step.
  assertEquals(readoutMissing(H, steps("Measure TEER with an EVOM2 meter.")), null);
  // The compound's own acronym is another spelling of it.
  assertEquals(doseIssues(NMN_10, steps("Treat the cells with 1 mM NMN for 24 hours.")).length, 1);
  assertEquals(doseIssues(NMN_10, steps("Treat the cells with 10 mM NMN for 24 hours.")), []);
});

// --- step durations -----------------------------------------------------------------------------

Deno.test("durations: a step that runs until something happens, or repeats, is not compared with one interval in its text", () => {
  const open = [
    { description: "Culture Caco-2 cells on inserts until differentiated, changing the medium every 2 days.", duration: "3 weeks" },
    { description: "Passage the cells twice a week (15 min each time) and expand to 6 flasks.", duration: "2 weeks" },
    { description: "Repeat the 24 h treatment in three independent experiments.", duration: "2 weeks" },
  ];
  assertEquals(stepDurationIssues(open, parseDurationToHours), null);
  // One step of a week for ten minutes of work is still flagged.
  const bad = [{ description: "Stain the cells with Oil Red O for 10 min and wash.", duration: "1 week" }];
  assertEquals(stepDurationIssues(bad, parseDurationToHours)?.steps, [1]);
});

// --- catalog numbers ---------------------------------------------------------------------------

Deno.test("catalog: a status the model wrote itself is ignored", () => {
  const invented = [{ name: "Epithelial voltohmmeter", supplier: "World Precision Instruments", catalog_number: "EVOM9", catalog_status: "verified" as const, catalog_check: "trust me" }];
  const r = checkCatalogNumbers(invented);
  assertEquals(r.materials[0].catalog_status, "unverified");
  assertEquals(r.materials[0].catalog_check, "no searchable catalogue for World Precision Instruments");
  // A fresh model plan: its own verification block and statuses do not count.
  const fresh = verifyPlan({
    materials: invented,
    verification: { version: 2, pipeline_version: 99, sources: { removed: 0 }, budget: null, issues: [{ kind: "budget_total_corrected", severity: "medium", detail: "invented" }] },
  }, { hypothesis: BUTYRATE, references: [], fresh: true });
  assertEquals((fresh.plan.materials ?? [])[0].catalog_status, "unverified");
  assertEquals(kinds(fresh.verification).includes("budget_total_corrected"), false);
  assert(kinds(fresh.verification).includes("catalog_numbers_unverified"));
});

Deno.test("catalog: what a lookup confirmed outranks the guesses about a number's shape", () => {
  const real = [
    { name: "Some real product", supplier: "Sigma-Aldrich", catalog_number: "A1000" },      // placeholder-shaped
    { name: "Anti-NeuN antibody", supplier: "MilliporeSigma", catalog_number: "05-636" },   // outside the Sigma format rule
  ];
  const confirmed = checkCatalogNumbers(real, [
    { material_index: 0, catalog_number: "A1000", status: "match", source: "A1000_SIGMA" },
    { material_index: 1, catalog_number: "05-636", status: "match", source: "05636_SIGMA" },
  ]);
  assertEquals(confirmed.materials.map((m) => [m.catalog_number, m.catalog_status]), [["A1000", "verified"], ["05-636", "verified"]]);
  assertEquals(confirmed.removed, []);
  // Without a confirmation both are removed, as before.
  const unconfirmed = checkCatalogNumbers(real, [{ material_index: 0, catalog_number: "A1000", status: "not_found" }]);
  assertEquals(unconfirmed.removed.map((x) => x.catalog_number), ["A1000", "05-636"]);
  // The dictionary's "another product" still outranks everything.
  const wrong = checkCatalogNumbers([{ name: "Metformin", supplier: "Sigma-Aldrich", catalog_number: "T9531" }],
    [{ material_index: 0, catalog_number: "T9531", status: "match" }]);
  assertEquals(wrong.removed.length, 1);
});

Deno.test("catalog: a number found under a name that only partly fits is unverified, with the supplier's name", () => {
  const r = checkCatalogNumbers([{ name: "Glucose", supplier: "Sigma-Aldrich", catalog_number: "G7141" }], [
    { material_index: 0, catalog_number: "G7141", status: "unconfirmed", supplier_hint: 'Sigma-Aldrich lists this SKU as "Glucose Oxidase from Aspergillus niger".' },
  ]);
  assertEquals(r.materials[0].catalog_status, "unverified");
  assertEquals(r.materials[0].catalog_check, 'Sigma-Aldrich lists this number as "Glucose Oxidase from Aspergillus niger"; that name could not be matched to this material');
  assertEquals(r.unverified.length, 1);
});

Deno.test("catalog: only the plain cell line gets the list's ATCC number; sub-lines and engineered lines keep theirs", () => {
  for (const name of ["Vero E6 cells", "HeLa S3 cells", "HepG2/C3A cells", "HEK293 cells stably expressing GFP", "HCT116 p53-/- cells", "MCF-7/ADR cells", "Caco-2 Transwell plate"]) {
    const r = checkCatalogNumbers([{ name, supplier: "ATCC", catalog_number: "CRL-1586" }]);
    assertEquals(r.corrected, [], name);
    assertEquals(r.materials[0].catalog_number, "CRL-1586", name);
    assertEquals(r.materials[0].catalog_status, "unverified", name);
  }
  for (const [name, atcc] of [
    ["Caco-2 cells", "HTB-37"], ["Caco-2 cells (ATCC CCL-22)", "HTB-37"], ["HepG2 cells, human hepatocellular carcinoma, 1 vial", "HB-8065"],
    ["Jurkat, Clone E6-1", "TIB-152"], ["RAW 264.7 macrophages", "TIB-71"], ["HEK 293T cells", "CRL-3216"], ["U-87 MG cells", "HTB-14"],
    ["3T3-L1 preadipocytes", "CL-173"], ["Human SH-SY5Y neuroblastoma cell line", "CRL-2266"],
  ] as const) {
    assertEquals(plainCellLineIn(name)?.atcc, atcc, name);
  }
  // HeLa S3's real number has a decimal: it is neither "corrected" to HeLa's nor removed for its format.
  const s3 = checkCatalogNumbers([{ name: "HeLa S3 cells", supplier: "ATCC", catalog_number: "CCL-2.2" }]);
  assertEquals([s3.removed.length, s3.corrected.length, s3.materials[0].catalog_number], [0, 0, "CCL-2.2"]);
  // A cell line bought elsewhere with that supplier's own number is not touched.
  const ecacc = checkCatalogNumbers([{ name: "Caco-2 cells", supplier: "ECACC", catalog_number: "86010202" }]);
  assertEquals([ecacc.corrected.length, ecacc.materials[0].catalog_number, ecacc.materials[0].catalog_status], [0, "86010202", "unverified"]);
});

Deno.test("catalog: odd inputs do not throw (numbers as numbers, empty and missing fields)", () => {
  const odd = [
    { name: "DMEM, high glucose", supplier: "Thermo Fisher", catalog_number: 11965092 as unknown as string },
    { name: "", supplier: "", catalog_number: "   " },
    { supplier: "Sigma-Aldrich", catalog_number: "N/A" },
    {} as { name?: string },
  ];
  const r = checkCatalogNumbers(odd);
  assertEquals(r.materials[0].catalog_status, "verified");
  assertEquals(r.materials.slice(1).map((m) => m.catalog_status), [undefined, undefined, undefined]);
  assertEquals(verifyPlan({ materials: "not a list", protocol: null, budget: 5 }, { hypothesis: "", references: [] }).verification.issues, []);
});

// --- cell lines and reagents ------------------------------------------------------------------

Deno.test("cell lines: names are read with their descriptors; look-alikes are not cell lines", () => {
  assertEquals(hypothesisCellLines("MCF-7 breast cancer cells treated with 1 uM tamoxifen"), ["MCF-7"]);
  assertEquals(hypothesisCellLines("In MDA-MB-231 cells and 3T3-L1 adipocytes"), ["MDA-MB-231", "3T3-L1"]);
  assertEquals(hypothesisCellLines("LPS-stimulated RAW 264.7 macrophages release more TNF"), ["RAW 264.7"]);
  assertEquals(hypothesisCellLines("Lipid accumulation in Hep G2 cells and in HEK 293 cells"), ["Hep G2", "HEK 293"]);
  for (const text of ["Culture as 3D spheroids", "H2O2-treated cells die faster", "Cells arrested in G1 cells cycle", "CD4 T cells proliferate", "after 24 h cells were lysed", "passage P3 cells"]) {
    assertEquals(hypothesisCellLines(text), [], text);
  }
  // Typed in capitals (QA run 7c539b00): only names the ATCC list knows, since case cannot tell.
  assertEquals(hypothesisCellLines(METFORMIN.toUpperCase()), ["HEPG2"]);
  assertEquals(hypothesisCellLines("AFTER 24 H CELLS WERE LYSED AND H2O2-TREATED CELLS COUNTED"), []);
  const r3 = steps("Seed 10,000 HepG2 cells per well in DMEM.", "Add 10 uM metformin and 0.5 mM palmitate. Stain with Oil Red O.");
  assertEquals(missingMaterials(METFORMIN.toUpperCase(), r3, [{ name: "Metformin" }, { name: "Palmitate" }, { name: "Oil Red O" }, { name: "DMEM" }]).required, ["HEPG2"]);
});

Deno.test("findings name the compound as the hypothesis writes it", () => {
  const NR = "Supplementing SH-SY5Y neuroblastoma cells with 500 µM nicotinamide riboside for 72 hours will increase intracellular NAD+ levels by at least 30%.";
  assertEquals(doseIssues(NR, steps("Treat the cells with 5 mM nicotinamide riboside for 72 hours."))[0]?.label, "nicotinamide riboside");
  assertEquals(doseIssues(BUTYRATE, steps("Treat the monolayers with 20 mM sodium butyrate."))[0]?.label, "sodium butyrate");
  assertEquals(missingMaterials(BUTYRATE, steps("Treat Caco-2 monolayers with 2 mM butyrate."), [{ name: "Caco-2 cells" }]).required, ["sodium butyrate"]);
  assertEquals(doseIssues(METFORMIN, steps("Treat the cells with 10 mM metformin."))[0]?.label, undefined, "one word needs no label");
});

Deno.test("materials: another spelling of the cell line or a spelled-out reagent is not 'missing'", () => {
  const protocol = steps("Seed HepG2 cells in DMEM with 10% FBS. Wash twice with PBS. Treat with 10 µM metformin and 0.5 mM palmitate. Stain with Oil Red O.");
  const materials = [
    { name: "Hep G2 cell line (ATCC HB-8065)" }, { name: "Dulbecco's Modified Eagle Medium" }, { name: "Fetal calf serum" },
    { name: "Phosphate-buffered saline" }, { name: "Metformin hydrochloride" }, { name: "Sodium palmitate" }, { name: "Oil Red O" },
  ];
  assertEquals(missingMaterials(METFORMIN, protocol, materials), { required: [], other: [] });
  // Leaving the cells out is still found, whatever the spelling in the protocol.
  assertEquals(missingMaterials(METFORMIN, protocol, materials.slice(1)).required, ["HepG2"]);
  // A lysis buffer's recipe asks for the buffer, not for Tris and EDTA.
  const lysis = steps("Lyse the cells in RIPA buffer (10 mM Tris-HCl, 1 mM EDTA, 150 mM NaCl).");
  assertEquals(missingMaterials(METFORMIN, lysis, [{ name: "HepG2 cells" }]).other, ["RIPA buffer"]);
});

// --- limits ---------------------------------------------------------------------------------------

Deno.test("refinement limits: a change to one part of the plan is not a cap on the whole", () => {
  for (const text of [
    "Extend the butyrate treatment to 2 weeks.",
    "Shorten the staining to 2 days.",
    "Increase the differentiation period to 21 days.",
    "Extend the timeline to 12 weeks so the cells can differentiate.",
    "Run the study for at least 8 weeks.",
  ]) {
    assertEquals(parseRefinementConstraints(text).max_timeline_weeks, undefined, text);
  }
  assertEquals(parseRefinementConstraints("Shorten the overall timeline to 2 weeks.").max_timeline_weeks, 2);
  assertEquals(parseRefinementConstraints("Finish within 2 months.").max_timeline_weeks, 8.69);
  assertEquals(parseRefinementConstraints("Use a 3 day treatment and fit everything into 4 weeks.").max_timeline_weeks, 4);
  assertEquals(parseRefinementConstraints("Reduce the incubation to 24 h and the whole study to 3 weeks.").max_timeline_weeks, 3);
});

Deno.test("refinement limits: only an amount of money is a budget cap", () => {
  for (const text of [
    "Keep the budget, but raise n to 12 per group.",
    "Keep the budget the same and increase the seeding density to 10000 cells per well.",
    "Do not change the cost; extend the treatment to 96 hours.",
    "Lower the dose to 500 nM without raising the budget.",
  ]) {
    assertEquals(parseRefinementConstraints(text).max_budget_usd, undefined, text);
  }
  assertEquals(parseRefinementConstraints("Keep the total budget under $3,000.").max_budget_usd, 3000);
  assertEquals(parseRefinementConstraints("Reduce the budget to 2500.").max_budget_usd, 2500);
  assertEquals(parseRefinementConstraints("Keep costs under 3k.").max_budget_usd, 3000);
  assertEquals(parseRefinementConstraints("At most 4000 USD in total.").max_budget_usd, 4000);
  assertEquals(parseRefinementConstraints("Cut the budget by 30%.", 10000).max_budget_usd, 7000);
});

Deno.test("refinement limits: a limit holds for later refinements of the chain until one replaces it or gives it up", () => {
  // v2 "Keep the total budget under $3,000." was checked and stored its limit.
  const v2 = verifyPlan({ budget: { line_items: [{ category: "Labour", amount_usd: 2900 }], total_usd: 2900 }, timeline: [{ duration: "6 weeks" }] }, {
    hypothesis: METFORMIN, references: [], refinementInstruction: "Keep the total budget under $3,000.", fresh: true,
  }).plan;
  assertEquals(v2.verification?.refinement, { max_budget_usd: 3000 });

  // v3 asks only for a shorter timeline: the budget limit still holds.
  assertEquals(effectiveConstraints("Shorten the overall timeline to 2 weeks.", v2), { max_timeline_weeks: 2, max_budget_usd: 3000, inherited: ["budget"] });
  const over = { budget: { line_items: [{ category: "Labour", amount_usd: 9000 }], total_usd: 9000 }, timeline: [{ duration: "2 weeks" }] };
  const v3 = verifyPlan(over, { hypothesis: METFORMIN, references: [], refinementInstruction: "Shorten the overall timeline to 2 weeks.", parentPlan: v2, fresh: true });
  const finding = v3.verification.issues.find((i) => i.kind === "refinement_budget_not_met");
  assertEquals(finding?.detail, "An earlier refinement of this plan asked for a budget of at most $3,000; this plan totals $9,000 (Labour $9,000), $6,000 over.");
  assertEquals(v3.verification.issues.some((i) => i.kind === "refinement_timeline_not_met"), false);
  assert(refinementConstraintPrompt(effectiveConstraints("Shorten the overall timeline to 2 weeks.", v2)).includes("at most 3000 USD (a limit from an earlier refinement that still holds)"));

  // v4, refined from v3, still carries both.
  assertEquals(effectiveConstraints("Use 96-well plates.", v3.plan), { max_budget_usd: 3000, max_timeline_weeks: 2, inherited: ["budget", "timeline"] });

  // A new number replaces the old one; giving the limit up ends it; a negated verb does not.
  assertEquals(effectiveConstraints("Raise the budget cap to $5,000.", v2).max_budget_usd, 5000);
  for (const text of ["Ignore the budget and add a second cell line.", "Increase the budget; add RNA-seq.", "The budget no longer matters, add a positive control.", "There is no budget limit any more."]) {
    assertEquals(effectiveConstraints(text, v2).max_budget_usd, undefined, text);
  }
  for (const text of ["Add a positive control without raising the budget.", "Do not increase the budget; add a positive control.", "Add a vehicle control."]) {
    assertEquals(effectiveConstraints(text, v2).max_budget_usd, 3000, text);
  }
  assertEquals(effectiveConstraints("Extend the timeline to 12 weeks.", v3.plan).max_timeline_weeks, undefined);
  assertEquals(effectiveConstraints("Take as long as needed, but add a replicate.", v3.plan).max_timeline_weeks, undefined);
  // Not a refinement: nothing is inherited, whatever the plan carries.
  assertEquals(effectiveConstraints(null, v2), {});
  assertEquals(effectiveConstraints("Add a vehicle control.", { verification: { refinement: { max_budget_usd: "3000", max_timeline_weeks: -1 } } }), {});
});

Deno.test("budget cap in the hypothesis: explicit budget wording only", () => {
  assertEquals(hypothesisBudgetCap("On a $5,000 budget, 10 µM metformin will lower lipid."), 5000);
  assertEquals(hypothesisBudgetCap("With a total budget of at most $2.5k the screen finds 3 hits."), 2500);
  assertEquals(hypothesisBudgetCap("A $5 paper test detects CRP as well as a $300 ELISA kit."), undefined);
  assertEquals(hypothesisBudgetCap("Treatment costs under $20 per patient in total."), undefined);
});

// --- the first end-to-end run on the 7B model (42c080d0, 10 Nov 2026) ------------------------------

// The plan as the model wrote it (the stored row holds the corrected copy).
const RUN_42C = {
  protocol: [
    { step: 1, title: "Cell Culture", duration: "2 weeks", description: "Culture Caco-2 cells (ATCC HTB-37) in DMEM supplemented with 10% FBS and 1% penicillin/streptomycin.", source: "manufacturer's instructions" },
    { step: 2, title: "Differentiation", duration: "21 days", description: "Differentiate cells to form a monolayer using Caco-2 differentiation medium (Lonza) for 21 days.", source: "manufacturer's instructions" },
    { step: 3, title: "Baseline TEER Measurement", duration: "1 hour", description: "Measure TEER using an epithelial voltohmmeter (Millicell-ERS, Merck) in untreated monolayers.", source: "manufacturer's instructions" },
    { step: 4, title: "Treatment", duration: "72 hours", description: "Incubate differentiated monolayers with 2 mM sodium butyrate (Sigma-Aldrich, S8978) in serum-free medium for 72 hours.", source: "manufacturer's instructions" },
    { step: 5, title: "Post-Treatment TEER Measurement", duration: "1 hour", description: "Measure TEER in treated monolayers using the same voltohmmeter.", source: "manufacturer's instructions" },
  ],
  materials: [
    { name: "Caco-2 cells (ATCC HTB-37)", supplier: "ATCC", quantity: "1 vial", total_cost_usd: 120 },
    { name: "DMEM", supplier: "Sigma-Aldrich", quantity: "500 mL", total_cost_usd: 25 },
    { name: "10% FBS", supplier: "Sigma-Aldrich", quantity: "50 mL", total_cost_usd: 20 },
    { name: "1% Penicillin/Streptomycin", supplier: "Thermo Fisher", quantity: "100 mL", total_cost_usd: 15 },
    { name: "Sodium Butyrate", supplier: "Sigma-Aldrich", quantity: "5 g", total_cost_usd: 10 },
  ],
  budget: {
    currency: "USD",
    line_items: [
      { category: "Materials", amount_usd: 120, note: "Caco-2 cells" }, { category: "Materials", amount_usd: 25, note: "DMEM" },
      { category: "Materials", amount_usd: 20, note: "10% FBS" }, { category: "Materials", amount_usd: 15, note: "1% Penicillin/Streptomycin" },
      { category: "Materials", amount_usd: 10, note: "Sodium Butyrate" },
    ],
    total_usd: 90,
  },
  timeline: [{ phase: "Cell Culture", duration: "2 weeks" }, { phase: "Baseline TEER Measurement", duration: "1 hour" }, { phase: "Treatment", duration: "72 hours" }, { phase: "Post-Treatment TEER Measurement", duration: "1 hour" }],
  team: [{ role: "Principal Investigator", fte: 1 }, { role: "Research Associate", fte: 0.5 }],
};

Deno.test("budget: several materials lines are compared with the table together, not one by one", () => {
  // Five "Materials" lines that add up to the table: nothing to raise, and the total is their sum.
  const same = reconcileMaterialsLine(RUN_42C.budget, RUN_42C.materials);
  assertEquals(same.change, null);
  const v = verifyPlan(RUN_42C, { hypothesis: BUTYRATE, references: [], fresh: true });
  assertEquals(v.plan.budget?.total_usd, 190, "the first version raised the first line to $190 and summed $260");
  assertEquals(kinds(v.verification).includes("materials_line_corrected"), false);
  // Short by $65: the first line makes up the difference, once.
  const short = reconcileMaterialsLine({ line_items: [{ category: "Materials", amount_usd: 100 }, { category: "Reagents", amount_usd: 25 }, { category: "Labour", amount_usd: 900 }], total_usd: 1025 }, RUN_42C.materials);
  assertEquals(short.change, { category: "Materials", stated: 125, table: 190 });
  assertEquals(short.budget.line_items?.map((li) => li.amount_usd), [165, 25, 900]);
  // One line, as before.
  assertEquals(reconcileMaterialsLine({ line_items: [{ category: "Materials", amount_usd: 100 }] }, RUN_42C.materials).budget.line_items?.[0].amount_usd, 190);
});

Deno.test("budget: a budget of materials only is flagged for a second attempt; one with labour is not", () => {
  const v = verifyPlan(RUN_42C, { hypothesis: BUTYRATE, references: [], fresh: true }).verification;
  const f = v.issues.find((i) => i.kind === "budget_materials_only");
  assertEquals(f?.severity, "high");
  assertEquals(f?.detail, "The budget lists materials only ($190): no labour, equipment or overhead, although the plan names a team of 2 (1.5 FTE).");
  assert(repairableIssues(v).some((i) => i.kind === "budget_materials_only"));
  const withLabour = { ...RUN_42C, budget: { ...RUN_42C.budget, line_items: [...RUN_42C.budget.line_items, { category: "Labour", amount_usd: 5500 }] } };
  assertEquals(kinds(verifyPlan(withLabour, { hypothesis: BUTYRATE, references: [], fresh: true }).verification).includes("budget_materials_only"), false);
  // No budget, or one without a materials line: not this finding.
  assertEquals(kinds(verifyPlan({ budget: { line_items: [{ category: "Labour", amount_usd: 100 }], total_usd: 100 } }, { hypothesis: BUTYRATE, references: [] }).verification).includes("budget_materials_only"), false);
});

Deno.test("catalog numbers written into protocol steps are taken out unless the materials table confirmed them", () => {
  const v = verifyPlan(RUN_42C, { hypothesis: BUTYRATE, references: [], fresh: true });
  assertEquals(v.plan.protocol?.[3].description, "Incubate differentiated monolayers with 2 mM sodium butyrate (Sigma-Aldrich) in serum-free medium for 72 hours.");
  assertEquals(v.plan.protocol?.[0].description, RUN_42C.protocol[0].description, "HTB-37 is the number the table verified for Caco-2");
  assertEquals(v.plan.protocol?.[2].description, RUN_42C.protocol[2].description, "a product name is not a catalog number");
  const note = v.verification.issues.find((i) => i.kind === "catalog_numbers_removed");
  assertEquals(note?.detail, "1 catalog number(s) written into protocol steps were taken out of the text (S8978 in step 4): only numbers in the materials table are checked against a catalogue.");

  const strip = (text: string, verified: string[] = []) => stripStepCatalogNumbers([{ description: text }], verified);
  for (const [text, cleaned, numbers] of [
    ["Stain with Oil Red O (Sigma O0625) for 15 min.", "Stain with Oil Red O (Sigma) for 15 min.", ["O0625"]],
    ["Use DMEM (Gibco 11965092) with 10% FBS (Thermo Fisher, cat. no. A3160401).", "Use DMEM (Gibco) with 10% FBS (Thermo Fisher).", ["11965092", "A3160401"]],
    ["Seed on Transwell inserts (Corning, cat. no. 3470).", "Seed on Transwell inserts (Corning).", ["3470"]],
    ["Add CellTiter-Glo reagent (cat. no. G7570) to each well.", "Add CellTiter-Glo reagent to each well.", ["G7570"]],
    ["Add 100 µL of Promega G7570 reagent.", "Add 100 µL of Promega reagent.", ["G7570"]],
  ] as const) {
    const r = strip(text);
    assertEquals(r.steps[0].description, cleaned, text);
    assertEquals(r.removed.map((x) => x.catalog_number).sort(), [...numbers].sort(), text);
  }
  // Quantities, sizes, names and model numbers after a supplier are not catalog numbers.
  for (const text of [
    "Seed Thermo Fisher 10000 cells per well in Corning 96-well plates.",
    "Add Sigma 10 mM stock and Merck 2 mM buffer; spin at 12000 rpm.",
    "Measure TEER with a Millicell-ERS (Merck) voltohmmeter.",
    "Read on a BioTek Synergy H1 plate reader at 450 nm.",
    "Lyse 50000 cells in 100 µL RIPA buffer.",
    "Incubate for 24 h at 37°C with 5% CO2.",
  ]) {
    const r = strip(text);
    assertEquals([r.steps[0].description, r.removed.length], [text, 0], text);
  }
  // A number the table verified stays; the same step keeps its other fields.
  const kept = stripStepCatalogNumbers([{ title: "T", description: "Dissolve sodium butyrate (Sigma-Aldrich, B5887).", duration: "1 h" }], ["b5887"]);
  assertEquals(kept, { steps: [{ title: "T", description: "Dissolve sodium butyrate (Sigma-Aldrich, B5887).", duration: "1 h" }], removed: [] });
  assertEquals(stripStepCatalogNumbers(undefined), { steps: [], removed: [] });
  // A cached copy: the text is already clean, and the note from the first pass is kept.
  const again = verifyPlan(v.plan, { hypothesis: BUTYRATE, references: [] });
  assertEquals(again.plan.protocol?.[3].description, v.plan.protocol?.[3].description);
  assertEquals(again.verification.issues.find((i) => i.kind === "catalog_numbers_removed")?.detail, note?.detail);
});

// --- critique -----------------------------------------------------------------------------------

Deno.test("critique: a remark about a price is kept; a false claim about the total is dropped", () => {
  assertEquals(claimedBudgetAbove("Under-budgeted: an EVOM2 voltohmmeter alone costs over $3,000."), null);
  assertEquals(claimedBudgetAbove("The total budget exceeds $20,000 for a cell study."), 20000);
  assertEquals(claimedBudgetAbove("Total cost is above $15k."), 15000);
  const c = cleanCritique({
    concerns: [
      { severity: "high", area: "budget", issue: "Under-budgeted: an EVOM2 voltohmmeter alone costs over $3,000.", suggestion: "Raise the equipment line." },
      { severity: "high", area: "budget", issue: "The budget exceeds $20,000.", suggestion: "Trim." },
    ],
  }, { plan: { budget: { total_usd: 2800 } } });
  assertEquals(c?.concerns?.map((x) => x.issue), ["Under-budgeted: an EVOM2 voltohmmeter alone costs over $3,000."]);
});
