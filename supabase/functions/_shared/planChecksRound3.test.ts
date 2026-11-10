// Checks added for QA round 3 (10 Nov 2026), built from the QA's own runs
// with the default local model: R1 7a01520f (metformin), its refinements v2
// 40c0b182 ("Keep the total budget under $3,000.") and v3 69a412a9 ("Shorten
// the overall timeline to 2 weeks."), the independent repeat R3 7c539b00,
// R2 92185b64 (sodium butyrate / Caco-2) and the fresh NMN run b4d82571.
// Run: deno test --allow-net --allow-env --allow-read --no-lock supabase/functions/_shared/
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hypothesisBudgetCap, verifyPlan } from "./planGuards.ts";
import {
  checkCatalogNumbers, compartmentMismatch, dilutionIssues, doseIssues, hypothesisCellLines, hypothesisDoses,
  hypothesisReadout, missingMaterials, readoutMissing, stepDurationIssues,
} from "./planContentChecks.ts";
import { cellLineIn, looksLikePlaceholder } from "./catalogCheck.ts";
import { parseDurationToHours } from "./timelineCheck.ts";
import { lookupMaterialsLive } from "./skuVerify.ts";
import { claimedMissingControls, cleanCritique } from "./critiqueGuards.ts";
import { cosine, filterByEmbedding } from "./embeddingRelevance.ts";
import { calibrateNovelty } from "./noveltyVerdict.ts";
import { hypothesisConcepts } from "./hypothesisTerms.ts";
import { loadChain, nextVersion } from "./versionChain.ts";
import { hypothesisCacheKey, madeByOlderPipeline, PIPELINE_VERSION } from "./pipelineVersion.ts";
import { rankFeedbackRows } from "./feedbackRetrieval.ts";

const METFORMIN = "Treating HepG2 hepatocytes with 10 µM metformin for 24 h before a 0.5 mM palmitate challenge will reduce intracellular lipid accumulation, measured by Oil Red O staining, by at least 30% compared with vehicle-treated palmitate controls.";
const BUTYRATE = "Treating differentiated Caco-2 monolayers with 2 mM sodium butyrate for 72 hours will increase transepithelial electrical resistance (TEER) by at least 25% compared with untreated monolayers, measured with an epithelial voltohmmeter.";
const NMN = "Treating SH-SY5Y neuroblastoma cells with 1 mM nicotinamide mononucleotide (NMN) for 24 hours will raise intracellular NAD+ levels by at least 40% compared with vehicle-treated cells, measured with a luminescent NAD/NADH assay, in a fresh batch.";

const kinds = (v: { issues: { kind: string }[] }) => v.issues.map((i) => i.kind);
const issue = (v: { issues: { kind: string; detail: string; severity: string }[] }, k: string) => v.issues.find((i) => i.kind === k);

