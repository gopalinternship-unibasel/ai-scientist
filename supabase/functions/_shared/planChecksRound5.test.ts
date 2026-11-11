// Review of the round-4 limits reader (11 Nov 2026, _e2e/ai-research-assistant-qa/r5). The reviewer ran
// the reader and its parent side by side on 175 instructions and 30 hypotheses: the round-4 version
// read new wordings but lost some the parent read, and took item prices and step durations for
// limits on the whole plan. These are the reviewer's cases.
// Run: deno test --allow-read --allow-env supabase/functions/_shared/planChecksRound5.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { effectiveConstraints, hypothesisBudgetCap, parseRefinementConstraints, refinementConstraintPrompt, verifyPlan } from "./planGuards.ts";

const METFORMIN = "Treating HepG2 cells with 10 µM metformin for 24 h will reduce palmitate-induced lipid accumulation by at least 30% compared with vehicle, measured by Oil Red O staining.";
const read = (text: string) => parseRefinementConstraints(text, 16000, 8);
const plan = (total: number, weeks = 8) => ({ budget: { line_items: [{ category: "Labour", amount_usd: total }], total_usd: total }, timeline: [{ duration: `${weeks} weeks` }] });

Deno.test("shares: a half, a price or a duration of one item or one step is not the plan's", () => {
  for (const text of [
    "Use half as much serum.",
    "Find an antibody at half the price.",
    "Incubate for half the time.",
    "Use 20% cheaper reagents.",
    "Use a 20% shorter incubation.",
    "Reduce the time to 50% confluence.",
    "Reduce the price of the kit by 20%.",
  ]) {
    assertEquals(read(text), {}, text);
  }
  // Each wording sets its own limit only.
  assertEquals(read("It should cost half as much."), { max_budget_usd: 8000 });
  assertEquals(read("It should take half as long."), { max_timeline_weeks: 4 });
  assertEquals(read("Halve both the budget and the timeline."), { max_budget_usd: 8000, max_timeline_weeks: 4 });
  assertEquals(read("Make it twice as fast."), { max_timeline_weeks: 4 });
  assertEquals(read("Do it for a third of the budget."), { max_budget_usd: 5333 });
  assertEquals(read("It should cost 30% less."), { max_budget_usd: 11200 });
  assertEquals(read("Spend 30% less."), { max_budget_usd: 11200 });
});

Deno.test("budget cap: a cap on the whole plan stays one when the sentence also names an item", () => {
  for (const text of [
    "Keep it under $3,000 including labour and overhead.",
    "No more than $3,000 including personnel.",
    "Keep the cost under $3,000 including personnel.",
    "Use fewer samples to stay under $3,000.",
    "Keep it under $3,000 with fewer samples.",
    "Keep it under $3,000 by using a cheaper kit.",
    "Stay under $3,000 without the sequencing.",
    "Reduce the number of samples so that it costs less than $3,000.",
    "Remove the antibody panel to get under $3,000.",
  ]) {
    assertEquals(read(text).max_budget_usd, 3000, text);
  }
  assertEquals(read("Get this under $5,000 by cutting the number of mice.").max_budget_usd, 5000);
  const v = verifyPlan(plan(9000), { hypothesis: METFORMIN, references: [], refinementInstruction: "Use fewer samples to stay under $3,000.", fresh: true });
  assertEquals(
    v.verification.issues.find((i) => i.kind === "refinement_budget_not_met")?.detail,
    "The refinement asked for a budget of at most $3,000; this plan totals $9,000 (Labour $9,000), $6,000 over.",
  );
});

Deno.test("budget cap: the amount that is asked for, not the one that describes the plan", () => {
  assertEquals(read("The budget is $16,647. Reduce it to $5,000.").max_budget_usd, 5000);
  assertEquals(read("The budget is $16,647, which is too much. Keep it under $5,000.").max_budget_usd, 5000);
  assertEquals(read("Lower the current total to $3,000.").max_budget_usd, 3000);
  assertEquals(read("Bring the current total down to $5,000.").max_budget_usd, 5000);
  assertEquals(read("The budget of $16,000 is too high. Make it cheaper."), { lower_budget_than_usd: 16000 });
  assertEquals(read("Budget: $2,000-$3,000.").max_budget_usd, 3000);
  assertEquals(read("Raise the budget cap to $8,000; the old cap of $5,000 was too low.").max_budget_usd, 8000);
});

