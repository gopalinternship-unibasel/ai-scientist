// Limits in ordinary wording (QA round 4, 11 Nov 2026). Refining run eaf0d06c
// with "The budget should be $3,000 or less." gave a $16,647 plan with no
// finding: the cap pattern needed a word such as "under" before the amount.
// Run: deno test --allow-read --allow-env supabase/functions/_shared/planChecksRound4.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { effectiveConstraints, hypothesisBudgetCap, parseRefinementConstraints, refinementConstraintPrompt, verifyPlan } from "./planGuards.ts";

const METFORMIN = "Treating HepG2 cells with 10 µM metformin for 24 h will reduce palmitate-induced lipid accumulation by at least 30% compared with vehicle, measured by Oil Red O staining.";
const PARENT_TOTAL = 16647;

Deno.test("budget cap: the wordings QA round 4 found unread", () => {
  for (const text of [
    "Keep the total budget under $3,000.",
    "The budget should be $3,000 or less.",
    "Total budget: $3,000 maximum.",
    "I only have $3,000 for this.",
    "The budget is 3000 dollars.",
    "Keep the total budget under 3 000 USD.",
    "Keep the total budget under $3.000.",
    "Keep the total budget under 3'000 USD.",
    "Stay within three thousand dollars.",
    "Budget: 3k.",
    "Maximum budget of $3,000.",
    "The budget must not exceed $3,000.",
    "We have $3,000 for this experiment.",
    "$3,000 is the limit.",
    "Do it on a $3,000 budget.",
    "No more than $3,000 in total, please.",
    "The budget cannot go over $3,000.",
    "Cap the budget at 3,000 USD.",
    "Spend at most $3k.",
    "Bring the total down to $3,000.",
  ]) {
    assertEquals(parseRefinementConstraints(text, PARENT_TOTAL), { max_budget_usd: 3000 }, text);
  }
});

Deno.test("budget cap: another currency keeps its number and is named", () => {
  assertEquals(parseRefinementConstraints("Keep the total budget under CHF 3,000."), { max_budget_usd: 3000, budget_currency: "CHF" });
  assertEquals(parseRefinementConstraints("Keep the total budget under 3,000 EUR."), { max_budget_usd: 3000, budget_currency: "EUR" });
  assertEquals(parseRefinementConstraints("The budget is 3000 Swiss francs."), { max_budget_usd: 3000, budget_currency: "CHF" });
  assertEquals(parseRefinementConstraints("Budget: £2,500 at most."), { max_budget_usd: 2500, budget_currency: "GBP" });

  const plan = { budget: { line_items: [{ category: "Labour", amount_usd: 4100 }], total_usd: 4100 }, timeline: [{ duration: "2 weeks" }] };
  const v = verifyPlan(plan, { hypothesis: METFORMIN, references: [], refinementInstruction: "Keep the total budget under CHF 3,000.", fresh: true });
  assertEquals(
    v.verification.issues.find((i) => i.kind === "refinement_budget_not_met")?.detail,
    "The refinement asked for a budget of at most CHF 3,000 (compared here as $3,000, because the plan is costed in US dollars); this plan totals $4,100 (Labour $4,100), $1,100 over.",
  );
  assert(refinementConstraintPrompt({ max_budget_usd: 3000, budget_currency: "CHF" }).includes("at most 3000 USD (the instruction says CHF"));
  // The currency travels with an inherited limit.
  assertEquals(effectiveConstraints("Add a vehicle control.", v.plan), { max_budget_usd: 3000, budget_currency: "CHF", inherited: ["budget"] });
});

Deno.test("budget cap: number formats", () => {
  const cap = (t: string) => parseRefinementConstraints(t).max_budget_usd;
  assertEquals(cap("Keep the budget under $3,000.50."), 3000.5);
  assertEquals(cap("Keep the budget under $12.500."), 12500);
  assertEquals(cap("Keep the budget under $1.250.000."), 1250000);
  assertEquals(cap("Keep the budget under $2.5k."), 2500);
  assertEquals(cap("Keep the budget under $2,5k."), 2500);
  assertEquals(cap("Keep the budget under 3 grand."), 3000);
  assertEquals(cap("Keep the budget under $0.5 million."), 500000);
  assertEquals(cap("Keep the budget under five thousand dollars."), 5000);
});