// The QA's plans, as stored.
const R1_MATERIALS = [
  { name: "Metformin stock solution (10 mM)", supplier: "Sigma-Aldrich", quantity: "100 mL", unit_cost_usd: 120, total_cost_usd: 120 },
  { name: "HepG2 cells (ATCC)", supplier: "ATCC", quantity: "1 vial", unit_cost_usd: 580, total_cost_usd: 580 },
  { name: "DMEM (500 mL)", supplier: "Thermo Fisher", quantity: "1 case", unit_cost_usd: 35, total_cost_usd: 35 },
  { name: "FBS (qualified, 500 mL)", supplier: "Thermo Fisher", quantity: "1 case", unit_cost_usd: 480, total_cost_usd: 480 },
  { name: "Pen/Strep (100x, 100 mL)", supplier: "Thermo Fisher", quantity: "1 case", unit_cost_usd: 50, total_cost_usd: 50 },
];
const R1_PROTOCOL = [
  { step: 1, title: "Cell Culture Setup", duration: "24 h", description: "Set up HepG2 cells in T75 flasks with DMEM, FBS, Pen/Strep, and PBS. Incubate at 37°C, 5% CO2 for 24 h." },
  { step: 2, title: "Metformin Treatment", duration: "24 h", description: "Add metformin stock solution (10 mM) to cell culture media. Incubate for 24 h." },
  { step: 3, title: "Palmitate Challenge", duration: "24 h", description: "Add 0.5 mM palmitate to media. Incubate for 24 h." },
  { step: 4, title: "Oil Red O Staining", duration: "15 min", description: "Prepare Oil Red O solution. Incubate cells with Oil Red O stain for 15 min. Wash cells with PBS. Measure absorbance at 510 nm." },
  { step: 5, title: "Vehicle Controls", duration: "24 h", description: "Set up parallel HepG2 cells in T75 flasks with media only. Incubate for 24 h. Add 0.5 mM palmitate. Incubate for 24 h. Perform Oil Red O staining." },
];
const V3_PROTOCOL = [
  { step: 1, title: "Cell Culture Setup", duration: "2 weeks", description: "Set up HepG2 cells in DMEM with FBS, Pen/Strep, and antibiotics. Incubate at 37°C, 5% CO2 for 24 h." },
  { step: 2, title: "Metformin Treatment", duration: "2 weeks", description: "Prepare metformin stock solution (10 mM). Treat HepG2 cells with 10 µM metformin for 24 h." },
  { step: 3, title: "Palmitate Challenge", duration: "2 weeks", description: "Add 0.5 mM palmitate to metformin-treated cells. Incubate for 24 h." },
  { step: 4, title: "Vehicle Controls", duration: "2 weeks", description: "Add 0.5 mM palmitate to untreated cells. Incubate for 24 h." },
  { step: 5, title: "Oil Red O Staining", duration: "2 weeks", description: "Stain cells with Oil Red O stain. Measure lipid accumulation by absorbance at 510 nm." },
];
const R3_PROTOCOL = [
  { step: 1, title: "Prepare Metformin Stock Solution", duration: "10 minutes", description: "Dissolve 100 mg metformin in 10 mL DMSO to make a 10 mM stock solution." },
  { step: 2, title: "Prepare Palmitate Stock Solution", duration: "10 minutes", description: "Dissolve 100 mg palmitate in 10 mL DMSO to make a 1 mM stock solution." },
  { step: 3, title: "Cell Culture Setup", duration: "24 hours", description: "In a biosafety cabinet, seed 10,000 HepG2 cells per well in a 96-well plate in DMEM with 10% FBS. Incubate at 37°C, 5% CO2 for 24 hours." },
  { step: 4, title: "Metformin Treatment", duration: "24 hours", description: "Add 10 μL of the 10 mM metformin stock to 990 μL of DMEM to make a 10 μM working solution. Add 10 μL of the 10 μM metformin solution to each well of the 96-well plate. Incubate for 24 hours." },
  { step: 5, title: "Palmitate Challenge", duration: "24 hours", description: "Add 10 μL of the 1 mM palmitate stock to 990 μL of DMEM to make a 1 μM working solution. Add 10 μL of the 1 μM palmitate solution to each well of the 96-well plate. Incubate for 24 hours." },
];
const R3_MATERIALS = [
  { name: "Metformin (10 mM stock)", supplier: "Sigma-Aldrich", total_cost_usd: 100 },
  { name: "Palmitate (1 mM stock)", supplier: "Sigma-Aldrich", total_cost_usd: 100 },
  { name: "DMEM", supplier: "Thermo Fisher", total_cost_usd: 35 },
  { name: "FBS", supplier: "Thermo Fisher", total_cost_usd: 480 },
  { name: "PBS", supplier: "Thermo Fisher", total_cost_usd: 28 },
];
const NMN_PROTOCOL = [
  { step: 1, title: "Prepare SH-SY5Y cells", duration: "24 hours", description: "Grow SH-SY5Y cells in DMEM with 10% FBS, 1% Pen/Strep, and 1x PBS. Incubate at 37°C, 5% CO2." },
  { step: 2, title: "Prepare NMN stock solution", duration: "1 day", description: "Dissolve 100 mg NMN in 10 mL DMSO to make a 10 mM stock solution. Store at -20°C." },
  { step: 3, title: "Add NMN to cells", duration: "24 hours", description: "Add 100 μL of 10 mM NMN stock to 10 mL cell culture media. Incubate for 24 hours." },
  { step: 4, title: "Prepare NAD/NADH assay", duration: "1 day", description: "Prepare NAD/NADH assay buffer with 50 mM Tris-HCl, 100 mM NaCl, 10 mM EDTA, 10 mM MgCl2, and 10% glycerol. Add 100 μL of 10 mM NMN stock to 1 mL assay buffer. Store at 4°C." },
  { step: 5, title: "Measure NAD+ levels", duration: "30 minutes", description: "Add 100 μL of NAD/NADH assay to 1 mL cell culture supernatant. Measure luminescence at 460 nm using a plate reader." },
];
const NMN_MATERIALS = [
  { name: "SH-SY5Y cells", supplier: "ATCC", total_cost_usd: 0 },
  { name: "Nicotinamide mononucleotide (NMN)", supplier: "Sigma-Aldrich", total_cost_usd: 150 },
  { name: "DMEM", supplier: "Thermo Fisher", total_cost_usd: 35 },
  { name: "FBS", supplier: "Thermo Fisher", total_cost_usd: 48 },
  { name: "Pen/Strep", supplier: "Thermo Fisher", total_cost_usd: 5 },
];
const R2_MATERIALS = [
  { name: "Caco-2 cells", supplier: "ATCC", catalog_number: "CCL-22", total_cost_usd: 100 },
  { name: "2 mM sodium butyrate stock solution", supplier: "Sigma-Aldrich", catalog_number: "S1000", total_cost_usd: 200 },
  { name: "96-well plates", supplier: "Thermo Fisher", catalog_number: "A1000", total_cost_usd: 320 },
  { name: "Pipette tips, filtered, racked", supplier: "Thermo Fisher", catalog_number: "T1000", total_cost_usd: 240 },
  { name: "Epithelial voltohmmeter", supplier: "Thermo Fisher", catalog_number: "E1000", total_cost_usd: 280 },
];

