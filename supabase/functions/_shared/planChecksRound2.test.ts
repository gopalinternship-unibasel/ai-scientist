// Plan checks added for QA round 2 (9 Nov 2026), built from the QA's own
// runs with the default local model (qwen2.5:3b): 020ae70a (run A),
// b4665175 (its v2, "Keep the total budget under $3,000."), 6d59fa73 (v3,
// "Shorten the overall timeline to 2 weeks.") and a60e2fa8 (an independent
// second plan of the same hypothesis, submitted in capitals).
// Run: deno test --allow-net --allow-env --allow-read supabase/functions/_shared/
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { verifyPlan, verificationIssueLines } from "./planGuards.ts";
import { doseIssues, hypothesisDoses, materialListSteps, removeWrongCatalogNumbers } from "./planContentChecks.ts";
import { displayBudget, reconcileMaterialsLine } from "./planIntegrity.ts";

const METFORMIN = "Treating HepG2 hepatocytes with 10 µM metformin for 24 hours before a 0.5 mM palmitate challenge will reduce intracellular lipid accumulation, measured by Oil Red O staining, by at least 30% compared with vehicle-treated palmitate controls.";
const METFORMIN_CAPS = METFORMIN.toUpperCase();

const RUN_A_MATERIALS = [
  { name: "HepG2 cells", supplier: "ATCC", quantity: "1 vial", unit_cost_usd: 580, total_cost_usd: 580 },
  { name: "Metformin, 10 mM (100 mL)", supplier: "Sigma-Aldrich", quantity: "100 mL", unit_cost_usd: 100, total_cost_usd: 100 },
  { name: "Palmitate, 0.5 mM (100 mL)", supplier: "Sigma-Aldrich", quantity: "100 mL", unit_cost_usd: 100, total_cost_usd: 100 },
  { name: "DMEM (500 mL)", supplier: "Thermo Fisher", quantity: "500 mL", unit_cost_usd: 35, total_cost_usd: 35 },
  { name: "FBS, qualified (500 mL)", supplier: "Thermo Fisher", quantity: "500 mL", unit_cost_usd: 480, total_cost_usd: 480 },
];
const RUN_A_PROTOCOL = [
  { step: 1, title: "Prepare HepG2 cells", description: "Viable HepG2 cells from ATCC in DMEM with 10% FBS, 1% Pen/Strep, and 1x PBS. Culture in T75 flasks at 37°C, 5% CO2.", duration: "1 week" },
  { step: 2, title: "Metformin treatment", description: "Add 10 µM metformin to HepG2 cells in DMEM with 10% FBS, 1% Pen/Strep, and 1x PBS. Incubate for 24 hours at 37°C, 5% CO2.", duration: "24 hours" },
  { step: 3, title: "Palmitate challenge", description: "Add 0.5 mM palmitate to metformin-treated HepG2 cells in DMEM with 10% FBS, 1% Pen/Strep, and 1x PBS. Incubate for 24 hours at 37°C, 5% CO2.", duration: "24 hours" },
  { step: 4, title: "Oil Red O staining", description: "Stain cells with Oil Red O solution for 30 minutes at room temperature. Wash with PBS, air dry, and image cells.", duration: "30 minutes" },
  { step: 5, title: "Quantify lipid accumulation", description: "Count Oil Red O-stained cells using a confocal microscope. Calculate percentage reduction in lipid accumulation compared to vehicle controls.", duration: "1 hour" },
];
const RUN_A_BUDGET = {
  currency: "USD",
  total_usd: 18325,
  line_items: [
    { category: "Materials", amount_usd: 615 }, { category: "Labour", amount_usd: 5100 },
    { category: "Equipment", amount_usd: 1170 }, { category: "Overhead", amount_usd: 1440 },
  ],
};
const RUN_A_TIMELINE = [
  { phase: "Preparation", duration: "1 week", deliverables: [] },
  { phase: "Experiment", duration: "2 weeks", deliverables: [] },
  { phase: "Data analysis", duration: "1 week", deliverables: [] },
];

const kinds = (v: { issues: { kind: string }[] }) => v.issues.map((i) => i.kind);

// --- materials must name what the hypothesis is about ---------------------------