Deno.test("budget cap: a share of the refined plan's budget", () => {
  const cap = (t: string) => parseRefinementConstraints(t, 16000).max_budget_usd;
  for (const text of ["Halve the budget.", "Cut the budget in half.", "Reduce the budget by half.", "Reduce the budget by 50%.", "Do it for half the budget.", "Reduce the total cost to 50%.", "Make it 50% cheaper.", "It should cost half as much."]) {
    assertEquals(cap(text), 8000, text);
  }
  assertEquals(cap("Cut the budget by a quarter."), 12000);
  assertEquals(cap("Reduce the budget by two thirds."), 5333);
  assertEquals(cap("Reduce the budget to a quarter."), 4000);
  assertEquals(cap("Make the plan 30% cheaper."), 11200);
  // Without the refined plan's total there is nothing to take a share of.
  assertEquals(parseRefinementConstraints("Halve the budget."), {});
  // A negated request is not a request.
  assertEquals(cap("Do not halve the budget; add a positive control."), undefined);
});

Deno.test("budget: 'cheaper' without a figure means lower than the plan it refines", () => {
  for (const text of ["Make it much cheaper.", "Reduce the budget.", "Lower the overall cost.", "Make the study less expensive.", "I need a cheaper version.", "Cut costs.", "This must cost less."]) {
    assertEquals(parseRefinementConstraints(text, 16000), { lower_budget_than_usd: 16000 }, text);
  }
  for (const text of [
    "Use a cheaper antibody.",
    "Reduce the cost of the staining kit.",
    "Add a positive control without reducing the budget.",
    "Do not cut costs; add a replicate.",
    "Replace Oil Red O with BODIPY 493/503 staining.",
  ]) {
    assertEquals(parseRefinementConstraints(text, 16000), {}, text);
  }
  const parent = { budget: { line_items: [{ category: "Labour", amount_usd: 16000 }], total_usd: 16000 }, timeline: [{ duration: "4 weeks" }] };
  const same = { budget: { line_items: [{ category: "Labour", amount_usd: 16000 }], total_usd: 16000 }, timeline: [{ duration: "4 weeks" }] };
  const v = verifyPlan(same, { hypothesis: METFORMIN, references: [], refinementInstruction: "Make it much cheaper.", parentPlan: parent, fresh: true });
  assertEquals(
    v.verification.issues.find((i) => i.kind === "refinement_budget_not_met")?.detail,
    "The refinement asked for a lower budget; this plan totals $16,000 (Labour $16,000), which is not below the $16,000 of the plan it refines.",
  );
  const lower = { budget: { line_items: [{ category: "Labour", amount_usd: 9000 }], total_usd: 9000 }, timeline: [{ duration: "4 weeks" }] };
  const ok = verifyPlan(lower, { hypothesis: METFORMIN, references: [], refinementInstruction: "Make it much cheaper.", parentPlan: parent, fresh: true });
  assertEquals(ok.verification.issues.some((i) => i.kind === "refinement_budget_not_met"), false);
  assert(refinementConstraintPrompt({ lower_budget_than_usd: 16000 }).includes("clearly lower than the previous plan's 16000 USD"));
  // "Cheaper" is this step's request, not a standing limit for later refinements.
  assertEquals(effectiveConstraints("Add a vehicle control.", ok.plan), {});
});