// --- (c) doses in any case, with the Greek mu, and through dilutions -----------------

Deno.test("doses: units in any case and every micro sign are read (MM, ΜM, μM, µM)", () => {
  assertEquals(hypothesisDoses(METFORMIN.toUpperCase()).map((d) => [d.substance, d.text]), [["metformin", "10 uM"], ["palmitate", "0.5 mM"]]);
  for (const text of ["Add 1 ΜM palmitate to the cells.", "Add 1 μM palmitate to the cells.", "Add 1 µM palmitate to the cells.", "ADD 1 UM PALMITATE TO THE CELLS."]) {
    assertEquals(doseIssues(METFORMIN, [{ description: text }]).map((i) => i.plan), [["1 uM"]], text);
  }
  assertEquals(doseIssues(METFORMIN, [{ description: "Add 0.5 MM palmitate to the cells." }]), []);
  assertEquals(hypothesisDoses(BUTYRATE).map((d) => d.substance), ["butyrate"], "the counter-ion is not the substance");
});

Deno.test("doses: R3 7c539b00 doses palmitate at 1 uM for a 0.5 mM hypothesis and is flagged; its dilutions are wrong too", () => {
  const issues = doseIssues(METFORMIN, R3_PROTOCOL);
  assertEquals(issues.length, 1);
  assertEquals(issues[0].substance, "palmitate");
  assert(issues[0].plan.includes("1 uM"), issues[0].plan.join());
  assertEquals(dilutionIssues(R3_PROTOCOL).map((d) => [d.step, d.computed, d.stated]), [[4, "100 uM", "10 uM"], [5, "10 uM", "1 uM"]]);
});