Deno.test("budget cap: more ordinary wordings", () => {
  for (const text of [
    "Don't spend more than $3,000.",
    "It must not cost more than $3,000.",
    "I can't spend more than $3,000.",
    "The whole thing shouldn't cost more than $3,000.",
    "The budget shouldn't exceed $3,000.",
    "Max. $3,000.",
    "I only have 3000$.",
    "Redo this for $3,000.",
    "Max 3000USD.",
  ]) {
    assertEquals(read(text), { max_budget_usd: 3000 }, text);
  }
  assertEquals(read("Budget max. 3000 CHF."), { max_budget_usd: 3000, budget_currency: "CHF" });
  assertEquals(read("Keep the total budget under 3'000.- CHF."), { max_budget_usd: 3000, budget_currency: "CHF" });
  assertEquals(read("Keep the total budget under Fr. 3000."), { max_budget_usd: 3000, budget_currency: "CHF" });
  assertEquals(read("Keep the total budget under 3000CHF."), { max_budget_usd: 3000, budget_currency: "CHF" });
  assertEquals(read("Keep the total budget under 3,000 CAD."), { max_budget_usd: 3000, budget_currency: "CAD" });
  assertEquals(read("Keep the total budget under 300,000 yen."), { max_budget_usd: 300000, budget_currency: "JPY" });
});

Deno.test("budget cap: things that are not a ceiling on the whole plan", () => {
  for (const text of [
    "We have a $500 antibody against perilipin in the freezer; use it.",
    "I have a $300 antibody left over.",
    "The antibody budget is $500.",
    "Set a $500 budget for antibodies.",
    "Add a $2,000 budget line for sequencing.",
    "Each replicate should cost $200 at most.",
    "The budget can exceed $3,000 if needed.",
    "The budget may go over $5,000.",
    "A minimum budget of $5,000 is fine.",
    "Imaging should be under $500.",
    "Keep the materials budget under $2,000.",
    "Within the budget, raise n to 200.",
    "The antibody should cost $300 or less.",
  ]) {
    assertEquals(read(text).max_budget_usd, undefined, text);
  }
});

Deno.test("limits from a replayed correction: the wrapper sentence changes nothing", () => {
  // src/lib/replayWithLesson.ts sends a correction inside this sentence.
  const wrap = (section: string, correction: string) => `Apply this user-supplied correction to the ${section} section, keeping the rest of the plan consistent: "${correction}"`;
  for (const [section, correction] of [
    ["BUDGET", "The antibody should cost $300 or less."],
    ["MATERIALS", "Add an ELISA kit, $450 maximum."],
    ["MATERIALS", "Use an antibody that costs under $300."],
    ["PROTOCOL", "Incubate for 2 weeks at most."],
    ["PROTOCOL", "Differentiate the cells for 2 weeks at most."],
  ]) {
    assertEquals(read(wrap(section, correction)), {}, correction);
  }
  // A correction that does set a limit on the whole plan is still read.
  assertEquals(read(wrap("BUDGET", "The total must stay under $3,000.")), { max_budget_usd: 3000 });
  assertEquals(read(wrap("TIMELINE", "The whole study must fit into 4 weeks.")), { max_timeline_weeks: 4 });
});

Deno.test("'cheaper' without a figure: more wordings, and not for one item or a negated sentence", () => {
  for (const text of [
    "This is too expensive.",
    "The plan is far too expensive for us.",
    "Bring the cost down.",
    "The cost needs to come down.",
    "Make sure it costs less.",
    "Can you bring the price down?",
    "That is over my budget.",
  ]) {
    assertEquals(read(text), { lower_budget_than_usd: 16000 }, text);
  }
  for (const text of [
    "Is there a cheaper version of the antibody?",
    "Switch to a cheaper version of the staining kit.",
    "There is no need to reduce the budget.",
    "I am not asking you to reduce the budget; add a control.",
    "This is not too expensive; add a replicate.",
  ]) {
    assertEquals(read(text), {}, text);
  }
});