Deno.test("materials: run a60e2fa8 (no metformin, palmitate or HepG2) is flagged although 'Oil Red O' matches", () => {
  const materials = [
    { name: "DMEM (500 mL)", supplier: "Sigma-Aldrich", total_cost_usd: 35 },
    { name: "FBS, qualified (500 mL)", supplier: "Sigma-Aldrich", total_cost_usd: 480 },
    { name: "Pen/Strep 100x (100 mL)", supplier: "Sigma-Aldrich", total_cost_usd: 50 },
    { name: "PBS sterile (1 L)", supplier: "Sigma-Aldrich", total_cost_usd: 28 },
    { name: "Oil Red O (Sigma-Aldrich O0625)", supplier: "Sigma-Aldrich", total_cost_usd: 100 },
  ];
  for (const h of [METFORMIN, METFORMIN_CAPS]) {
    const issue = verifyPlan({ materials }, { hypothesis: h, references: [] }).verification.issues
      .find((i) => i.kind === "materials_off_topic");
    assert(issue, `flagged for ${h.slice(0, 20)}`);
    assertEquals(issue.severity, "high");
    assert(/metformin/i.test(issue.detail) && /palmitate/i.test(issue.detail) && /hepg2/i.test(issue.detail), issue.detail);
  }
});

Deno.test("materials: run A (HepG2, metformin, palmitate, DMEM, FBS) passes", () => {
  const v = verifyPlan({ materials: RUN_A_MATERIALS }, { hypothesis: METFORMIN, references: [] }).verification;
  assertFalse(kinds(v).includes("materials_off_topic"));
});

// --- doses -------------------------------------------------------------------------

Deno.test("doses: the hypothesis' doses are read with their substance", () => {
  const d = hypothesisDoses(METFORMIN);
  assertEquals(d.map((x) => [x.substance, x.text]), [["metformin", "10 uM"], ["palmitate", "0.5 mM"]]);
  assertEquals(hypothesisDoses("Treating SH-SY5Y cells with 1 mM nicotinamide mononucleotide (NMN) for 24 hours will raise NAD+ by at least 40%").map((x) => x.substance), ["nicotinamide"]);
  assertEquals(hypothesisDoses("Metformin (10 uM) lowers lipid accumulation by 30%").map((x) => [x.substance, x.text]), [["metformin", "10 uM"]]);
});

Deno.test("doses: v3 (6d59fa73) 'Add 10 mM metformin' is flagged as a changed dose; run A passes", () => {
  const v3 = [
    { title: "Metformin treatment", description: "Add 10 mM metformin to HepG2 cells for 24 hours." },
    { title: "Palmitate challenge", description: "Add 0.5 mM palmitate to metformin-treated cells for 24 hours." },
  ];
  assertEquals(doseIssues(METFORMIN, v3), [{ substance: "metformin", hypothesis: "10 uM", plan: ["10 mM"] }]);
  assertEquals(doseIssues(METFORMIN, RUN_A_PROTOCOL), []);
  const v = verifyPlan({ protocol: v3 }, { hypothesis: METFORMIN, references: [] }).verification;
  const issue = v.issues.find((i) => i.kind === "dose_changed");
  assertEquals(issue?.severity, "high");
  assertEquals(issue?.detail, "The hypothesis tests metformin at 10 uM; the protocol uses 10 mM.");
});

Deno.test("doses: a concentrated stock diluted to the hypothesis dose is not a changed dose", () => {
  const steps = [{ description: "Prepare a 10 mM metformin stock in water and dilute it to 10 µM in DMEM." }];
  assertEquals(doseIssues(METFORMIN, steps), []);
  const stockOnly = [{ description: "Make a 10 mM metformin stock solution." }, { description: "Treat cells with metformin for 24 h." }];
  assertEquals(doseIssues(METFORMIN, stockOnly), []);
});

// --- protocol steps that are material lists -----------------------------------------------

Deno.test("steps: v2 (b4665175) steps that only list materials are flagged; run A passes", () => {
  const v2 = [
    { description: "Vial of HepG2 cells (ATCC) and DMEM (500 mL) with FBS (500 mL)" },
    { description: "Metformin (100 mL, 10 mM) and DMEM (500 mL) with FBS (500 mL)" },
    { description: "Palmitate (100 mL, 0.5 mM) and DMEM (500 mL) with FBS (500 mL)" },
    { description: "Oil Red O stain (Sigma O0625) and isopropanol for dye extraction" },
    { description: "Quantify lipid accumulation by absorbance at 510 nm" },
  ];
  const r = materialListSteps(v2);
  assertEquals(r?.steps, [1, 2, 3]);
  assertEquals(materialListSteps(RUN_A_PROTOCOL), null);
  const v = verifyPlan({ protocol: v2 }, { hypothesis: METFORMIN, references: [] }).verification;
  assert(kinds(v).includes("protocol_steps_not_actions"));
  assert(kinds(v).includes("dose_changed"), "step 2 also says 10 mM metformin");
});