Deno.test("doses: NMN b4d82571, 100 uL of a 10 mM stock into 10 mL is about 99 uM, not the hypothesis' 1 mM", () => {
  const issues = doseIssues(NMN, NMN_PROTOCOL);
  assertEquals(issues.length, 1, "the assay-buffer step (about 0.9 mM) does not count as the treatment dose");
  assertEquals(issues[0].label, "nicotinamide mononucleotide (NMN)");
  assertEquals(issues[0].plan, ["about 99 uM (100 uL of 10 mM into 10 mL)"]);
  const v = verifyPlan({ protocol: NMN_PROTOCOL, materials: NMN_MATERIALS }, { hypothesis: NMN, references: [] }).verification;
  assertEquals(issue(v, "dose_changed")?.detail, "The hypothesis tests nicotinamide mononucleotide (NMN) at 1 mM; the protocol uses about 99 uM (100 uL of 10 mM into 10 mL).");
});

Deno.test("doses: a correct dilution and the hypothesis dose pass", () => {
  const ok = [{ description: "Add 10 uL of the 10 mM metformin stock to 9.99 mL of DMEM for a final concentration of 10 uM. Add 0.5 mM palmitate to the cells." }];
  assertEquals(doseIssues(METFORMIN, ok), []);
  assertEquals(dilutionIssues(ok), []);
  assertEquals(doseIssues(NMN, [{ description: "Add 1 mL of 10 mM NMN stock to 9 mL of medium (1 mM final) and incubate the cells for 24 hours." }]), []);
});

// --- readout, missing materials, compartment ---------------------------------------------------

Deno.test("readout: the hypothesis' measurement is read; R3 has no Oil Red O step and is flagged", () => {
  assertEquals(hypothesisReadout(METFORMIN)?.terms, ["oil", "red"]);
  assertEquals(hypothesisReadout(BUTYRATE)?.phrase, "epithelial voltohmmeter");
  assertEquals(hypothesisReadout(NMN)?.reagent, true);
  assertEquals(readoutMissing(METFORMIN, R3_PROTOCOL)?.phrase, "Oil Red O staining");
  assertEquals(readoutMissing(METFORMIN, R1_PROTOCOL), null);
  // The measured quantity's acronym in a measuring step counts ("Measure TEER" with another instrument name).
  assertEquals(readoutMissing(BUTYRATE, [{ description: "Measure TEER with an EVOM2 meter before and after treatment." }]), null);
  assertEquals(readoutMissing(BUTYRATE, [{ description: "Treat the monolayers with 2 mM sodium butyrate for 72 hours." }])?.phrase, "epithelial voltohmmeter");
  const v = verifyPlan({ protocol: R3_PROTOCOL, materials: R3_MATERIALS }, { hypothesis: METFORMIN, references: [] }).verification;
  assertEquals(issue(v, "readout_missing")?.severity, "high");
});

Deno.test("materials: R1 uses palmitate and Oil Red O without listing them; R3 never lists HepG2", () => {
  assertEquals(hypothesisCellLines(METFORMIN), ["HepG2"]);
  assertEquals(hypothesisCellLines(BUTYRATE), ["Caco-2"]);
  assertEquals(hypothesisCellLines(NMN), ["SH-SY5Y"]);
  assertEquals(missingMaterials(METFORMIN, R1_PROTOCOL, R1_MATERIALS), { required: ["palmitate", "Oil Red O staining"], other: ["PBS"] });
  assertEquals(missingMaterials(METFORMIN, R3_PROTOCOL, R3_MATERIALS).required, ["HepG2"]);
  assertEquals(missingMaterials(NMN, NMN_PROTOCOL, NMN_MATERIALS).required, ["luminescent NAD/NADH assay"]);
  const v = verifyPlan({ protocol: R1_PROTOCOL, materials: R1_MATERIALS }, { hypothesis: METFORMIN, references: [] }).verification;
  assertEquals(issue(v, "materials_missing")?.severity, "high");
  assert(issue(v, "materials_missing")?.detail.includes("palmitate, Oil Red O staining"));
});