Deno.test("'cheaper' holds next to an inherited cap, and 'not below' is said only when it is true", () => {
  // v2 was made under "Keep the total budget under $3,000." and cost $2,900.
  const v2 = verifyPlan(plan(2900), { hypothesis: METFORMIN, references: [], refinementInstruction: "Keep the total budget under $3,000.", fresh: true }).plan;
  const limits = effectiveConstraints("Make it cheaper.", v2);
  assertEquals(limits, { lower_budget_than_usd: 2900, max_budget_usd: 3000, inherited: ["budget"] });
  const prompt = refinementConstraintPrompt(limits);
  assert(prompt.includes("at most 3000 USD") && prompt.includes("clearly lower than the previous plan's 2900 USD"), prompt);
  const not = verifyPlan(plan(2950), { hypothesis: METFORMIN, references: [], refinementInstruction: "Make it cheaper.", parentPlan: v2, fresh: true });
  assertEquals(
    not.verification.issues.filter((i) => i.kind === "refinement_budget_not_met").map((i) => i.detail),
    ["The refinement asked for a lower budget; this plan totals $2,950 (Labour $2,950), which is not below the $2,900 of the plan it refines."],
  );
  // Over the cap: one finding, about the cap.
  const over = verifyPlan(plan(3500), { hypothesis: METFORMIN, references: [], refinementInstruction: "Make it cheaper.", parentPlan: v2, fresh: true });
  assertEquals(over.verification.issues.filter((i) => i.kind === "refinement_budget_not_met").length, 1);
  // Lower, even by little: no finding (the old text said "not below" for a plan that was below).
  const parent = plan(16647);
  const lower = verifyPlan(plan(16547), { hypothesis: METFORMIN, references: [], refinementInstruction: "Reduce the budget.", parentPlan: parent, fresh: true });
  assertEquals(lower.verification.issues.some((i) => i.kind === "refinement_budget_not_met"), false);
});

Deno.test("timeline cap: more ordinary wordings, and durations of one step", () => {
  const weeks = (text: string) => read(text).max_timeline_weeks;
  assertEquals(weeks("The whole study should take no longer than 3 weeks."), 3);
  assertEquals(weeks("It should not take longer than 3 weeks."), 3);
  assertEquals(weeks("Make it a 2-week study."), 2);
  assertEquals(weeks("Compress it into a 2-week timeline."), 2);
  assertEquals(weeks("Max. 3 weeks."), 3);
  assertEquals(weeks("The timeline should be twenty four weeks or less."), 24);
  assertEquals(weeks("Finish in a week or two."), 2);
  assertEquals(weeks("Treat this as urgent: finish in 2 weeks."), 2);
  for (const text of [
    "Dose the mice for 4 weeks at most.",
    "Feed the high-fat diet for 8 weeks at most.",
    "We have 2 weeks of differentiation in the protocol already.",
    "Treat the cells for 2 weeks at most.",
  ]) {
    assertEquals(weeks(text), undefined, text);
  }
});

Deno.test("budget cap in the hypothesis: the wordings the first reader read, and no floor or permission", () => {
  for (const text of [
    "X improves Y in HeLa cells, with a budget capped at $5,000.",
    "X improves Y in HeLa cells, with a budget limited to $5,000.",
    "X improves Y in HeLa cells, with a budget not exceeding $5,000.",
    "X improves Y in HeLa cells, with a budget of less than $5,000.",
    "X improves Y in HeLa cells on a budget within $5,000.",
    "X improves Y in HeLa cells, for a total budget not exceeding $5,000.",
  ]) {
    assertEquals(hypothesisBudgetCap(text), 5000, text);
  }
  for (const text of [
    "X improves Y in HeLa cells. The budget may exceed $5,000.",
    "Patients given funds of $300 for transport attend more follow-up visits.",
    "Labs with funding under $50,000 publish fewer replication studies.",
    "X improves Y in HeLa cells with a minimum budget of $5,000.",
  ]) {
    assertEquals(hypothesisBudgetCap(text), undefined, text);
  }
});