Deno.test("budget cap: amounts that are not a ceiling on the whole budget", () => {
  for (const text of [
    "Keep the budget, but raise n to 12 per group.",
    "Keep the budget the same and increase the seeding density to 10000 cells per well.",
    "Do not change the cost; extend the treatment to 96 hours.",
    "Lower the dose to 500 nM without raising the budget.",
    "Use 3,000 cells per well and image after 2 weeks of differentiation.",
    "Increase n to 3000 events per sample; budget unchanged.",
    "Use an antibody that costs under $300.",
    "Replace the $1,200 kit with one under $400.",
    "Keep reagents under $50 per sample.",
    "Add an ELISA kit, $450 maximum.",
    "Add a $500 antibody against perilipin.",
    "Add RNA-seq, which costs about $2,000.",
    "Increase the budget by $2,000 for sequencing.",
    "The budget is fine; use 5000 cells per well.",
  ]) {
    assertEquals(parseRefinementConstraints(text, PARENT_TOTAL).max_budget_usd, undefined, text);
  }
  // One figure describes the plan as it is, the other is the request.
  assertEquals(parseRefinementConstraints("The current budget is $16,647; bring it under $5,000.").max_budget_usd, 5000);
  assertEquals(parseRefinementConstraints("Reduce the budget from $16,000 to $8,000.").max_budget_usd, 8000);
  assertEquals(parseRefinementConstraints("The total was $16,647. Make it $3,000 or less.").max_budget_usd, 3000);
  // A cap on one category is skipped, the cap on the whole is read.
  assertEquals(parseRefinementConstraints("Keep material costs under $2,000 and the total under $5,000.").max_budget_usd, 5000);
  assertEquals(parseRefinementConstraints("Keep the budget and use an antibody under $300.").max_budget_usd, undefined);
});

Deno.test("budget cap: the refinement of run eaf0d06c is now flagged", () => {
  const plan = {
    budget: { line_items: [{ category: "Materials", amount_usd: 1100 }, { category: "Labour", amount_usd: 2000 }, { category: "Overhead", amount_usd: 1000 }], total_usd: 4100 },
    timeline: [{ duration: "2 weeks" }],
  };
  const parent = { budget: { line_items: [{ category: "Labour", amount_usd: PARENT_TOTAL }], total_usd: PARENT_TOTAL }, timeline: [{ duration: "5 weeks" }] };
  for (const text of ["The budget should be $3,000 or less.", "Total budget: $3,000 maximum.", "I only have $3,000 for this.", "The budget is 3000 dollars.", "Keep the total budget under 3 000 USD.", "Keep the total budget under $3.000."]) {
    const v = verifyPlan(structuredClone(plan), { hypothesis: METFORMIN, references: [], refinementInstruction: text, parentPlan: parent, fresh: true });
    assertEquals(
      v.verification.issues.find((i) => i.kind === "refinement_budget_not_met")?.detail,
      "The refinement asked for a budget of at most $3,000; this plan totals $4,100 (Materials $1,100, Labour $2,000, Overhead $1,000), $1,100 over.",
      text,
    );
  }
  for (const text of ["Halve the budget.", "Cut the budget in half."]) {
    const v = verifyPlan(structuredClone(parent), { hypothesis: METFORMIN, references: [], refinementInstruction: text, parentPlan: parent, fresh: true });
    assertEquals(
      v.verification.issues.find((i) => i.kind === "refinement_budget_not_met")?.detail,
      "The refinement asked for a budget of at most $8,324; this plan totals $16,647 (Labour $16,647), $8,323 over.",
      text,
    );
  }
});