Deno.test("materials: a plan that lists what its protocol uses passes", () => {
  const materials = [...R1_MATERIALS, { name: "Sodium palmitate", supplier: "Sigma-Aldrich", total_cost_usd: 90 },
    { name: "Oil Red O", supplier: "Sigma-Aldrich", total_cost_usd: 60 }, { name: "PBS", supplier: "Thermo Fisher", total_cost_usd: 28 }];
  assertEquals(missingMaterials(METFORMIN, R1_PROTOCOL, materials), { required: [], other: [] });
  const v = verifyPlan({ protocol: R1_PROTOCOL, materials }, { hypothesis: METFORMIN, references: [] }).verification;
  assertEquals(v.issues.filter((i) => i.severity === "high"), [], JSON.stringify(v.issues));
});

Deno.test("compartment: NMN measures NAD+ in the supernatant for an intracellular hypothesis", () => {
  assert(compartmentMismatch(NMN, NMN_PROTOCOL));
  const lysed = [...NMN_PROTOCOL.slice(0, 4), { description: "Lyse the cells in extraction buffer and measure NAD+ in the lysate." }];
  assertEquals(compartmentMismatch(NMN, lysed), null);
  assertEquals(compartmentMismatch(BUTYRATE, NMN_PROTOCOL), null, "no intracellular claim");
});

// --- durations, budget caps ------------------------------------------------------------------

Deno.test("durations: v3 69a412a9 gives 24-hour steps a duration of 2 weeks each", () => {
  const r = stepDurationIssues(V3_PROTOCOL, parseDurationToHours);
  assertEquals(r?.steps, [1, 2, 3, 4]);
  assertEquals(stepDurationIssues(R1_PROTOCOL, parseDurationToHours), null);
  const v = verifyPlan({ protocol: V3_PROTOCOL, timeline: [{ duration: "1 week" }, { duration: "1 week" }] }, {
    hypothesis: METFORMIN, references: [], refinementInstruction: "Shorten the overall timeline to 2 weeks.",
  }).verification;
  assert(kinds(v).includes("step_durations_inconsistent"));
  const t = issue(v, "refinement_timeline_not_met");
  assertEquals(t?.severity, "high", "the phases fit 2 weeks, the steps add up to 10");
  assert(t?.detail.includes("10 weeks"), t?.detail);
});

Deno.test("budget: v2 40c0b182's $4,030 against the $3,000 refinement cap names the line items and the excess", () => {
  const budget = { line_items: [{ category: "Materials", amount_usd: 2030 }, { category: "Labour", amount_usd: 1000 }, { category: "Overhead", amount_usd: 1000 }], total_usd: 4030 };
  const v = verifyPlan({ budget }, { hypothesis: METFORMIN, references: [], refinementInstruction: "Keep the total budget under $3,000." }).verification;
  assertEquals(issue(v, "refinement_budget_not_met")?.detail,
    "The refinement asked for a budget of at most $3,000; this plan totals $4,030 (Materials $2,030, Labour $1,000, Overhead $1,000), $1,030 over.");
});

Deno.test("budget: a cap stated in the hypothesis is checked; an outcome price is not a cap", () => {
  assertEquals(hypothesisBudgetCap(`${METFORMIN} The study has a total budget under $5,000.`), 5000);
  assertEquals(hypothesisBudgetCap("A screen for under $2k in total will find 3 hits."), 2000);
  assertEquals(hypothesisBudgetCap("A paper test will cut the cost to under $5 per test."), undefined);
  assertEquals(hypothesisBudgetCap(METFORMIN), undefined);
  const budget = { line_items: [{ category: "Labour", amount_usd: 6000 }], total_usd: 6000 };
  const v = verifyPlan({ budget }, { hypothesis: `${METFORMIN} Total budget under $5,000.`, references: [] }).verification;
  assertEquals(issue(v, "budget_cap_not_met")?.severity, "high");
});

// --- (b) catalog numbers -------------------------------------------------------------------

