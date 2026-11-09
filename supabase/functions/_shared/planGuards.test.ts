import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  extractDoi, matchReference, reconcileBudget, sanitizeStepSources, verifiedSource, checkBudget,
} from "./planIntegrity.ts";
import {
  catalogCopies, chooseRepaired, filterRelevantRules, keyTerms, parseRefinementConstraints, planDigest,
  repairableIssues, repairInstruction,
  scrubCandidateRefs, timelineWeeks, verificationIssueLines, verifyPlan,
} from "./planGuards.ts";
import { costCatalogPrompt, relevantCatalogGroups } from "./costCatalog.ts";
import { constantTimeEqual } from "./callerAuth.ts";

const NR = "Nicotinamide riboside (NR) supplementation at 500 uM for 24 h raises intracellular NAD+ levels in SH-SY5Y neuroblastoma cells by at least 30% compared with vehicle-treated controls.";

const REFS = [
  { title: "NAD+ metabolism and its roles in cellular processes during ageing", year: 2021, url: "https://doi.org/10.1038/s41580-020-00313-x" },
  { title: "Nicotinamide riboside is uniquely and orally bioavailable in mice and humans", year: 2016, url: "https://pubmed.ncbi.nlm.nih.gov/27721479/", doi: "10.1038/ncomms12948" },
];

// --- sources (QA run b1cd3e59: 0 references, 3 model-made URLs) -------------

Deno.test("sources: model-made URLs are removed when no reference was retrieved", () => {
  const steps = [
    { description: "Seed cells.", source: "https://www.biorxiv.org/content/10.1101/2020.01.09.925616v1" },
    { description: "Treat.", source: "https://www.jbc.org/article/S0021-9258(19)30082-7/fulltext" },
    { description: "Lyse.", source: "https://www.sciencedirect.com/science/article/pii/S0079691X19300182" },
  ];
  const { steps: out, report } = sanitizeStepSources(steps, []);
  assertEquals(out.map((s) => "source" in s), [false, false, false]);
  assertEquals(report.removed, 3);
});

Deno.test("sources: a retrieved reference is kept and labelled by URL, DOI or [N]", () => {
  assertEquals(verifiedSource("https://doi.org/10.1038/s41580-020-00313-x", REFS), "[1] NAD+ metabolism and its roles in cellular processes during ageing (2021)");
  assertEquals(verifiedSource("doi: 10.1038/NCOMMS12948.", REFS)?.startsWith("[2] "), true);
  assertEquals(verifiedSource("see [2]", REFS)?.startsWith("[2] "), true);
  assertEquals(matchReference("https://pubmed.ncbi.nlm.nih.gov/27721479", REFS), 2);
});

Deno.test("sources: out-of-range markers, author-year and DOIs not retrieved are dropped; plain labels stay", () => {
  assertEquals(verifiedSource("[7]", REFS), null);
  assertEquals(verifiedSource("Smith et al., Nature Protocols", REFS), null);
  assertEquals(verifiedSource("Bio-protocol 2019", REFS), null);
  assertEquals(verifiedSource("10.1101/2020.01.09.925616", REFS), null);
  assertEquals(verifiedSource("Manufacturer's instructions", REFS), "Manufacturer's instructions");
  // run 633e1d4f (0 references): the small model wrote "N" for every step
  for (const junk of ["N", "[N]", "n/a", "None", "-"]) assertEquals(verifiedSource(junk, []), null);
});

Deno.test("sources: links inside step descriptions become [N] or are removed", () => {
  const { steps, report } = sanitizeStepSources([
    { description: "Follow https://doi.org/10.1038/s41580-020-00313-x and (https://fake.example.org/p) closely." },
  ], REFS);
  assertEquals(steps[0].description, "Follow [1] and closely.");
  assertEquals(report.links_removed, 1);
});

Deno.test("extractDoi strips bioRxiv version suffixes and trailing punctuation", () => {
  assertEquals(extractDoi("https://www.biorxiv.org/content/10.1101/2020.01.09.925616v1."), "10.1101/2020.01.09.925616");
});

// --- budget (QA: 10,233 vs 12,133) --------------------------------------------

Deno.test("budget: total is reset to the sum of the line items", () => {
  const budget = {
    currency: "USD",
    line_items: [
      { category: "Reagents", amount_usd: 1013 }, { category: "Equipment", amount_usd: 120 },
      { category: "Labour", amount_usd: 10000 }, { category: "Overhead", amount_usd: 1000 },
    ],
    total_usd: 10233,
  };
  const { budget: fixed, check } = reconcileBudget(budget);
  assertEquals(fixed.total_usd, 12133);
  const v = verifyPlan({ budget }, { hypothesis: NR, references: [] }).verification;
  assertEquals(v.issues.map((i) => i.kind), ["budget_total_corrected"]);
  assertEquals(verificationIssueLines(v), [], "already fixed: not a reviewer concern");
  assertEquals(check, { line_item_sum: 12133, stated_total: 10233, mismatch: true });
  assertEquals(checkBudget({ line_items: [{ amount_usd: 2170 }], total_usd: 2170 })?.mismatch, false);
  assertEquals(checkBudget({ line_items: [{ amount_usd: "1,000" }], total_usd: "1000" })?.mismatch, false);
  // run 6140bde5: a "Total" row among the line items is not a cost
  const withTotalRow = reconcileBudget({
    line_items: [
      { category: "Materials", amount_usd: 132 }, { category: "Labour", amount_usd: 1400 },
      { category: "Overhead", amount_usd: 1568 }, { category: "Total", amount_usd: 3000 },
    ],
    total_usd: 3000,
  });
  assertEquals(withTotalRow.budget.total_usd, 3100);
  assertEquals(withTotalRow.budget.line_items?.length, 3);
  assertEquals(checkBudget({ line_items: [{ category: "Grand total", amount_usd: 5 }], total_usd: 5 }), null);
});