// --- catalog numbers -------------------------------------------------------------------------

Deno.test("catalog: prompt-example SKUs on the wrong product are removed (T9531 metformin) or corrected (CRL-3216 HepG2)", () => {
  const materials: { name: string; supplier: string; catalog_number?: string; total_cost_usd: number; notes?: string }[] = [
    { name: "HepG2 cells", supplier: "ATCC", catalog_number: "CRL-3216", total_cost_usd: 580 },
    { name: "Metformin, 10 mM (100 mL)", supplier: "Sigma-Aldrich", catalog_number: "T9531", total_cost_usd: 100 },
    { name: "DMEM (500 mL)", supplier: "Thermo Fisher", catalog_number: "11965092", total_cost_usd: 35 },
  ];
  const { materials: out, removed } = removeWrongCatalogNumbers(materials);
  assertEquals(removed.map((r) => r.catalog_number), ["T9531"]);
  // Since QA round 3 a cell line from the ATCC list gets ATCC's number
  // instead of losing the wrong one (CRL-3216 is HEK293T; HepG2 is HB-8065).
  assertEquals(out[0].catalog_number, "HB-8065");
  assert(out[0].notes?.includes("CRL-3216 replaced by HB-8065"), out[0].notes);
  assertEquals(out[2].catalog_number, "11965092", "a correct number stays");

  const v = verifyPlan({ materials }, { hypothesis: METFORMIN, references: [] });
  const issue = v.verification.issues.find((i) => i.kind === "catalog_numbers_removed");
  assert(issue?.detail.includes("T9531 for Metformin"), issue?.detail);
  assertEquals(verificationIssueLines(v.verification).some((l) => l.includes("T9531")), false, "fixed: not a reviewer concern");
});

Deno.test("catalog: a live supplier finding removes the number too", () => {
  const materials = [{ name: "Palmitic acid", supplier: "Sigma-Aldrich", catalog_number: "D2650", total_cost_usd: 50 }];
  const { removed } = removeWrongCatalogNumbers(materials, [{ material_index: 0, catalog_number: "D2650", supplier_hint: "Sigma-Aldrich lists this SKU as \"DMSO\"." }]);
  assertEquals(removed.length, 1);
});

// --- budget ---------------------------------------------------------------------------------------

Deno.test("budget: run A's 'Materials' $615 against a $1,295 table is raised to the table and counted in the total", () => {
  const { budget, change } = reconcileMaterialsLine(RUN_A_BUDGET, RUN_A_MATERIALS);
  assertEquals(change, { category: "Materials", stated: 615, table: 1295 });
  assertEquals(budget.line_items[0].amount_usd, 1295);
  const shown = displayBudget(RUN_A_BUDGET, RUN_A_MATERIALS);
  assertEquals(shown.budget.total_usd, 9005);

  const v = verifyPlan({ materials: RUN_A_MATERIALS, budget: RUN_A_BUDGET }, { hypothesis: METFORMIN, references: [] });
  assertEquals((v.plan.budget?.line_items ?? [])[0].amount_usd, 1295);
  assertEquals(v.plan.budget?.total_usd, 9005);
  assert(kinds(v.verification).includes("materials_line_corrected"));
  assertFalse(kinds(v.verification).includes("materials_subtotal_mismatch"));
  assertEquals(v.verification.budget?.stated_total, 18325);
});

Deno.test("budget: a materials line far above the table is flagged, not changed", () => {
  const budget = { line_items: [{ category: "Reagents & consumables", amount_usd: 5000 }, { category: "Labour", amount_usd: 1000 }], total_usd: 6000 };
  const v = verifyPlan({ materials: RUN_A_MATERIALS, budget }, { hypothesis: METFORMIN, references: [] });
  assertEquals((v.plan.budget?.line_items ?? [])[0].amount_usd, 5000);
  assert(kinds(v.verification).includes("materials_subtotal_mismatch"));
});