Deno.test("catalog: R2 92185b64's invented numbers are removed and Caco-2 gets ATCC HTB-37", () => {
  assert(looksLikePlaceholder("S1000") && looksLikePlaceholder("A1000") && looksLikePlaceholder("E1000"));
  assertFalse(looksLikePlaceholder("11965092") || looksLikePlaceholder("O0625") || looksLikePlaceholder("CCL-22"));
  assertEquals(cellLineIn("Caco-2 cells")?.atcc, "HTB-37");
  assertEquals(cellLineIn("HEK 293T cells")?.atcc, "CRL-3216");
  assertEquals(cellLineIn("Caco-2 culture medium")?.atcc, "HTB-37", "the lookup itself; checkCatalogNumbers skips media");

  const r = checkCatalogNumbers(R2_MATERIALS);
  assertEquals(r.removed.map((x) => x.catalog_number), ["S1000", "A1000", "T1000", "E1000"]);
  assertEquals(r.corrected, [{ name: "Caco-2 cells", from: "CCL-22", to: "HTB-37", why: "ATCC's number for Caco-2" }]);
  assertEquals(r.materials[0].catalog_status, "verified");
  for (const m of r.materials.slice(1)) assertEquals(m.catalog_number, undefined);
  const v = verifyPlan({ materials: R2_MATERIALS }, { hypothesis: BUTYRATE, references: [] }).verification;
  assert(kinds(v).includes("catalog_numbers_removed") && kinds(v).includes("catalog_numbers_corrected"));
});

Deno.test("catalog: a number the live lookup cannot find is unverified, a confirmed one verified", () => {
  const materials = [
    { name: "Sodium butyrate", supplier: "Sigma-Aldrich", catalog_number: "B5887" },
    { name: "Sodium butyrate", supplier: "Sigma-Aldrich", catalog_number: "B3157" },
    { name: "DMEM, high glucose", supplier: "Thermo Fisher", catalog_number: "11965092" },
    { name: "Transwell inserts", supplier: "Corning", catalog_number: "3470" },
  ];
  const r = checkCatalogNumbers(materials, [
    { material_index: 0, catalog_number: "B5887", status: "match", source: "B5887_SIAL" },
    { material_index: 1, catalog_number: "B3157", status: "not_found" },
  ]);
  assertEquals(r.materials.map((m) => m.catalog_status), ["verified", "unverified", "verified", "unverified"]);
  assertEquals(r.materials[1].catalog_check, "not in Sigma-Aldrich's catalogue as deposited in PubChem");
  assertEquals(r.materials[2].catalog_check, "listed as DMEM, high glucose (500 mL) (the app's catalogue list)");
  assertEquals(r.materials[3].catalog_check, "no searchable catalogue for Corning");
  const v = verifyPlan({ materials }, {
    hypothesis: BUTYRATE, references: [],
    liveSku: [{ material_index: 0, catalog_number: "B5887", status: "match" }, { material_index: 1, catalog_number: "B3157", status: "not_found" }],
  }).verification;
  const u = issue(v, "catalog_numbers_unverified");
  assertEquals(u?.severity, "medium");
  assert(u?.detail.startsWith("2 catalog number(s) could not be confirmed"), u?.detail);
  // A cached copy keeps what the lookup found when it was first checked.
  const again = checkCatalogNumbers(r.materials, [], { keepEarlier: true });
  assertEquals(again.materials[0].catalog_status, "verified");
  assertEquals(again.materials[1].catalog_check, "not in Sigma-Aldrich's catalogue as deposited in PubChem");
});

Deno.test("catalog: lookupMaterialsLive reports every Sigma number's status", async () => {
  const stub = ((input: string | URL | Request) => {
    const id = decodeURIComponent(String(input).split("/Sigma-Aldrich/")[1].split("/")[0]);
    const known: Record<string, string> = { B5887_SIGMA: "Sodium butyrate, >=98.5% (GC)", G7021_SIGMA: "D-(+)-Glucose" };
    return Promise.resolve(known[id]
      ? new Response(JSON.stringify({ InformationList: { Information: [{ Synonym: [known[id]] }] } }), { status: 200 })
      : new Response("{}", { status: 400 }));
  }) as typeof fetch;
  const r = await lookupMaterialsLive([
    { name: "Sodium butyrate", supplier: "Sigma-Aldrich", catalog_number: "B5887" },
    { name: "Sodium butyrate", supplier: "Sigma-Aldrich", catalog_number: "G7021" },
    { name: "Sodium butyrate", supplier: "Sigma-Aldrich", catalog_number: "S1000" },
    { name: "DMEM", supplier: "Thermo Fisher", catalog_number: "11965092" },
  ], stub);
  assertEquals(r.map((x) => x.status), ["match", "mismatch", "not_found"]);
});