Deno.test("timeline cap: ordinary wordings", () => {
  const weeks = (t: string, parentWeeks?: number) => parseRefinementConstraints(t, undefined, parentWeeks).max_timeline_weeks;
  assertEquals(weeks("Complete everything within one month."), 4.35);
  assertEquals(weeks("Do it in two weeks."), 2);
  assertEquals(weeks("The timeline should be 2 weeks or less."), 2);
  assertEquals(weeks("Timeline: 3 weeks maximum."), 3);
  assertEquals(weeks("I only have 2 weeks."), 2);
  assertEquals(weeks("The whole project has to fit in a month."), 4.35);
  assertEquals(weeks("Halve the timeline.", 8), 4);
  assertEquals(weeks("Cut the timeline in half.", 8), 4);
  assertEquals(weeks("Make it 25% faster.", 8), 6);
  assertEquals(weeks("Halve the timeline."), undefined);
  // Still a change to one part, or a longer plan: no cap.
  for (const text of ["Extend the butyrate treatment to 2 weeks.", "Shorten the staining to 2 days.", "Run the study for at least 8 weeks.", "Differentiate the cells for 2 weeks at most."]) {
    assertEquals(weeks(text, 8), undefined, text);
  }
  // The refined plan's own length is the base for a share.
  const parent = { timeline: [{ duration: "4 weeks" }, { duration: "4 weeks" }], budget: { total_usd: 9000 } };
  assertEquals(effectiveConstraints("Halve the timeline.", parent), { max_timeline_weeks: 4 });
});

Deno.test("budget cap in the hypothesis: the two wordings QA round 4 found unread", () => {
  assertEquals(hypothesisBudgetCap("X improves Y in HeLa cells; the budget is capped at $5,000."), 5000);
  assertEquals(hypothesisBudgetCap("X improves Y in HeLa cells without exceeding a budget of 5000 dollars."), 5000);
  assertEquals(hypothesisBudgetCap("X improves Y in HeLa cells, with a total budget under $5,000."), 5000);
  assertEquals(hypothesisBudgetCap("X improves Y in HeLa cells for under $2,000 in total."), 2000);
  assertEquals(hypothesisBudgetCap("X improves Y in HeLa cells on a budget of five thousand dollars."), 5000);
  assertEquals(hypothesisBudgetCap("With a budget of CHF 4,000, X improves Y in HeLa cells."), 4000);
  // Money that is part of the claim, and plain numbers, are not a cap.
  for (const text of [
    "A $2 paper sensor detects CRP below 0.5 mg/L.",
    "A $5 paper test detects CRP as well as a $300 ELISA kit.",
    "Treatment costs under $20 per patient in total.",
    "A paper test will cut the cost to under $5 per test.",
    "Culturing at most 5000 cells per well will keep viability above 90%.",
    "A low-budget 3000 cell assay matches the standard one.",
    METFORMIN,
  ]) {
    assertEquals(hypothesisBudgetCap(text), undefined, text);
  }
});

// --- materials: synonyms (QA round 4, probe 18) -----------------------------------------------------

import { missingMaterials, readoutMissing } from "./planContentChecks.ts";

Deno.test("materials: an acid and its salt, a stain and its acronym, are the same item", () => {
  const hyp = "Treating HepG2 cells with 10 µM metformin for 24 h will reduce the lipid accumulation induced by 0.5 mM palmitate, measured by Oil Red O staining.";
  const steps = [
    { title: "Treat", description: "Treat HepG2 cells with 0.5 mM palmitate and 10 µM metformin for 24 h." },
    { title: "Stain", description: "Fix the cells and stain with Oil Red O; read the absorbance at 510 nm." },
  ];
  const listed = [{ name: "HepG2 cells" }, { name: "Metformin hydrochloride" }, { name: "Palmitic acid" }, { name: "ORO staining solution" }];
  assertEquals(missingMaterials(hyp, steps, listed), { required: [], other: [] });
  // Still reported when neither spelling is in the table.
  assertEquals(missingMaterials(hyp, steps, [{ name: "HepG2 cells" }, { name: "Metformin hydrochloride" }]).required, ["palmitate", "Oil Red O staining"]);
  // A step that says "ORO" does the Oil Red O readout.
  assertEquals(readoutMissing(hyp, [{ title: "Stain", description: "Stain the fixed cells with ORO for 15 min, then elute with isopropanol." }]), null);
  assert(readoutMissing(hyp, [{ title: "Lyse", description: "Lyse the cells and measure triglycerides with a kit." }]) !== null);
});