// --- notes --------------------------------------------------------------------------------------------

Deno.test("sources: the removed-source note does not repeat the invented link", () => {
  const v = verifyPlan({ protocol: [{ description: "Seed.", source: "https://www.biorxiv.org/content/10.1101/2020.01.09.925616v1" }] }, { hypothesis: METFORMIN, references: [] });
  const issue = v.verification.issues.find((i) => i.kind === "unverified_sources_removed");
  assertEquals(issue?.detail, "1 protocol source(s) cited papers or links that the literature search did not return and were removed.");
  assertEquals(v.verification.sources.removed_examples.length, 1, "kept for the record, not shown");
});

Deno.test("cache: a re-verified (cached) plan keeps the corrections made when it was first saved", () => {
  const first = verifyPlan({
    materials: RUN_A_MATERIALS, budget: RUN_A_BUDGET, protocol: [{ description: "Seed cells.", source: "https://fake.example.org/x" }],
  }, { hypothesis: METFORMIN, references: [] });
  assert(kinds(first.verification).includes("budget_total_corrected"));
  const again = verifyPlan(first.plan, { hypothesis: METFORMIN, references: [] });
  for (const k of ["budget_total_corrected", "materials_line_corrected", "unverified_sources_removed"]) {
    assert(kinds(again.verification).includes(k), `${k} carried over`);
  }
  assertEquals(again.verification.budget?.stated_total, 18325);
  assert(again.verification.issues.find((i) => i.kind === "budget_total_corrected")?.detail.includes("$18,325"), "the model's own total, not the corrected sum");
  assertEquals(again.verification.sources.removed, 1);
  // an old note that still quotes the link is cleaned
  const old = { ...first.plan, verification: { ...first.verification, issues: [{ kind: "unverified_sources_removed", severity: "medium", detail: "4 protocol source(s) cited papers or links that the literature search did not return and were removed (for example https://www.biorxiv.org/content/10.1101/2020.01.09.925616v1)." }] } };
  const cleaned = verifyPlan(old, { hypothesis: METFORMIN, references: [] }).verification.issues.find((i) => i.kind === "unverified_sources_removed");
  assertEquals(cleaned?.detail.includes("biorxiv"), false);
});

// --- timeline -------------------------------------------------------------------------------------------

Deno.test("timeline: protocol steps longer than the timeline are shown as a finding", () => {
  const protocol = [1, 2, 3, 4, 5].map((n) => ({ title: `S${n}`, description: "Incubate cells.", duration: "1 week" }));
  const timeline = [{ duration: "1 week" }, { duration: "1 week" }, { duration: "1 week" }];
  const v = verifyPlan({ protocol, timeline }, { hypothesis: METFORMIN, references: [] }).verification;
  assert(kinds(v).includes("protocol_exceeds_timeline"));
  assertFalse(kinds(verifyPlan({ protocol: RUN_A_PROTOCOL, timeline: RUN_A_TIMELINE }, { hypothesis: METFORMIN, references: [] }).verification).includes("protocol_exceeds_timeline"));
});

// --- suppliers (run 739dddf1: antibodies and an electrode from IDT, whole blood from Addgene) ---

Deno.test("suppliers: specialist suppliers that do not sell the item are flagged", () => {
  const materials = [
    { name: "Anti-CRP antibodies", supplier: "IDT", total_cost_usd: 420 },
    { name: "Whole blood samples", supplier: "Addgene", total_cost_usd: 0 },
    { name: "Alt-R CRISPR-Cas9 crRNA", supplier: "IDT", total_cost_usd: 95 },
    { name: "HepG2 cells", supplier: "ATCC", total_cost_usd: 580 },
    { name: "pLKO.1 plasmid", supplier: "Addgene", total_cost_usd: 85 },
  ];
  const issue = verifyPlan({ materials }, { hypothesis: METFORMIN, references: [] }).verification.issues.find((i) => i.kind === "supplier_unlikely");
  assertEquals(issue?.severity, "medium");
  assert(issue?.detail.includes("Anti-CRP antibodies") && issue.detail.includes("Whole blood samples"), issue?.detail);
  assertFalse(issue?.detail.includes("crRNA") || issue?.detail.includes("HepG2") || issue?.detail.includes("pLKO"));
});