// --- critique ----------------------------------------------------------------------------------

Deno.test("critique: a 'missing vehicle control' the plan has and an invented budget excess are dropped", () => {
  assertEquals(claimedMissingControls("Missing vehicle/palmitate-only control group"), ["vehicle", "palmitate-only"]);
  const plan = { protocol: V3_PROTOCOL, budget: { total_usd: 17540 } };
  const c = cleanCritique({
    concerns: [
      { severity: "high", area: "controls", issue: "Missing vehicle/palmitate-only control.", suggestion: "Add one." },
      { severity: "high", area: "budget", issue: "The budget exceeds $20,000 for a cell study.", suggestion: "Trim." },
      { severity: "medium", area: "controls", issue: "No positive control for lipid lowering.", suggestion: "Add an AMPK activator." },
      { severity: "high", area: "budget", issue: "The total exceeds the $3,000 cap.", suggestion: "Cut labour." },
    ],
    missing_controls: ["vehicle control", "positive control"],
  }, { plan });
  assertEquals(c?.concerns?.map((x) => x.area), ["controls", "budget"]);
  assertEquals(c?.concerns?.[0].issue, "No positive control for lipid lowering.");
  assertEquals(c?.missing_controls, ["positive control"]);
  assertEquals(c?.removed_concerns?.length, 3);
});

// --- (4) related work by embedding ------------------------------------------------------------

Deno.test("embedding filter: a relative cut drops papers far below the best one; no embeddings keeps all", async () => {
  // 2-d stand-in vectors at known angles to the hypothesis vector [1, 0].
  const at = (cos: number) => [cos, Math.sqrt(1 - cos * cos)];
  const papers = [{ title: "A" }, { title: "B" }, { title: "C" }, { title: "D" }];
  const sims = [0.86, 0.82, 0.70, 0.65];
  const r = await filterByEmbedding("h", papers, { floor: 0.66, margin: 0.15, embed: () => Promise.resolve([[1, 0], ...sims.map(at)]) });
  assertEquals(r.kept.map((p) => p.title), ["A", "B"]);
  assertEquals(r.threshold, 0.71);
  assertEquals(r.dropped.map((p) => p.title), ["C", "D"]);
  const off = await filterByEmbedding("h", papers, { embed: () => Promise.resolve(null) });
  assertEquals([off.available, off.kept.length], [false, 4]);
  assertEquals(Math.round(cosine([1, 0], at(0.5)) * 100) / 100, 0.5);
});

Deno.test("novelty: exact match needs embedding closeness, and more than a one-concept core", () => {
  const DSUP = "Coating 3D-printed polylactic acid lattices with a 20 nm layer of tardigrade damage suppressor protein Dsup will increase their tensile strength retention after 50 kGy gamma irradiation by at least 40% compared with uncoated lattices.";
  const concepts = hypothesisConcepts(DSUP);
  const pla = { title: "Enhancing the mechanical properties of 3D printed polylactic acid using nanocellulose", relevance: 0.32, matched: ["3D-printed", "polylactic"], embed_similarity: 0.725 };
  const v = calibrateNovelty({ signal: "exact_match", rationale: "", chosen: [0], semantic_overlap: "high" }, [pla], concepts);
  assertEquals(v.signal, "not_found");
  const butyrateConcepts = hypothesisConcepts(BUTYRATE);
  const same = { title: "Effects of sodium butyrate on the intestinal barrier function in a Caco-2 cell monolayer model", abstract: "Butyrate increased transepithelial electrical resistance (TEER) of Caco-2 monolayers.", relevance: 0.71, matched: [], embed_similarity: 0.811 };
  assertEquals(calibrateNovelty({ signal: "exact_match", rationale: "", chosen: [0], semantic_overlap: "high" }, [same], butyrateConcepts).signal, "exact_match");
  assertEquals(calibrateNovelty({ signal: "exact_match", rationale: "", chosen: [0], semantic_overlap: "high" }, [{ ...same, embed_similarity: 0.7 }], butyrateConcepts).signal, "similar");
});

