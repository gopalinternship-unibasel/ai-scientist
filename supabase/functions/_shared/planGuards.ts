// Deterministic guards that run on every generated (and every cached) plan
// before it is saved or served. They fix what can be fixed without a model
// (sources, budget arithmetic) and flag what cannot (materials that do not
// fit the hypothesis, a refinement whose requested limit was not met).
// Flags are stored on the plan (`plan.verification`), shown on the run page
// and in the PDF, and handed to the reviewer critique as high-severity
// pre-check findings.
//
// Background (QA, 9 Nov 2026, default local model qwen2.5:3b):
//  - materials copied from the cost-catalog PCR examples (Taq, Q5, DNA
//    ladder, agarose, T75) for an NAD+ assay in SH-SY5Y cells;
//  - house rules from an unrelated trehalose study pasted into the protocol;
//  - refinements "keep total budget under $3,000" and "shorten the overall
//    timeline to 8 weeks" produced $16,235 and 5 phases of one month.

import {
  costLineItems, MATERIALS_LINE_RE, materialsSubtotal, reconcileBudget, reconcileMaterialsLine, sanitizeStepSources,
  type RefLike, type SourceReport,
} from "./planIntegrity.ts";
import { CATALOG_GROUPS, relevantCatalogGroups } from "./costCatalog.ts";
import { checkTimelineConsistency, parseDurationToHours } from "./timelineCheck.ts";
import { anchorConcepts, hypothesisConcepts, mentions, textWords } from "./hypothesisTerms.ts";
import {
  checkCatalogNumbers, compartmentMismatch, dilutionIssues, doseIssues, type LiveSkuFinding, materialListSteps,
  type MaterialWithCatalog, missingMaterials, readoutMissing, stepDurationIssues, stripStepCatalogNumbers, unlikelySuppliers,
} from "./planContentChecks.ts";
import { PIPELINE_VERSION } from "./pipelineVersion.ts";

export interface PlanIssue {
  kind:
    | "budget_total_corrected"
    | "materials_line_corrected"
    | "materials_subtotal_mismatch"
    | "materials_off_topic"
    | "materials_unpriced"
    | "catalog_items_copied"
    | "catalog_numbers_removed"
    | "catalog_numbers_corrected"
    | "catalog_numbers_unverified"
    | "supplier_unlikely"
    | "materials_missing"
    | "materials_incomplete"
    | "dose_changed"
    | "dilution_inconsistent"
    | "readout_missing"
    | "readout_compartment"
    | "protocol_steps_not_actions"
    | "protocol_exceeds_timeline"
    | "step_durations_inconsistent"
    | "budget_cap_not_met"
    | "budget_materials_only"
    | "refinement_budget_not_met"
    | "refinement_timeline_not_met"
    | "unverified_sources_removed";
  severity: "high" | "medium";
  detail: string;
}

/** Findings the guards corrected themselves (shown as "Fixed", not sent to the reviewer). */
export const FIXED_KINDS = new Set<PlanIssue["kind"]>([
  "budget_total_corrected", "unverified_sources_removed", "materials_line_corrected", "catalog_numbers_removed",
  "catalog_numbers_corrected",
]);

export interface PlanVerification {
  /** 1: QA rounds 1-2; 2: QA round 3 (catalog status, readout, missing materials, dilutions). */
  version: 1 | 2;
  /** The pipeline that checked the plan (pipelineVersion.ts). */
  pipeline_version?: number;
  sources: SourceReport;
  budget: { stated_total: number | null; line_item_sum: number; corrected: boolean } | null;
  refinement?: RefinementConstraints;
  issues: PlanIssue[];
  /** Set when the plan was regenerated once because of a repairable finding. */
  repair?: {
    attempted: PlanIssue["kind"][];
    outcome: "fixed" | "partly fixed" | "not fixed" | "failed";
    /** What the second attempt still broke (when it was not kept or not clean). */
    second_attempt?: string[];
  };
}

// High-severity findings worth one automatic second attempt at the plan:
// the model ignored the refinement's limit, or listed materials that have
// nothing to do with the hypothesis.
export const REPAIR_KINDS = new Set<PlanIssue["kind"]>([
  "refinement_budget_not_met", "refinement_timeline_not_met", "materials_off_topic",
  "dose_changed", "protocol_steps_not_actions",
  // QA round 3: the compound, cell line or readout reagent missing from the
  // materials, no step for the hypothesis' readout, a budget cap stated in
  // the hypothesis.
  "materials_missing", "readout_missing", "budget_cap_not_met",
  // A budget of materials only is not a costing (run 42c080d0: $190 in all).
  "budget_materials_only",
]);

export function repairableIssues(v: PlanVerification): PlanIssue[] {
  return v.issues.filter((i) => REPAIR_KINDS.has(i.kind));
}

/** Message for the second attempt: what the first plan broke. */
export function repairInstruction(issues: PlanIssue[]): string {
  return `\n\nYOUR PREVIOUS ANSWER WAS REJECTED BY THE AUTOMATED CHECKS:\n${issues.map((i) => `- ${i.detail}`).join("\n")}\nProduce the full experiment plan again and fix every point above. Do not copy numbers from the previous plan that the limits rule out.`;
}

/**
 * Pick between the first plan and its repair: the repair wins when it has
 * fewer repairable findings. Returns the chosen plan and verification with
 * `repair` filled in; a repair that did not clear a finding says so in that
 * finding's text.
 */
export function chooseRepaired<P extends { verification?: PlanVerification }>(
  first: { plan: P; verification: PlanVerification },
  second: { plan: P; verification: PlanVerification } | null,
): { plan: P; verification: PlanVerification } {
  const attempted = repairableIssues(first.verification).map((i) => i.kind);
  const pick = (r: { plan: P; verification: PlanVerification }, outcome: NonNullable<PlanVerification["repair"]>["outcome"]) => {
    const verification: PlanVerification = {
      ...r.verification,
      issues: r.verification.issues.map((i) => REPAIR_KINDS.has(i.kind)
        ? { ...i, detail: `${i.detail} One automatic second attempt did not fix it.` }
        : i),
      repair: { attempted, outcome },
    };
    return { plan: { ...r.plan, verification }, verification };
  };
  if (!second) return pick(first, "failed");
  const left = repairableIssues(second.verification);
  if (left.length === 0) {
    const verification: PlanVerification = { ...second.verification, repair: { attempted, outcome: "fixed" } };
    return { plan: { ...second.plan, verification }, verification };
  }
  const chosen = left.length < attempted.length ? pick(second, "partly fixed") : pick(first, "not fixed");
  chosen.verification.repair!.second_attempt = left.map((i) => i.detail);
  return chosen;
}

// --- key terms -------------------------------------------------------------

const STOP = new Set([
  "the", "and", "or", "but", "of", "in", "on", "at", "to", "for", "with", "by", "from", "as", "is",
  "are", "was", "were", "be", "been", "this", "that", "these", "those", "will", "would", "should",
  "could", "may", "might", "can", "does", "did", "than", "then", "such", "into", "via", "between",
  "within", "without", "over", "under", "using", "use", "used", "not", "nor", "our", "their", "its",
  "also", "only", "more", "less", "least", "most", "compared", "versus", "each", "every", "any",
  "all", "some", "when", "while", "after", "before", "during", "per", "least", "at", "about",
  "has", "have", "had", "who", "which", "what", "where", "how", "why", "your", "you", "one", "two",
  "three", "four", "five", "ten", "both", "same", "other", "least", "much", "many", "very", "into",
]);