// --- materials, catalog, house rules (QA defect 4) -------------------------

Deno.test("catalog: only topic groups that fit the hypothesis reach the prompt", () => {
  const ids = relevantCatalogGroups(NR).map((g) => g.id);
  assert(ids.includes("cell_culture"));
  assert(!ids.includes("molecular_biology"), "no PCR items for an NAD+ assay");
  const prompt = costCatalogPrompt(NR);
  assert(!prompt.includes("Taq polymerase"));
  assert(prompt.includes("PRICE REFERENCE, not a shopping list"));
  assert(costCatalogPrompt("qPCR quantification of GAPDH mRNA in HeLa cells").includes("Taq polymerase"));
});

Deno.test("materials copied from the PCR catalog are flagged for an NAD+ hypothesis", () => {
  const materials = [
    { name: "Taq DNA Polymerase", total_cost_usd: 180 },
    { name: "Q5 High-Fidelity DNA Polymerase", total_cost_usd: 250 },
    { name: "1 kb DNA Ladder", total_cost_usd: 75 },
    { name: "Agarose, molecular grade", total_cost_usd: 220 },
    { name: "T75 culture flask", total_cost_usd: 280 },
  ];
  assertEquals(catalogCopies(materials, NR), ["Taq DNA Polymerase", "Q5 High-Fidelity DNA Polymerase", "1 kb DNA Ladder", "Agarose, molecular grade"]);
  const { verification } = verifyPlan({ materials, budget: { line_items: [], total_usd: 0 } }, { hypothesis: NR, references: [] });
  const kinds = verification.issues.map((i) => i.kind);
  assert(kinds.includes("catalog_items_copied"));
  assert(kinds.includes("materials_off_topic"));
  // the reviewer gets open findings, high severity first
  assert(verificationIssueLines(verification)[0].startsWith("- The materials do not name what the hypothesis is about"));
});

Deno.test("materials without any cost are flagged", () => {
  const { verification } = verifyPlan({ materials: [{ name: "NMN", total_cost_usd: 0 }, { name: "SH-SY5Y cells", total_cost_usd: 0 }] }, { hypothesis: NR, references: [] });
  assert(verification.issues.some((i) => i.kind === "materials_unpriced"));
});

Deno.test("materials that name the compound and cell line pass", () => {
  const materials = [
    { name: "Nicotinamide riboside chloride (Sigma SMB00907)", total_cost_usd: 300 },
    { name: "SH-SY5Y cells (ATCC CRL-2266)", total_cost_usd: 580 },
    { name: "NAD/NADH-Glo Assay (Promega G9071)", total_cost_usd: 650 },
  ];
  const { verification } = verifyPlan({ materials }, { hypothesis: NR, references: [] });
  assertEquals(verification.issues, []);
});

Deno.test("house rules from an unrelated trehalose study are dropped, generic and matching ones kept", () => {
  const rules = [
    { rule: "Optimize trehalose concentration for freeze-thaw cycles" },
    { rule: "Use DMSO Hybri-Max as the 10% control" },
    { rule: "Measure NAD+ with an enzymatic cycling assay normalised to protein" },
    { rule: "Report n per group and the statistical test" },
  ];
  assertEquals(filterRelevantRules(rules, NR).map((r) => r.rule), [
    "Measure NAD+ with an enzymatic cycling assay normalised to protein",
    "Report n per group and the statistical test",
  ]);
  assert(keyTerms("SH-SY5Y cells").has("shsy5y"));
});

// --- refinements (QA: "under $3,000" -> $16,235; "8 weeks" -> 5 months) -----

Deno.test("refinement limits are parsed from the instruction", () => {
  assertEquals(parseRefinementConstraints("keep total budget under $3,000"), { max_budget_usd: 3000 });
  assertEquals(parseRefinementConstraints("Shorten the overall timeline to 8 weeks"), { max_timeline_weeks: 8 });
  assertEquals(parseRefinementConstraints("Cut the budget by 50%", 16000), { max_budget_usd: 8000 });
  assertEquals(parseRefinementConstraints("Bring the cost down to $5k and finish within 2 months"), { max_budget_usd: 5000, max_timeline_weeks: 8.69 });
  assertEquals(parseRefinementConstraints("Add a positive control"), {});
});