// --- (a) version chain ---------------------------------------------------------------------------

Deno.test("versions: the whole chain is found from any version; the next number is over the whole chain", async () => {
  const rows = [
    { id: "v1", parent_run_id: null, version: 1 },
    { id: "v2", parent_run_id: "v1", version: 2 },
    { id: "v3", parent_run_id: "v2", version: 3 },
    { id: "v4", parent_run_id: "v1", version: 4 },
    { id: "other", parent_run_id: null, version: 1 },
  ];
  const one = (id: string) => Promise.resolve(rows.find((r) => r.id === id) ?? null);
  const kids = (ids: string[]) => Promise.resolve(rows.filter((r) => r.parent_run_id && ids.includes(r.parent_run_id)));
  for (const start of ["v1", "v2", "v3", "v4"]) {
    const chain = await loadChain(rows.find((r) => r.id === start)!, one, kids);
    assertEquals(chain.map((r) => r.id), ["v1", "v2", "v3", "v4"], `from ${start}`);
    assertEquals(nextVersion(chain), 5);
  }
  // The QA's case before v4 existed: refining v1 again must make v4, not a second v3.
  const before = rows.slice(0, 3);
  const chain = await loadChain(before[0], (id) => Promise.resolve(before.find((r) => r.id === id) ?? null),
    (ids) => Promise.resolve(before.filter((r) => r.parent_run_id && ids.includes(r.parent_run_id))));
  assertEquals(nextVersion(chain), 4);
  // A cycle in bad data ends the walk.
  const loop = [{ id: "a", parent_run_id: "b", version: 1 }, { id: "b", parent_run_id: "a", version: 2 }];
  const c = await loadChain(loop[0], (id) => Promise.resolve(loop.find((r) => r.id === id) ?? null),
    (ids) => Promise.resolve(loop.filter((r) => ids.includes(r.parent_run_id))));
  assertEquals(c.length, 2);
});

// --- (3) cache key, (d) lessons ----------------------------------------------------------------------

Deno.test("cache: the key includes the pipeline version; older runs are recognised", async () => {
  assertEquals(await hypothesisCacheKey(METFORMIN), await hypothesisCacheKey(`  ${METFORMIN.toUpperCase()}  `));
  assert(await hypothesisCacheKey(METFORMIN) !== await hypothesisCacheKey(METFORMIN, PIPELINE_VERSION - 1));
  assert(madeByOlderPipeline({}) && madeByOlderPipeline(null) && madeByOlderPipeline({ pipeline_version: 2 }));
  assertFalse(madeByOlderPipeline({ pipeline_version: PIPELINE_VERSION }));
  const v = verifyPlan({}, { hypothesis: METFORMIN, references: [] }).verification;
  assertEquals([v.version, v.pipeline_version], [2, PIPELINE_VERSION]);
});

Deno.test("lessons: similarity stays the cosine; the rating-weighted value is the score", () => {
  const ranked = rankFeedbackRows([
    { id: "a", section: "materials", rating: 2, correction: "Add Oil Red O.", similarity: 0.766, domain: "cell_biology" },
    { id: "b", section: "protocol", rating: 5, correction: "Normalise to protein.", similarity: 0.71, domain: null },
  ], "cell_biology");
  assertEquals(ranked.map((h) => h.id), ["b", "a"]);
  for (const h of ranked) assert(h.similarity <= 1 && h.score > h.similarity, JSON.stringify(h));
  assertEquals(ranked[1].similarity, 0.766);
});