// Words common to almost every lab plan: they say nothing about whether a
// material or rule belongs to THIS experiment.
const GENERIC = new Set([
  "cell", "cells", "culture", "cultured", "control", "controls", "group", "groups", "sample", "samples",
  "assay", "assays", "level", "levels", "increase", "increases", "increased", "decrease", "decreases",
  "decreased", "reduce", "reduces", "reduced", "raise", "raises", "raised", "improve", "improves",
  "treatment", "treated", "treat", "hour", "hours", "day", "days", "week", "weeks", "month", "months",
  "effect", "effects", "concentration", "concentrations", "measure", "measured", "measurement",
  "percent", "higher", "lower", "high", "low", "study", "experiment", "experiments", "protocol",
  "buffer", "medium", "media", "solution", "kit", "kits", "reagent", "reagents", "standard",
  "standards", "test", "tests", "tested", "testing", "result", "results", "data", "analysis",
  "baseline", "relative", "significant", "significantly", "total", "final", "optimize", "optimise",
  "ensure", "include", "always", "never", "must", "plan", "plans", "step", "steps", "method",
  "methods", "condition", "conditions", "sterile", "grade", "case", "pack", "unit", "units",
  "vial", "bottle", "rate", "rates", "time", "times", "change", "changes", "response", "responses",
  "model", "models", "system", "systems", "human", "type", "based", "new", "novel", "least",
  "vehicle", "dose", "doses", "dosing", "replicate", "replicates", "triplicate", "temperature",
  "incubate", "incubation", "storage", "store", "stored", "prepare", "preparation", "fresh",
  "supplier", "catalog", "custom", "price", "cost", "costs", "usd", "list", "item", "items",
  "lab", "laboratory", "equipment", "consumables", "materials", "material", "general",
  // methodology words: a rule made only of these is a generic rule
  "report", "reported", "reporting", "record", "document", "statistical", "statistic", "statistics",
  "power", "blind", "blinded", "blinding", "randomize", "randomise", "randomized", "randomised",
  "randomization", "calibrate", "calibration", "validate", "validation", "verify", "positive",
  "negative", "biological", "technical", "independent", "repeat", "repeated", "normalize",
  "normalise", "normalized", "normalised", "account", "consider", "avoid", "check", "confirm",
]);

function stem(t: string): string {
  return t.length > 4 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t;
}

/** Specific content words of a text: lower-cased, stemmed, no stop/generic words. */
export function keyTerms(text: string): Set<string> {
  const out = new Set<string>();
  const cleaned = (text ?? "").toLowerCase().replace(/[^\p{L}\p{N}\-+/.\s]/gu, " ");
  for (const raw of cleaned.split(/[\s/]+/)) {
    const t = raw.replace(/^[-+.]+|[-+.]+$/g, "");
    if (t.length < 3 || /^\d+(?:[.,]\d+)?$/.test(t) || (/^\d/.test(t) && !/[a-z]/.test(t))) continue;
    if (STOP.has(t) || GENERIC.has(t) || GENERIC.has(stem(t))) continue;
    out.add(stem(t));
    // "sh-sy5y" also matches "shsy5y"; "freeze-thaw" also matches "freeze".
    if (t.includes("-")) {
      out.add(t.replace(/-/g, ""));
      for (const part of t.split("-")) {
        if (part.length >= 4 && !STOP.has(part) && !GENERIC.has(part) && !/^\d+$/.test(part)) out.add(stem(part));
      }
    }
  }
  return out;
}

/** Terms of `a` that also occur in `b` (prefix match for words of 5+ letters). */
export function sharedTerms(a: Set<string>, b: Set<string>): string[] {
  const out: string[] = [];
  for (const t of a) {
    if (b.has(t)) { out.push(t); continue; }
    if (t.length >= 5) {
      for (const u of b) {
        if (u.length >= 5 && (u.startsWith(t) || t.startsWith(u))) { out.push(t); break; }
      }
    }
  }
  return out;
}

// --- house rules -----------------------------------------------------------

/**
 * House rules are per domain, so a "cell_biology" hypothesis used to get
 * every cell-biology rule, including ones about a different experiment
 * (trehalose freeze-thaw rules in an NAD+ plan). Keep a rule when it shares
 * a specific term with the hypothesis, or when it has no specific terms at
 * all (a generic rule such as "report n per group").
 */
export function filterRelevantRules<R extends { rule: string }>(rules: R[], hypothesis: string): R[] {
  const h = keyTerms(hypothesis);
  return rules.filter((r) => {
    const terms = keyTerms(r.rule);
    if (terms.size === 0) return true;
    return sharedTerms(terms, h).length > 0;
  });
}

// --- novelty rationale -----------------------------------------------------

/**
 * The novelty prompt forbids "Candidate 0/1/2" (users never see that list),
 * yet small models write it anyway. Replace such phrases with a short quoted
 * title of the paper the index points at.
 */
export function scrubCandidateRefs(rationale: string, titles: string[]): string {
  if (!rationale) return rationale;
  return rationale.replace(/\b(?:candidate|paper|entry|index)\s*(?:#|no\.?\s*)?(\d+)\b/gi, (m, d: string) => {
    const t = titles[parseInt(d, 10)];
    if (!t) return "one of the retrieved papers";
    const short = t.length > 60 ? `${t.slice(0, 57).trimEnd()}...` : t;
    return `"${short}"`;
  });
}

// --- refinement constraints ------------------------------------------------

export interface RefinementConstraints {
  max_budget_usd?: number;
  /** The currency the instruction named when it was not US dollars ("CHF"); the number is compared as USD. */
  budget_currency?: string;
  /** "Make it cheaper", "reduce the budget": the total must be below this (the refined plan's total). */
  lower_budget_than_usd?: number;
  max_timeline_weeks?: number;
  /** Limits that come from an earlier refinement in the chain, not from this instruction. */
  inherited?: Array<"budget" | "timeline">;
}

const GIVE_UP = "ignore|drop|lift|remove|relax|forget|disregard";
const LIMIT_WORDS = {
  budget: {
    noun: "(?:budget|cost)",
    more: "increase|raise|double|triple|expand",
    free: /\b(?:any|unlimited)\s+budget\b|\bno\s+budget\s+(?:limit|cap|constraint)\b/,
  },
  timeline: {
    noun: "(?:timeline|schedule|deadline|time limit)",
    more: "extend|lengthen|prolong",
    free: /\bno\s+(?:deadline|time limit)\b|\bas long as (?:needed|it takes)\b/,
  },
};

/**
 * Whether the instruction gives an earlier limit up: "ignore the budget",
 * "increase the budget", "the timeline no longer matters", "take as long as
 * needed". A negated verb keeps it ("do not increase the budget").
 */