Deno.test("refinement limits that the plan breaks are flagged", () => {
  const plan = {
    budget: { currency: "USD", line_items: [{ category: "Labour", amount_usd: 16235 }], total_usd: 16235 },
    timeline: [1, 2, 3, 4, 5].map((i) => ({ phase: `P${i}`, duration: "1 month" })),
  };
  assertEquals(timelineWeeks(plan.timeline), 21.4);
  const a = verifyPlan(plan, { hypothesis: NR, references: [], refinementInstruction: "keep total budget under $3,000" });
  assertEquals(a.verification.issues.map((i) => i.kind), ["refinement_budget_not_met"]);
  const b = verifyPlan(plan, { hypothesis: NR, references: [], refinementInstruction: "Shorten the overall timeline to 8 weeks" });
  assertEquals(b.verification.issues.map((i) => i.kind), ["refinement_timeline_not_met"]);
  const ok = verifyPlan({ ...plan, timeline: [{ phase: "All", duration: "8 weeks" }] }, { hypothesis: NR, references: [], refinementInstruction: "Shorten the overall timeline to 8 weeks" });
  assertEquals(ok.verification.issues, []);
});

Deno.test("planDigest keeps the budget and timeline of a long plan", () => {
  const plan = {
    title: "T", summary: "x".repeat(2000),
    protocol: Array.from({ length: 5 }, (_, i) => ({ step: i + 1, title: `Step ${i + 1}`, description: "d".repeat(400), duration: "1 day" })),
    budget: { currency: "USD", line_items: [{ category: "Labour", amount_usd: 9000 }], total_usd: 9000 },
    timeline: [{ phase: "Run", duration: "4 weeks", deliverables: ["data"] }],
  };
  const raw = JSON.stringify(plan).slice(0, 3500);
  assert(!raw.includes("total_usd"), "the old 3,500-character cut lost the budget");
  const d = planDigest(plan, 3500);
  assert(d.length <= 3500);
  assert(d.includes("\"total_usd\":9000") && d.includes("4 weeks"));
});

// --- novelty wording, secrets --------------------------------------------------

Deno.test("Candidate N in the novelty rationale becomes the paper title", () => {
  const out = scrubCandidateRefs("Candidate 0 tests the same claim, unlike candidate #2.", ["NR raises NAD+ in neurons", "B", "C paper"]);
  assertEquals(out, "\"NR raises NAD+ in neurons\" tests the same claim, unlike \"C paper\".");
});

Deno.test("constantTimeEqual", () => {
  assert(constantTimeEqual("abc", "abc"));
  assert(!constantTimeEqual("abc", "abd"));
  assert(!constantTimeEqual("abc", "abcd"));
});

// --- one automatic repair attempt (run f6ad46e3: the refinement copied $17,355) --

Deno.test("planDigest leaves out the numbers a refinement limit rules out", () => {
  const plan = {
    title: "T",
    materials: [{ name: "NMN", total_cost_usd: 15, unit_cost_usd: 15 }],
    budget: { currency: "USD", line_items: [{ category: "Labour", amount_usd: 11965 }], total_usd: 17355 },
    timeline: [{ phase: "Run", duration: "5 months", deliverables: [] }],
    protocol: [{ step: 1, title: "Treat", description: "x", duration: "1 month" }],
  };
  const b = planDigest(plan, 8000, { budget: true });
  assert(!b.includes("17355") && !b.includes("11965") && b.includes("Labour") && b.includes("5 months"));
  assert(b.includes("\"total_cost_usd\":15"), "material prices stay");
  const t = planDigest(plan, 8000, { durations: true });
  assert(!t.includes("5 months") && !t.includes("1 month") && t.includes("17355"));
});

Deno.test("chooseRepaired keeps the repair only when it clears findings", () => {
  const ctx = { hypothesis: NR, references: [], refinementInstruction: "keep total budget under $3,000" };
  const over = { budget: { currency: "USD", line_items: [{ category: "Labour", amount_usd: 17355 }], total_usd: 17355 } };
  const under = { budget: { currency: "USD", line_items: [{ category: "Labour", amount_usd: 2900 }], total_usd: 2900 } };
  const first = verifyPlan(over, ctx);
  assertEquals(repairableIssues(first.verification).map((i) => i.kind), ["refinement_budget_not_met"]);
  assert(repairInstruction(repairableIssues(first.verification)).includes("at most $3,000"));

  const fixed = chooseRepaired(first, verifyPlan(under, ctx));
  assertEquals(fixed.plan.budget?.total_usd, 2900);
  assertEquals(fixed.verification.repair?.outcome, "fixed");

  const notFixed = chooseRepaired(first, verifyPlan(over, ctx));
  assertEquals(notFixed.verification.repair?.outcome, "not fixed");
  assertEquals(notFixed.verification.repair?.second_attempt?.length, 1);
  assert(notFixed.verification.issues[0].detail.endsWith("One automatic second attempt did not fix it."));

  assertEquals(chooseRepaired(first, null).verification.repair?.outcome, "failed");
});