function liftsLimit(s: string, which: "budget" | "timeline"): boolean {
  const w = LIMIT_WORDS[which];
  const verb = s.match(new RegExp(`\\b(?:${GIVE_UP}|${w.more})\\s+(?:the\\s+)?(?:previous\\s+|earlier\\s+|total\\s+|overall\\s+)?${w.noun}\\b`));
  if (verb && !/(?:\b(?:without|not|never|no)|n't)\s+(?:\w+\s+)?$/.test(s.slice(0, verb.index))) return true;
  if (new RegExp(`\\b${w.noun}\\b[^.;]{0,25}\\b(?:no longer|not a (?:constraint|concern|limit)|does(?:n't| not) matter|is flexible|unlimited)\\b`).test(s)) return true;
  return w.free.test(s);
}

/**
 * The limits a refinement works under: the ones its instruction states, and
 * the ones an earlier refinement in the chain stated that it neither
 * replaces nor gives up. Without this, "Keep the total budget under $3,000."
 * (v2) followed by "Shorten the overall timeline to 2 weeks." (v3) left v3
 * free to cost anything. `parentPlan` is the stored plan being refined; its
 * verification.refinement holds the limits it worked under.
 */
export function effectiveConstraints(
  instruction: string | null | undefined,
  parentPlan?: unknown,
): RefinementConstraints {
  const parent = (parentPlan && typeof parentPlan === "object" ? parentPlan : {}) as PlanShape;
  const out = parseRefinementConstraints(
    instruction,
    Number(parent.budget?.total_usd) || undefined,
    timelineWeeks(parent.timeline) || undefined,
  );
  if (!(instruction ?? "").trim()) return out;
  const earlier = parent.verification?.refinement ?? {};
  const s = (instruction ?? "").toLowerCase();
  const inherited: Array<"budget" | "timeline"> = [];
  const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
  if (out.max_budget_usd === undefined && positive(earlier.max_budget_usd) && !liftsLimit(s, "budget")) {
    out.max_budget_usd = earlier.max_budget_usd;
    if (typeof earlier.budget_currency === "string") out.budget_currency = earlier.budget_currency;
    inherited.push("budget");
  }
  if (out.max_timeline_weeks === undefined && positive(earlier.max_timeline_weeks) && !liftsLimit(s, "timeline")) {
    out.max_timeline_weeks = earlier.max_timeline_weeks;
    inherited.push("timeline");
  }
  if (inherited.length) out.inherited = inherited;
  return out;
}

// --- amounts of money ----------------------------------------------------------

/** Number words before a unit of money or time: "three thousand", "one month". */
const WORD_NUM: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50,
};
const WORD_NUM_RE = Object.keys(WORD_NUM).join("|");

/** "three thousand dollars" -> "3000 dollars", "one month" -> "1 month", "a week" -> "1 week". */
function digitsForWords(s: string): string {
  return s
    .replace(new RegExp(String.raw`\b(${WORD_NUM_RE})\s+(hundred|thousand|grand|million)\b`, "g"),
      (_m, w: string, unit: string) => String(WORD_NUM[w] * (unit === "hundred" ? 100 : unit === "million" ? 1_000_000 : 1000)))
    .replace(new RegExp(String.raw`\b(${WORD_NUM_RE})\s+(days?|weeks?|months?|years?)\b`, "g"),
      (_m, w: string, unit: string) => `${WORD_NUM[w]} ${unit}`);
}

/**
 * The number of an amount: "3,000", "3000", "3 000", "3'000", "3.000"
 * (a point before exactly three digits separates thousands: money has two
 * decimals), "2.5" with "k", "2,5" with "k".
 */
function money(raw: string, suffix: string | undefined): number | null {
  const sfx = (suffix ?? "").toLowerCase();
  let t = raw.replace(/[ '’\u00a0\u202f]/g, "");
  if (!sfx && /^[1-9]\d{0,2}(?:\.\d{3})+(?:,\d{1,2})?$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d+,\d{1,2}$/.test(t)) t = t.replace(",", ".");
  else t = t.replace(/,/g, "");
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (sfx === "k" || sfx === "thousand" || sfx === "grand") return n * 1000;
  if (sfx === "m" || sfx === "million") return n * 1_000_000;
  return n;
}

const CUR_PRE = String.raw`us\s*\$|usd|\$|chf|sfr\.?|eur|€|£|gbp`;
const CUR_POST = String.raw`usd|us\s*dollars?|dollars?|bucks|chf|swiss\s+francs?|francs?|euros?|eur|€|£|gbp|pounds?`;
const NUM = String.raw`\d{1,3}(?:[ '’\u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?|\d[\d,.]*\d|\d`;
/** An amount with its optional currency mark and multiplier; use once per pattern (named groups). */
const AMOUNT = String.raw`(?<pre>${CUR_PRE})?\s*(?<num>${NUM})\s*(?<mult>k|thousand|grand|m|million)?\b\s*(?<post>${CUR_POST})?`;

/** Words that put a ceiling in front of an amount. */
const CAP_LEAD = String.raw`(?<![a-z])(?:under|below|beneath|less than|lower than|at most|at the most|max(?:imum)?(?: of)?|no more than|not more than|not (?:to )?exceed(?:ing)?|(?:without|never) (?:exceeding|going (?:over|above|beyond))|within|cap(?:ped)?(?: (?:at|of))?|limit(?:ed)?(?: (?:to|of))?|ceiling of|<=?|≤|down to|reduce(?:d)? to|cut to|lower(?:ed)? to|bring (?:it )?to|up to|not above|not over|no higher than|only have|have only|only got|(?:i|we)(?:'ve| have)(?: got)?(?: only| just)?|can (?:only |just )?(?:spend|afford)|to)`;
/** "under $3,000", "at most a total of 4000 USD", "without exceeding a budget of 5000 dollars", "I only have $3,000" */
const CAP_BEFORE = new RegExp(String.raw`${CAP_LEAD}\s*(?:just\s+|only\s+|about\s+|around\s+|roughly\s+)?(?:an?\s+|the\s+)?(?:(?:total\s+|overall\s+)?(?:budget|total|maximum|max|sum|cost)\s+(?:of\s+)?)?${AMOUNT}`, "g");
/** "the budget should be $3,000", "Total budget: $3,000", "the budget is capped at $5,000", "budget of 5000 dollars" */
const CAP_BUDGET_IS = new RegExp(String.raw`\b(?:budget|spending limit|funding|funds)\b\s*(?:(?:limit|cap|ceiling)\s*)?(?:[:=]\s*|(?:should|must|has to|have to|needs to|need to|can|will|may|shall|cannot|can't|can not)\s+(?:not\s+)?(?:only\s+)?(?:be|stay|remain|exceed|go (?:over|above))\s+|(?:is|are|stays|remains)\s+(?:now\s+|only\s+|just\s+|set (?:at|to)\s+|fixed at\s+|capped at\s+|limited to\s+)?|of\s+|at\s+)?(?:(?:under|below|at most|max(?:imum)?(?: of)?|no more than|up to|only|just|about|around)\s+)?${AMOUNT}`, "g");
/** "$3,000 or less", "$3,000 maximum", "3000 USD at most", "on a $5,000 budget", "$3,000 is the limit" */
const CAP_AFTER = new RegExp(String.raw`${AMOUNT}\s*,?\s*(?<tail>or (?:less|lower|below|under|cheaper)|at (?:the )?most|max(?:imum)?\b|tops\b|(?:total\s+|overall\s+)?budget\b|(?:is|as) (?:the|my|our|a) (?:hard\s+|upper\s+)?(?:limit|max(?:imum)?|cap|ceiling))`, "g");
/** "under $2,000 in total" */
const CAP_IN_TOTAL = new RegExp(String.raw`(?<![a-z])(?:under|below|less than|at most|no more than|within|up to)\s+${AMOUNT}\s+(?:in\s+)?(?:total|overall|altogether|all in)\b`, "g");
/** "on a $5,000 budget" */
const CAP_AMOUNT_BUDGET = new RegExp(String.raw`${AMOUNT}\s+(?<tail>(?:total\s+|overall\s+)?budget\b)`, "g");

/** After a plain number: a unit that makes it a quantity, not money. */
const QUANTITY_UNIT = /^\s*(?:weeks?|wks?|months?|years?|days?|hours?|hrs?|h\b|min(?:ute)?s?\b|sec(?:ond)?s?\b|%|percent|cells?|samples?|mice|rats|animals|wells?|plates?|replicates?|groups?|events?|patients?|participants?|subjects?|per\b|each\b|fold|[uµμ]?[lm]\b|m[lmg]\b|n[mg]\b|[uµμ]g\b|°|rpm\b|bp\b|kb\b|kda\b)/;
/** After an amount: a price per unit, not a total. */
const PER_UNIT = /^\s*(?:per\b|each\b|apiece\b|a piece\b|an?\s+(?:test|sample|kit|unit|assay|reaction|patient|plate|well|run)\b|\/)/;
const TOTAL_WORDS = /\b(?:budget|total|overall|altogether|whole|entire|project|study|experiment|plan|everything|all in|for this|have|got|afford|funding|funds)\b/;
const ITEM_WORDS = /\b(?:antibod(?:y|ies)|kits?|reagents?|primers?|probes?|plates?|assays?|instruments?|microscopes?|equipment|sequencing|samples?|items?|units?|bottles?|vials?|packs?|line items?|materials?|consumables|labou?r|personnel|salar(?:y|ies)|overheads?|travel|animals?|mice|tests?)\b/;
/** Before a pattern: the amount describes what was, not what is asked for. */
const DESCRIBES_PAST = /\b(?:current|currently|present|existing|previous|old|original|initial|earlier|was|were|from)\s+(?:total\s+|overall\s+)?$/;

const OTHER_CURRENCY: Array<[RegExp, string]> = [[/chf|sfr|franc/, "CHF"], [/eur|€/, "EUR"], [/£|gbp|pound/, "GBP"]];

interface BudgetCap { usd: number; currency?: string }

/**
 * The first amount in `s` (lower case) that a pattern marks as a ceiling on
 * the whole budget. `markedOnly` asks for a currency mark (hypotheses also
 * hold plain numbers of every kind); a plain number counts in an instruction
 * when it is at least 100 and stands next to a budget word.
 */
function findBudgetCap(s: string, patterns: RegExp[], markedOnly: boolean): BudgetCap | undefined {
  const found: Array<BudgetCap & { at: number }> = [];
  for (const re of patterns) {
    for (const m of s.matchAll(re)) {
      const g = m.groups ?? {};
      const v = money(g.num ?? "", g.mult);
      if (!v) continue;
      const at = m.index ?? 0;
      const end = at + m[0].length;
      const after = s.slice(end);
      if (PER_UNIT.test(after)) continue;
      if (DESCRIBES_PAST.test(s.slice(0, at))) continue;
      const mark = `${g.pre ?? ""} ${g.post ?? ""}`.trim();
      if (!mark) {
        if (markedOnly) continue;
        const near = s.slice(Math.max(0, at - 30), end + 12);
        if (v < 100 || !/budget|cost|spend|afford|funding|funds/.test(near) || QUANTITY_UNIT.test(after)) continue;
      }
      // "Use an antibody under $300" prices one item: the words around the
      // amount name an item and nothing names the whole. A list in passing
      // ("the total budget, including materials and labour, under $5,000")
      // does not make it an item price.
      const lead = s.slice(0, at).replace(/\b(?:including|incl\.?|inclusive of|covering|counting)\b[^,.;]*,?/g, " ");
      const before = lead.split(/[.;]|\band\b|\bbut\b/).pop() ?? "";
      const tail = (after.split(/[.;,]|\band\b|\bbut\b/)[0] ?? "").slice(0, 40);
      const around = `${before} ${m[0]} ${tail}`;
      if (ITEM_WORDS.test(around) && !TOTAL_WORDS.test(around)) continue;
      const currency = OTHER_CURRENCY.find(([cur]) => cur.test(mark))?.[1];
      found.push({ usd: v, ...(currency ? { currency } : {}), at });
    }
  }
  if (!found.length) return undefined;
  const first = found.reduce((a, b) => (b.at < a.at ? b : a));
  return { usd: first.usd, ...(first.currency ? { currency: first.currency } : {}) };
}

const CUT_VERB = String.raw`(?:reduce|cut|lower|decrease|trim|slash|shrink|drop|bring down)`;
const BUDGET_WORD = String.raw`(?:budget|costs?|spend(?:ing)?|price)`;
const TIME_WORD = String.raw`(?:timeline|schedule|duration|time)`;
const WHOLE = String.raw`(?:the\s+)?(?:total\s+|overall\s+|whole\s+|entire\s+)?`;
const negated = (s: string, at: number) => /(?:\b(?:without|not|never|no)|n't)\s+(?:\w+\s+)?$/.test(s.slice(0, at));

/**
 * The share of the refined plan's figure an instruction asks for: "cut the
 * budget by 30%" 0.7, "halve the budget" / "cut the budget in half" 0.5,
 * "reduce the budget to 60%" 0.6, "30% cheaper" 0.7, "by a third" 2/3.
 * `word` is BUDGET_WORD or TIME_WORD; `comparative` the words after
 * "30%" ("cheaper", "faster").
 */
function askedShare(s: string, word: string, comparative: string): number | undefined {
  const noun = `${WHOLE}${word}`;
  const share = (m: RegExpMatchArray | null, f: (m: RegExpMatchArray) => number): number | undefined => {
    if (!m || negated(s, m.index ?? 0)) return undefined;
    const v = f(m);
    return v > 0 && v < 1 ? v : undefined;
  };
  const pctOf = (m: RegExpMatchArray) => Number(m[1]) / 100;
  // [wording, share that is cut]
  const fractions: Array<[string, number]> = [
    ["(?:a\\s+|one\\s+)?half", 0.5], ["(?:a|one) third", 1 / 3], ["two thirds", 2 / 3], ["(?:a|one) quarter", 0.25], ["three quarters", 0.75],
  ];
  const first = (list: Array<number | undefined>) => list.find((v) => v !== undefined);
  return share(s.match(new RegExp(String.raw`\b${CUT_VERB}\s+${noun}\s+by\s+(\d+(?:\.\d+)?)\s*(?:%|percent)`)), (m) => 1 - pctOf(m))
    ?? share(s.match(new RegExp(String.raw`\b(\d+(?:\.\d+)?)\s*(?:%|percent)\s+(?:${comparative})\b`)), (m) => 1 - pctOf(m))
    ?? share(s.match(new RegExp(String.raw`\b${CUT_VERB}\s+${noun}\s+to\s+(\d+(?:\.\d+)?)\s*(?:%|percent)`)), pctOf)
    ?? share(s.match(new RegExp(String.raw`\b(?:halve|halving)\s+${noun}\b|\b${CUT_VERB}\s+${noun}\s+in\s+half\b|\bhalf\s+(?:of\s+)?(?:the\s+|its\s+)?(?:current\s+|original\s+|previous\s+)?${word}\b|\bhalf as (?:much|expensive|long)\b`)), () => 0.5)
    ?? first(fractions.map(([w, cut]) => share(s.match(new RegExp(String.raw`\b${CUT_VERB}\s+${noun}\s+by\s+${w}\b`)), () => 1 - cut)))
    ?? first(fractions.map(([w, cut]) => share(s.match(new RegExp(String.raw`\b${CUT_VERB}\s+${noun}\s+to\s+${w}\b`)), () => cut)));
}

/**
 * Whether the instruction asks for a lower budget without naming a figure:
 * "reduce the budget", "make it cheaper", "a cheaper version". "Use a
 * cheaper antibody" and "reduce the cost of the staining" are about one item.
 */
function asksLowerBudget(s: string): boolean {
  const whole = String.raw`(?:it|this|that|the\s+(?:plan|study|experiment|project|whole thing))`;
  const cheaper = String.raw`(?:cheaper|less expensive|less costly|more affordable)`;
  const m = s.match(new RegExp(String.raw`\b${CUT_VERB}\s+${WHOLE}${BUDGET_WORD}\b(?!\s+(?:of|for|per)\s+(?!the\s+(?:plan|study|experiment|project|whole)))|\bmake\s+${whole}\s+(?:\w+\s+){0,3}?${cheaper}\b|\b${cheaper}\s+(?:plan|version|design|study|experiment|overall|in total)\b|\bsave (?:money|costs?)\b|\b(?:cost|spend) less\b|\blower[- ]budget\b`));
  return !!m && !negated(s, m.index ?? 0);
}

const WEEKS_PER_UNIT: Record<string, number> = { day: 1 / 7, week: 1, wk: 1, month: 4.345, year: 52.18 };

/**
 * Numeric limits a refinement instruction asks for (budget cap, timeline
 * cap). `parentTotal` (the refined plan's budget) turns "cut the budget by
 * 30%" and "halve the budget" into an absolute cap, and "make it cheaper"
 * into "lower than the plan it refines"; `parentWeeks` does the same for
 * "halve the timeline".
 */
export function parseRefinementConstraints(
  instruction: string | null | undefined,
  parentTotal?: number,
  parentWeeks?: number,
): RefinementConstraints {
  const out: RefinementConstraints = {};
  const s = digitsForWords((instruction ?? "").toLowerCase());
  if (!s) return out;
  const share = parentTotal && parentTotal > 0
    ? askedShare(s, BUDGET_WORD, "cheaper|less expensive|less costly|lower (?:budget|costs?)|less (?:budget|money|cost)")
    : undefined;
  if (share !== undefined && parentTotal) out.max_budget_usd = Math.round(parentTotal * share);
  if (out.max_budget_usd === undefined) {
    const cap = findBudgetCap(s, [CAP_BEFORE, CAP_BUDGET_IS, CAP_AFTER, CAP_IN_TOTAL], false);
    if (cap) {
      out.max_budget_usd = cap.usd;
      if (cap.currency) out.budget_currency = cap.currency;
    }
  }
  if (out.max_budget_usd === undefined && parentTotal && parentTotal > 0 && asksLowerBudget(s)) {
    out.lower_budget_than_usd = parentTotal;
  }
  const timeShare = parentWeeks && parentWeeks > 0 ? askedShare(s, TIME_WORD, "faster|shorter|quicker") : undefined;
  if (timeShare !== undefined && parentWeeks) out.max_timeline_weeks = Math.round(parentWeeks * timeShare * 100) / 100;
  if (out.max_timeline_weeks === undefined && /\b(?:timeline|schedule|duration|deadline|weeks?|months?|days?|finish|complete|shorten|faster)\b/.test(s)) {
    const DUR = String.raw`(\d+(?:\.\d+)?)\s*(days?|weeks?|wks?|months?|years?)\b`;
    const t = s.match(new RegExp(String.raw`(?<![a-z])(?:to|into|within|under|in|at most|no more than|max(?:imum)?(?: of)?|less than|shorter than|limit(?:ed)? to|fit (?:into|in)|only have|have only|(?:i|we)(?:'ve| have)(?: got)?(?: only| just)?)\s*${DUR}`))
      ?? s.match(new RegExp(String.raw`${DUR}\s*,?\s*(?:or (?:less|shorter|faster)|at (?:the )?most|max(?:imum)?\b|tops\b)`))
      ?? s.match(new RegExp(String.raw`\b(?:timeline|schedule|duration|deadline)\b\s*(?:[:=]\s*|(?:should|must|has to|needs to|can|will|may)\s+(?:not\s+)?(?:only\s+)?(?:be|take|last|exceed)\s+|(?:is|of)\s+(?:now\s+|only\s+|just\s+)?)(?:(?:under|at most|no more than|up to|only|just)\s+)?${DUR}`));
    if (t) {
      // A cap on the whole plan, not a change to one part of it: "Extend the
      // treatment to 2 weeks" and "Shorten the staining to 2 days" say
      // nothing about the timeline's total.
      const clause = s.slice(0, t.index ?? 0).split(/[.;]/).pop() ?? "";
      const whole = /\b(?:timeline|schedule|deadline|project|study|overall|whole|entire|experiment|plan|total|everything|all)\b/.test(`${clause} ${t[0]}`);
      const lengthens = /\b(?:extend\w*|lengthen\w*|prolong\w*|increas\w*|at least|minimum|no less than)\b/.test(clause);
      const partOnly = /\b(?:treat\w*|incubat\w*|expos\w*|differentiat\w*|cultur\w*|stain\w*|step|phase|washout|recover\w*|fasting|dosing|stimulat\w*|induc\w*|challenge|starv\w*|pre-?treat\w*|follow-?up)\b/.test(clause);
      const dur = t.slice(1).filter((x) => x !== undefined);
      const unit = dur[1].replace(/s$/, "");
      const w = Number(dur[0]) * (WEEKS_PER_UNIT[unit] ?? 0);
      if (w > 0 && !lengthens && (whole || !partOnly)) out.max_timeline_weeks = Math.round(w * 100) / 100;
    }
  }
  return out;
}

/**
 * A budget cap the hypothesis itself states ("with a total budget under
 * $5,000", "the budget is capped at $5,000", "without exceeding a budget of
 * 5000 dollars", "for under $2,000 in total", "on a $5,000 budget"). Only
 * explicit budget wording with a currency mark counts: "reduces the cost to
 * under $5 per test" is the outcome, not a cap.
 */
export function hypothesisBudgetCap(hypothesis: string | null | undefined): number | undefined {
  const s = digitsForWords((hypothesis ?? "").toLowerCase());
  if (!s) return undefined;
  return findBudgetCap(s, [CAP_BUDGET_IS, CAP_IN_TOTAL, CAP_AMOUNT_BUDGET], true)?.usd;
}

/** "Materials $2,030, Labour $1,000, Overhead $1,000": the line items, for findings about the total. */
function lineItemSummary(budget: BudgetShape | undefined): string {
  const items = (budget?.line_items ?? []).filter((li) => Number(li?.amount_usd) > 0 && !/^\s*total\b/i.test(li?.category ?? ""));
  return items.map((li) => `${li.category ?? "item"} ${usd(Number(li.amount_usd))}`).join(", ");
}

/** Sum of the timeline phase durations, in weeks (0 when nothing parses). */
export function timelineWeeks(timeline: { duration?: string }[] | undefined): number {
  if (!Array.isArray(timeline)) return 0;
  const hours = timeline.reduce((s, p) => s + parseDurationToHours(p?.duration), 0);
  return Math.round((hours / 168) * 10) / 10;
}

// --- materials ---------------------------------------------------------------

interface MaterialLike extends MaterialWithCatalog { name?: string; notes?: string; total_cost_usd?: number | string | null }

function itemKey(name: string): string {
  return name.toLowerCase().replace(/\(.*?\)/g, " ").replace(/,.*$/, "").replace(/[^\p{L}\p{N}/ -]+/gu, " ")
    .replace(/\s+/g, " ").trim();
}

/** Materials that are catalog items from topic groups that do not fit the hypothesis. */
export function catalogCopies(materials: MaterialLike[] | undefined, hypothesis: string): string[] {
  if (!Array.isArray(materials)) return [];
  const fitting = new Set(relevantCatalogGroups(hypothesis).map((g) => g.id));
  // Each foreign catalog item as the set of its words ("taq polymerase" ->
  // {taq, polymerase}); a material matches when it contains all of them, so
  // "Taq DNA Polymerase (NEB M0273)" matches "Taq polymerase (500 U)".
  const foreign: string[][] = [];
  for (const g of CATALOG_GROUPS) {
    if (fitting.has(g.id) || !g.keywords) continue;
    for (const item of Object.keys(g.items)) {
      const words = itemKey(item).split(" ").filter((w) => w.length >= 2 && !ITEM_FILLER.has(w));
      // Skip short one-word staples (PBS, FBS, DMEM): too common to say anything.
      if (words.length >= 2 || (words.length === 1 && words[0].length >= 5)) foreign.push(words);
    }
  }
  const out: string[] = [];
  for (const m of materials) {
    const words = new Set(itemKey(m?.name ?? "").split(" "));
    if (foreign.some((k) => k.every((w) => words.has(w)))) out.push(m?.name ?? "");
  }
  return out;
}

// Words in catalog item names that say nothing about the item itself.
const ITEM_FILLER = new Set([
  "per", "kit", "case", "of", "the", "amortised", "month", "shared", "core", "hour", "sample",
  "molecular", "grade", "sterile", "qualified", "single-target", "10x", "100x", "0.25%",
]);

// --- orchestrator --------------------------------------------------------------

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function fmtHours(h: number): string {
  if (h >= 168) return `${Math.round((h / 168) * 10) / 10} weeks`;
  if (h >= 72) return `${Math.round((h / 24) * 10) / 10} days`;
  if (h >= 1) return `${Math.round(h * 10) / 10} h`;
  return `${Math.round(h * 60)} min`;
}

interface BudgetShape {
  currency?: string;
  line_items?: { category?: string; amount_usd?: number | string | null; note?: string }[];
  total_usd?: number | string | null;
}

/** The parts of a plan the guards read; everything else is passed through. */
export interface PlanShape {
  protocol?: { title?: string; description?: string; source?: string; duration?: string }[];
  materials?: MaterialLike[];
  budget?: BudgetShape;
  timeline?: { duration?: string }[];
  verification?: PlanVerification;
  [key: string]: unknown;
}

// "... were removed (for example https://www.biorxiv.org/...)." Until 9 Nov
// 2026 (QA round 2) the note quoted the first removed source, so the
// invented link it had just removed was shown again in the checks box and
// the PDF. The removed sources stay in verification.sources (not shown).
export function withoutRemovedExample(detail: string): string {
  return detail.replace(/ \(for example [\s\S]*\)(?=\.$)/, "");
}

/**
 * Notes from an earlier verification of the same plan that a new pass can no
 * longer see: a cached plan was corrected when it was first saved (sources
 * removed, total set to the line-item sum), so re-checking it finds nothing
 * to correct, and its copy for another user used to lose those notes.
 */
function carryOver(prev: PlanVerification | undefined, issues: PlanIssue[]): void {
  if (!prev || !Array.isArray(prev.issues)) return;
  for (const old of prev.issues) {
    if (!old || !FIXED_KINDS.has(old.kind) || issues.some((i) => i.kind === old.kind)) continue;
    issues.push(old.kind === "unverified_sources_removed" ? { ...old, detail: withoutRemovedExample(old.detail) } : old);
  }
}

/**
 * Run every deterministic guard on a plan. Returns a copy of the plan with
 * sources, the budget, wrong catalog numbers fixed and `verification`
 * attached.
 */
export function verifyPlan(
  input: unknown,
  ctx: {
    hypothesis: string;
    references: RefLike[];
    refinementInstruction?: string | null;
    /** The plan being refined (for limits relative to it, e.g. "cut the budget by 30%"). */
    parentPlan?: unknown;
    /** Live supplier-catalog findings for this plan's materials (skuVerify.ts), when they were looked up. */
    liveSku?: LiveSkuFinding[];
    /**
     * True for a plan as the model just wrote it. Its `verification` and the
     * catalog status of its materials are then ignored: only this function
     * writes them, and a model that adds "catalog_status": "verified" to its
     * own invented number must not be believed. Leave it out for a plan this
     * pipeline checked before (a cached copy): the notes of that check carry over.
     */
    fresh?: boolean;
  },
): { plan: PlanShape; verification: PlanVerification } {
  const plan: PlanShape = input && typeof input === "object" ? { ...(input as PlanShape) } : {};
  if (ctx.fresh) delete plan.verification;
  const prev = plan.verification && typeof plan.verification === "object" && Array.isArray(plan.verification.issues)
    ? plan.verification
    : undefined;
  const issues: PlanIssue[] = [];

  // 1) Protocol sources: only retrieved references (or a plain label) survive.
  const { steps, report } = sanitizeStepSources(plan.protocol, ctx.references);
  if (Array.isArray(plan.protocol)) plan.protocol = steps;
  if (report.removed > 0 || report.links_removed > 0) {
    issues.push({
      kind: "unverified_sources_removed",
      severity: "medium",
      detail: `${report.removed + report.links_removed} protocol source(s) cited papers or links that the literature search did not return and were removed.`,
    });
  }

  // 2) Catalog numbers: wrong ones (another product, the wrong format, a
  //    placeholder) are removed before anyone can order them, a listed ATCC
  //    cell line gets ATCC's number, and every other number is marked
  //    verified or unverified (planContentChecks.checkCatalogNumbers).
  if (Array.isArray(plan.materials)) {
    const cat = checkCatalogNumbers(plan.materials, ctx.liveSku ?? [], { keepEarlier: !!prev });
    plan.materials = cat.materials;
    // Numbers written into protocol steps are not in the table, so nothing
    // checked them: they are taken out of the step text unless the table
    // confirmed the same number.
    const verifiedNumbers = cat.materials.filter((m) => m.catalog_status === "verified" && m.catalog_number).map((m) => String(m.catalog_number));
    const inSteps = stripStepCatalogNumbers(plan.protocol, verifiedNumbers);
    if (inSteps.removed.length > 0 && Array.isArray(plan.protocol)) plan.protocol = inSteps.steps;
    if (cat.removed.length > 0 || inSteps.removed.length > 0) {
      const fromTable = cat.removed.length > 0
        ? `${cat.removed.length} catalog number(s) were removed because they belong to another product, do not fit the supplier's format or look made up: ${cat.removed.slice(0, 4).map((r) => `${r.catalog_number} for ${r.name} (${r.why})`).join("; ")}.`
        : "";
      const fromSteps = inSteps.removed.length > 0
        ? `${inSteps.removed.length} catalog number(s) written into protocol steps were taken out of the text (${inSteps.removed.slice(0, 4).map((r) => `${r.catalog_number} in step ${r.step}`).join(", ")}): only numbers in the materials table are checked against a catalogue.`
        : "";
      issues.push({ kind: "catalog_numbers_removed", severity: "medium", detail: [fromTable, fromSteps].filter(Boolean).join(" ") });
    }
    if (cat.corrected.length > 0) {
      issues.push({
        kind: "catalog_numbers_corrected",
        severity: "medium",
        detail: `${cat.corrected.length} catalog number(s) were set from the app's ATCC cell-line list: ${cat.corrected.slice(0, 4).map((c) => `${c.to} for ${c.name}${c.from ? ` (was ${c.from})` : ""}`).join("; ")}.`,
      });
    }
    if (cat.unverified.length > 0) {
      issues.push({
        kind: "catalog_numbers_unverified",
        severity: "medium",
        detail: `${cat.unverified.length} catalog number(s) could not be confirmed in a supplier catalogue and are marked unverified; check them before ordering: ${cat.unverified.slice(0, 4).map((u) => `${u.catalog_number} for ${u.name} (${u.why})`).join("; ")}.`,
      });
    }
  }

  // 3) Budget: the materials line covers the materials table, and the total
  //    is the sum of the line items.
  let budgetOut: PlanVerification["budget"] = null;
  if (plan.budget && typeof plan.budget === "object") {
    const materialsTable: MaterialLike[] = Array.isArray(plan.materials) ? plan.materials : [];
    const { budget: withMaterials, change } = reconcileMaterialsLine(plan.budget, materialsTable);
    if (change) {
      issues.push({
        kind: "materials_line_corrected",
        severity: "medium",
        detail: `The budget line "${change.category}" (${usd(change.stated)}) was lower than the materials table subtotal (${usd(change.table)}); it now shows the subtotal, and the total includes it.`,
      });
    }
    const { budget, check } = reconcileBudget(withMaterials);
    plan.budget = budget;
    if (check) {
      // A plan checked before (a cached copy, an older plan) carries the
      // total its model wrote in verification.budget; its total_usd is
      // already the earlier corrected sum.
      const earlier = prev?.budget?.corrected ? prev.budget.stated_total : undefined;
      const stated = earlier !== undefined ? earlier : check.stated_total;
      const differs = check.mismatch || (stated !== null && Math.abs(stated - check.line_item_sum) > 1);
      budgetOut = { stated_total: stated, line_item_sum: check.line_item_sum, corrected: differs };
      if (differs) {
        issues.push({
          kind: "budget_total_corrected",
          severity: "medium",
          detail: change
            ? `The model's budget total (${stated === null ? "missing" : usd(stated)}) did not equal the sum of its line items with the corrected materials line (${usd(check.line_item_sum)}); the total now shows the sum.`
            : `The model's budget total (${stated === null ? "missing" : usd(stated)}) did not equal the sum of its line items (${usd(check.line_item_sum)}); the total now shows the sum.`,
        });
      }
    }
    // A materials line far above the table may pay for unlisted items: flag it.
    const matSum = materialsSubtotal(materialsTable);
    const costLines = costLineItems(plan.budget.line_items);
    const matLines = costLines.filter((li) => MATERIALS_LINE_RE.test(li?.category ?? ""));
    const matLinesSum = matLines.reduce((s, li) => s + (Number(li?.amount_usd) || 0), 0);
    if (!change && matSum > 0 && matLines.length > 0 && matLinesSum > matSum * 1.33) {
      issues.push({
        kind: "materials_subtotal_mismatch",
        severity: "medium",
        detail: `The budget line "${matLines[0].category ?? "materials"}" (${usd(matLinesSum)}${matLines.length > 1 ? ` over ${matLines.length} lines` : ""}) is well above the materials table subtotal (${usd(matSum)}); the difference is not itemised.`,
      });
    }
    // A costing has more than the shopping list: labour at least. Run
    // 42c080d0 budgeted its five materials and nothing else.
    const otherLines = costLines.filter((li) => !MATERIALS_LINE_RE.test(li?.category ?? "") && Number(li?.amount_usd) > 0);
    if (matLines.length > 0 && otherLines.length === 0) {
      const team = Array.isArray(plan.team) ? plan.team as { fte?: number | string }[] : [];
      const fte = Math.round(team.reduce((s, t) => s + (Number(t?.fte) || 0), 0) * 100) / 100;
      issues.push({
        kind: "budget_materials_only",
        severity: "high",
        detail: `The budget lists materials only (${usd(Number(plan.budget.total_usd) || 0)}): no labour, equipment or overhead${fte > 0 ? `, although the plan names a team of ${team.length} (${fte} FTE)` : ""}.`,
      });
    }
  }

  // 4) Materials must belong to this experiment.
  const materials: MaterialLike[] = Array.isArray(plan.materials) ? plan.materials : [];
  const copied = catalogCopies(materials, ctx.hypothesis);
  if (copied.length > 0) {
    issues.push({
      kind: "catalog_items_copied",
      severity: "medium",
      detail: `Materials that match cost-catalog examples from a topic this hypothesis does not mention (copied from the price list?): ${copied.slice(0, 6).join(", ")}.`,
    });
  }
  if (materials.length > 0 && materials.every((m) => !(Number(m?.total_cost_usd) > 0))) {
    issues.push({
      kind: "materials_unpriced",
      severity: "medium",
      detail: "No material has a cost, so the materials budget is not grounded in the materials list.",
    });
  }
  const odd = unlikelySuppliers(materials);
  if (odd.length > 0) {
    issues.push({
      kind: "supplier_unlikely",
      severity: "medium",
      detail: `Supplier unlikely for: ${odd.slice(0, 4).map((o) => `"${o.name}" from ${o.label}`).join("; ")}.`,
    });
  }
  if (materials.length > 0) {
    const offTopic = materialsOffTopic(materials, ctx.hypothesis);
    if (offTopic) issues.push({ kind: "materials_off_topic", severity: "high", detail: offTopic });
  }

  // 5) The protocol: steps that say what to do, at the hypothesis' doses,
  //    within the timeline.
  const listSteps = materialListSteps(plan.protocol);
  if (listSteps) {
    issues.push({
      kind: "protocol_steps_not_actions",
      severity: "high",
      detail: `${listSteps.steps.length} of ${listSteps.total} protocol steps list materials instead of saying what to do (steps ${listSteps.steps.join(", ")}; for example "${listSteps.example}").`,
    });
  }
  for (const d of doseIssues(ctx.hypothesis, plan.protocol)) {
    issues.push({
      kind: "dose_changed",
      severity: "high",
      detail: `The hypothesis tests ${d.label ?? d.substance} at ${d.hypothesis}; the protocol uses ${d.plan.join(", ")}.`,
    });
  }
  const dil = dilutionIssues(plan.protocol);
  if (dil.length > 0) {
    issues.push({
      kind: "dilution_inconsistent",
      severity: "medium",
      detail: `Dilution arithmetic does not give the stated concentration: ${dil.slice(0, 3).map((d) => `step ${d.step}, ${d.dilution} gives about ${d.computed}, not ${d.stated}`).join("; ")}.`,
    });
  }
  const readout = readoutMissing(ctx.hypothesis, plan.protocol);
  if (readout) {
    issues.push({
      kind: "readout_missing",
      severity: "high",
      detail: `The hypothesis is measured by ${readout.phrase}, but no protocol step does that measurement.`,
    });
  }
  const compartment = compartmentMismatch(ctx.hypothesis, plan.protocol);
  if (compartment) issues.push({ kind: "readout_compartment", severity: "medium", detail: compartment });
  if (materials.length > 0) {
    const missing = missingMaterials(ctx.hypothesis, plan.protocol, materials);
    if (missing.required.length > 0) {
      issues.push({
        kind: "materials_missing",
        severity: "high",
        detail: `The protocol uses ${missing.required.join(", ")}, but the materials table does not list ${missing.required.length === 1 ? "it" : "them"}${missing.other.length ? ` (nor ${missing.other.slice(0, 5).join(", ")})` : ""}.`,
      });
    } else if (missing.other.length > 0) {
      issues.push({
        kind: "materials_incomplete",
        severity: "medium",
        detail: `The protocol uses ${missing.other.slice(0, 6).join(", ")}, which the materials table does not list or price.`,
      });
    }
  }
  const stepDur = stepDurationIssues(plan.protocol, parseDurationToHours);
  if (stepDur) {
    issues.push({
      kind: "step_durations_inconsistent",
      severity: "medium",
      detail: `Step${stepDur.steps.length === 1 ? "" : "s"} ${stepDur.steps.join(", ")} ${stepDur.steps.length === 1 ? "has" : "have"} a duration of "${stepDur.duration}", far longer than the ${fmtHours(stepDur.text_hours)} of work ${stepDur.steps.length === 1 ? "its" : "their"} text describes.`,
    });
  }
  const timelineIssue = checkTimelineConsistency(plan.protocol, plan.timeline);
  if (timelineIssue) {
    issues.push({ kind: "protocol_exceeds_timeline", severity: "medium", detail: timelineIssue.detail });
  }

  // 6) Limits: a budget cap the hypothesis states, and the refinement's limits.
  const total = Number(plan.budget?.total_usd) || 0;
  const overBy = (cap: number) => `this plan totals ${usd(total)}${lineItemSummary(plan.budget) ? ` (${lineItemSummary(plan.budget)})` : ""}, ${usd(total - cap)} over`;
  const hypCap = hypothesisBudgetCap(ctx.hypothesis);
  if (hypCap !== undefined && plan.budget && total > hypCap * 1.01) {
    issues.push({
      kind: "budget_cap_not_met",
      severity: "high",
      detail: `The hypothesis sets a budget of at most ${usd(hypCap)}; ${overBy(hypCap)}.`,
    });
  }
  // The refinement's own limits and those of earlier refinements in the
  // chain that it does not replace (effectiveConstraints).
  const constraints = effectiveConstraints(ctx.refinementInstruction, ctx.parentPlan);
  const asked = (which: "budget" | "timeline") => constraints.inherited?.includes(which)
    ? "An earlier refinement of this plan asked for"
    : "The refinement asked for";
  if (constraints.max_budget_usd !== undefined && plan.budget) {
    if (total > constraints.max_budget_usd * 1.01) {
      // "CHF 3,000": the plan is costed in US dollars, so the number is compared as dollars, and the finding says so.
      const cap = constraints.budget_currency
        ? `${constraints.budget_currency} ${constraints.max_budget_usd.toLocaleString("en-US")} (compared here as ${usd(constraints.max_budget_usd)}, because the plan is costed in US dollars)`
        : usd(constraints.max_budget_usd);
      issues.push({
        kind: "refinement_budget_not_met",
        severity: "high",
        detail: `${asked("budget")} a budget of at most ${cap}; ${overBy(constraints.max_budget_usd)}.`,
      });
    }
  } else if (constraints.lower_budget_than_usd !== undefined && plan.budget && total > constraints.lower_budget_than_usd * 0.99) {
    // "Make it cheaper", "reduce the budget": no figure, but the total has to come down.
    issues.push({
      kind: "refinement_budget_not_met",
      severity: "high",
      detail: `The refinement asked for a lower budget; this plan totals ${usd(total)}${lineItemSummary(plan.budget) ? ` (${lineItemSummary(plan.budget)})` : ""}, which is not below the ${usd(constraints.lower_budget_than_usd)} of the plan it refines.`,
    });
  }
  if (constraints.max_timeline_weeks !== undefined) {
    const weeks = timelineWeeks(plan.timeline);
    const stepWeeks = Array.isArray(plan.protocol)
      ? Math.round((plan.protocol.reduce((s, p) => s + parseDurationToHours(p?.duration), 0) / 168) * 10) / 10
      : 0;
    if (weeks > constraints.max_timeline_weeks * 1.05) {
      issues.push({
        kind: "refinement_timeline_not_met",
        severity: "high",
        detail: `${asked("timeline")} a timeline of at most ${constraints.max_timeline_weeks} weeks; the phases add up to ${weeks} weeks.`,
      });
    } else if (stepWeeks > constraints.max_timeline_weeks * 1.5) {
      // Run 69a412a9 (QA round 3): phases of 1 + 1 weeks, but five protocol
      // steps of "2 weeks" each.
      issues.push({
        kind: "refinement_timeline_not_met",
        severity: "high",
        detail: `${asked("timeline")} a timeline of at most ${constraints.max_timeline_weeks} weeks; the phases fit, but the protocol step durations add up to ${stepWeeks} weeks.`,
      });
    }
  }

  // 7) Corrections an earlier pass made on this plan (cached copies).
  carryOver(prev, issues);
  const prevBudget = prev?.budget;
  if (prevBudget?.corrected && !budgetOut?.corrected) {
    budgetOut = { stated_total: prevBudget.stated_total, line_item_sum: budgetOut?.line_item_sum ?? prevBudget.line_item_sum, corrected: true };
  }
  const sources: SourceReport = report.removed + report.links_removed === 0 && prev?.sources
    && (prev.sources.removed > 0 || prev.sources.links_removed > 0)
    ? { ...report, removed: prev.sources.removed, links_removed: prev.sources.links_removed, removed_examples: prev.sources.removed_examples ?? [] }
    : report;

  const verification: PlanVerification = {
    version: 2,
    pipeline_version: PIPELINE_VERSION,
    sources,
    budget: budgetOut,
    ...(Object.keys(constraints).length ? { refinement: constraints } : {}),
    issues,
  };
  plan.verification = verification;
  return { plan, verification };
}

/**
 * Whether the materials leave out what the hypothesis is about: its anchor
 * concepts (cell line or organism, compound or intervention, named
 * measurands; hypothesisTerms.ts). The materials must name at least 40% of
 * their weight. Until 9 Nov 2026 one shared word passed: a metformin /
 * palmitate / HepG2 plan without any of the three passed on "Oil Red O"
 * (run a60e2fa8). Without anchors, any specific shared term still counts.
 * Returns the finding's text, or null.
 */
export function materialsOffTopic(materials: MaterialLike[], hypothesis: string): string | null {
  const text = materials.map((m) => `${m?.name ?? ""} ${m?.notes ?? ""}`).join(" ");
  const anchors = anchorConcepts(hypothesisConcepts(hypothesis));
  if (anchors.length > 0) {
    const words = textWords(text);
    const total = anchors.reduce((s, c) => s + c.weight, 0);
    const named = anchors.filter((c) => mentions(words, c));
    const share = named.reduce((s, c) => s + c.weight, 0) / total;
    if (share >= 0.4) return null;
    const missing = anchors.filter((c) => !named.includes(c)).map((c) => c.query);
    return `The materials do not name what the hypothesis is about: ${missing.slice(0, 5).join(", ")} ${missing.length === 1 ? "is" : "are"} missing.`;
  }
  const hTerms = keyTerms(hypothesis);
  const mTerms = keyTerms(text);
  if (hTerms.size > 0 && sharedTerms(hTerms, mTerms).length === 0) {
    return `No material mentions anything specific to the hypothesis (${[...hTerms].slice(0, 6).join(", ")}).`;
  }
  return null;
}

/** Pre-check lines for the reviewer critique: open findings only, high severity first. */
export function verificationIssueLines(v: PlanVerification): string[] {
  return v.issues.filter((i) => !FIXED_KINDS.has(i.kind))
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1))
    .map((i) => `- ${i.detail}`);
}

/** Hard limits from a refinement instruction, as planner prompt text. */
export function refinementConstraintPrompt(c: RefinementConstraints): string {
  const lines: string[] = [];
  if (c.max_budget_usd !== undefined) {
    lines.push(`- budget.total_usd MUST be at most ${c.max_budget_usd} USD${c.budget_currency ? ` (the instruction says ${c.budget_currency}; this plan is costed in USD, so use the same number in USD)` : ""}${c.inherited?.includes("budget") ? " (a limit from an earlier refinement that still holds)" : ""}, and the line items must add up to it. Cut scope, FTE, duration or quantities to get there.`);
  } else if (c.lower_budget_than_usd !== undefined) {
    lines.push(`- budget.total_usd MUST be clearly lower than the previous plan's ${c.lower_budget_than_usd} USD, and the line items must add up to it. Cut scope, FTE, duration or quantities to get there.`);
  }
  if (c.max_timeline_weeks !== undefined) {
    lines.push(`- The timeline phases MUST add up to at most ${c.max_timeline_weeks} weeks in total${c.inherited?.includes("timeline") ? " (a limit from an earlier refinement that still holds)" : ""}. Write phase durations in weeks.`);
  }
  return lines.length ? `\nHARD LIMITS FROM THE REFINEMENT (the plan is rejected if it breaks them):\n${lines.join("\n")}` : "";
}

// --- previous plan for a refinement -------------------------------------------

type Loose = Record<string, unknown>;
const arr = (v: unknown): Loose[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") as Loose[] : []);
const pick = (o: Loose, keys: string[]): Loose => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

/**
 * The plan being refined, as prompt text of at most `maxChars`. The whole
 * JSON when it fits; otherwise a digest that keeps every section (step
 * titles and durations, material names and costs, budget line items and
 * total, timeline phases, team) instead of the first `maxChars` characters,
 * which used to end before the budget and timeline.
 */
export function planDigest(
  plan: unknown,
  maxChars: number,
  /**
   * Leave out the numbers a refinement limit rules out. Seen with qwen2.5:3b
   * (run f6ad46e3, "keep the total budget under $3,000"): the model copied
   * the previous plan's $17,355 budget line by line.
   */
  omit: { budget?: boolean; durations?: boolean } = {},
): string {
  // The previous plan's own check results are not part of the plan.
  const p = { ...((plan && typeof plan === "object" ? plan : {}) as Loose) };
  delete p.verification;
  if (omit.budget) {
    // Budget amounts only: without material prices (first try) the model
    // priced every material at $0 (run 6140bde5).
    const b = (p.budget && typeof p.budget === "object" ? p.budget : {}) as Loose;
    p.budget = { line_items: arr(b.line_items).map((li) => pick(li, ["category"])), total_usd: "(to be revised)" };
  }
  if (omit.durations) {
    p.timeline = arr(p.timeline).map((t) => ({ ...t, duration: "(to be revised)" }));
    p.protocol = arr(p.protocol).map((s) => ({ ...s, duration: "(to be revised)" }));
  }
  const full = JSON.stringify(p);
  if (full.length <= maxChars) return full;
  const budget = (p.budget && typeof p.budget === "object" ? p.budget : {}) as Loose;
  const sd = (p.statistical_design && typeof p.statistical_design === "object" ? p.statistical_design : {}) as Loose;
  const digest: Loose = {
    title: p.title,
    protocol: arr(p.protocol).map((s) => pick(s, ["step", "title", "duration"])),
    materials: arr(p.materials).map((m) => pick(m, ["name", "quantity", "total_cost_usd"])),
    budget: { line_items: arr(budget.line_items).map((li) => pick(li, ["category", "amount_usd"])), total_usd: budget.total_usd },
    timeline: arr(p.timeline).map((t) => pick(t, ["phase", "duration"])),
    team: arr(p.team).map((t) => pick(t, ["role", "fte"])),
    statistical_design: pick(sd, ["n_per_group", "groups", "primary_test"]),
    summary: typeof p.summary === "string" ? p.summary.slice(0, 300) : undefined,
  };
  let out = JSON.stringify(digest);
  if (out.length > maxChars) {
    delete digest.summary;
    delete digest.statistical_design;
    out = JSON.stringify(digest);
  }
  return out.length > maxChars ? out.slice(0, maxChars) : out;
}
