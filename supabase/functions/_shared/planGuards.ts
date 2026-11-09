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

import { reconcileBudget, sanitizeStepSources, type RefLike, type SourceReport } from "./planIntegrity.ts";
import { CATALOG_GROUPS, relevantCatalogGroups } from "./costCatalog.ts";
import { parseDurationToHours } from "./timelineCheck.ts";

export interface PlanIssue {
  kind:
    | "budget_total_corrected"
    | "materials_subtotal_mismatch"
    | "materials_off_topic"
    | "catalog_items_copied"
    | "refinement_budget_not_met"
    | "refinement_timeline_not_met"
    | "unverified_sources_removed";
  severity: "high" | "medium";
  detail: string;
}

export interface PlanVerification {
  version: 1;
  sources: SourceReport;
  budget: { stated_total: number | null; line_item_sum: number; corrected: boolean } | null;
  refinement?: RefinementConstraints;
  issues: PlanIssue[];
  /** Set when the plan was regenerated once because of a repairable finding. */
  repair?: { attempted: PlanIssue["kind"][]; outcome: "fixed" | "partly fixed" | "not fixed" | "failed" };
}

// High-severity findings worth one automatic second attempt at the plan:
// the model ignored the refinement's limit, or listed materials that have
// nothing to do with the hypothesis.
export const REPAIR_KINDS = new Set<PlanIssue["kind"]>([
  "refinement_budget_not_met", "refinement_timeline_not_met", "materials_off_topic",
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
  const left = repairableIssues(second.verification).length;
  if (left === 0) {
    const verification: PlanVerification = { ...second.verification, repair: { attempted, outcome: "fixed" } };
    return { plan: { ...second.plan, verification }, verification };
  }
  if (left < attempted.length) return pick(second, "partly fixed");
  return pick(first, "not fixed");
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
  max_timeline_weeks?: number;
}

function money(raw: string, suffix: string | undefined): number | null {
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const s = (suffix ?? "").toLowerCase();
  if (s === "k" || s === "thousand") return n * 1000;
  if (s === "m" || s === "million") return n * 1_000_000;
  return n;
}

const WEEKS_PER_UNIT: Record<string, number> = { day: 1 / 7, week: 1, wk: 1, month: 4.345, year: 52.18 };

/**
 * Numeric limits a refinement instruction asks for (budget cap, timeline
 * cap). `parentTotal` (the refined plan's budget) turns "cut the budget by
 * 30%" into an absolute cap.
 */
export function parseRefinementConstraints(
  instruction: string | null | undefined,
  parentTotal?: number,
): RefinementConstraints {
  const out: RefinementConstraints = {};
  const s = (instruction ?? "").toLowerCase();
  if (!s) return out;
  const pct = s.match(/\b(?:reduce|cut|lower|decrease|trim)\s+(?:the\s+)?(?:total\s+|overall\s+)?(?:budget|costs?)\s+by\s+(\d+(?:\.\d+)?)\s*(?:%|percent)/);
  if (pct && parentTotal && parentTotal > 0) {
    const p = Number(pct[1]);
    if (p > 0 && p < 100) out.max_budget_usd = Math.round(parentTotal * (1 - p / 100));
  }
  if (out.max_budget_usd === undefined && /\b(?:budget|cost|costs|spend|spending|price|usd|dollars?)\b|\$/.test(s)) {
    const cap = s.match(/(?:under|below|less than|at most|max(?:imum)?(?: of)?|no more than|not exceed(?:ing)?|within|cap(?:ped)?(?: at)?|limit(?:ed)? to|<=?|≤|down to|reduce(?:d)? to|cut to|lower(?:ed)? to|bring (?:it )?to|to)\s*(?:a\s+)?(?:total\s+(?:of\s+)?)?(?:us\s*)?\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|m|million)?\b/);
    if (cap) {
      const v = money(cap[1], cap[2]);
      // "to 8 weeks" must not read as a budget: require a currency hint near the number.
      const near = s.slice(Math.max(0, (cap.index ?? 0) - 40), (cap.index ?? 0) + cap[0].length + 12);
      if (v && /\$|usd|dollar|budget|cost|spend/.test(near) && !/^\s*(?:weeks?|months?|days?)/.test(s.slice((cap.index ?? 0) + cap[0].length))) {
        out.max_budget_usd = v;
      }
    }
  }
  if (/\b(?:timeline|schedule|duration|weeks?|months?|days?|finish|complete|shorten|faster)\b/.test(s)) {
    const t = s.match(/(?:to|within|under|in|at most|no more than|max(?:imum)?(?: of)?|less than|shorter than|limit(?:ed)? to|fit (?:into|in))\s*(\d+(?:\.\d+)?)\s*(days?|weeks?|wks?|months?|years?)\b/);
    if (t) {
      const unit = t[2].replace(/s$/, "");
      const w = Number(t[1]) * (WEEKS_PER_UNIT[unit] ?? 0);
      if (w > 0) out.max_timeline_weeks = Math.round(w * 100) / 100;
    }
  }
  return out;
}

/** Sum of the timeline phase durations, in weeks (0 when nothing parses). */
export function timelineWeeks(timeline: { duration?: string }[] | undefined): number {
  if (!Array.isArray(timeline)) return 0;
  const hours = timeline.reduce((s, p) => s + parseDurationToHours(p?.duration), 0);
  return Math.round((hours / 168) * 10) / 10;
}

// --- materials ---------------------------------------------------------------

interface MaterialLike { name?: string; notes?: string; total_cost_usd?: number | string | null }

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

interface BudgetShape {
  currency?: string;
  line_items?: { category?: string; amount_usd?: number | string | null; note?: string }[];
  total_usd?: number | string | null;
}

/** The parts of a plan the guards read; everything else is passed through. */
export interface PlanShape {
  protocol?: { description?: string; source?: string }[];
  materials?: MaterialLike[];
  budget?: BudgetShape;
  timeline?: { duration?: string }[];
  verification?: PlanVerification;
  [key: string]: unknown;
}

/**
 * Run every deterministic guard on a plan. Returns a copy of the plan with
 * sources and the budget total fixed and `verification` attached.
 */
export function verifyPlan(
  input: unknown,
  ctx: {
    hypothesis: string;
    references: RefLike[];
    refinementInstruction?: string | null;
    /** The plan being refined (for limits relative to it, e.g. "cut the budget by 30%"). */
    parentPlan?: unknown;
  },
): { plan: PlanShape; verification: PlanVerification } {
  const plan: PlanShape = input && typeof input === "object" ? { ...(input as PlanShape) } : {};
  const issues: PlanIssue[] = [];

  // 1) Protocol sources: only retrieved references (or a plain label) survive.
  const { steps, report } = sanitizeStepSources(plan.protocol, ctx.references);
  if (Array.isArray(plan.protocol)) plan.protocol = steps;
  if (report.removed > 0 || report.links_removed > 0) {
    issues.push({
      kind: "unverified_sources_removed",
      severity: "medium",
      detail: `${report.removed + report.links_removed} protocol source(s) cited papers or links that the literature search did not return and were removed${report.removed_examples.length ? ` (for example ${report.removed_examples[0]})` : ""}.`,
    });
  }

  // 2) Budget: the total is the sum of the line items.
  let budgetOut: PlanVerification["budget"] = null;
  if (plan.budget && typeof plan.budget === "object") {
    const { budget, check } = reconcileBudget(plan.budget);
    plan.budget = budget;
    if (check) {
      budgetOut = { stated_total: check.stated_total, line_item_sum: check.line_item_sum, corrected: check.mismatch };
      if (check.mismatch) {
        issues.push({
          kind: "budget_total_corrected",
          severity: "medium",
          detail: `The model's budget total (${check.stated_total === null ? "missing" : usd(check.stated_total)}) did not equal the sum of its line items (${usd(check.line_item_sum)}); the total now shows the sum.`,
        });
      }
    }
    // Materials line item vs the materials table.
    const materials: MaterialLike[] = Array.isArray(plan.materials) ? plan.materials : [];
    const matSum = materials.reduce((s, m) => s + (Number(m?.total_cost_usd) || 0), 0);
    const matLine = (plan.budget.line_items ?? []).find((li) =>
      /reagent|material|consumable|supplies/i.test(li?.category ?? ""));
    if (matSum > 0 && matLine && Number(matLine.amount_usd) > 0) {
      const ratio = Number(matLine.amount_usd) / matSum;
      if (ratio < 0.75 || ratio > 1.33) {
        issues.push({
          kind: "materials_subtotal_mismatch",
          severity: "medium",
          detail: `The budget line "${matLine.category ?? "materials"}" (${usd(Number(matLine.amount_usd))}) does not match the materials table subtotal (${usd(matSum)}).`,
        });
      }
    }
  }

  // 3) Materials must belong to this experiment.
  const materials: MaterialLike[] = Array.isArray(plan.materials) ? plan.materials : [];
  const copied = catalogCopies(materials, ctx.hypothesis);
  if (copied.length > 0) {
    issues.push({
      kind: "catalog_items_copied",
      severity: "medium",
      detail: `Materials that match cost-catalog examples from a topic this hypothesis does not mention (copied from the price list?): ${copied.slice(0, 6).join(", ")}.`,
    });
  }
  if (materials.length > 0) {
    const hTerms = keyTerms(ctx.hypothesis);
    const mTerms = keyTerms(materials.map((m) => `${m?.name ?? ""} ${m?.notes ?? ""}`).join(" "));
    if (hTerms.size > 0 && sharedTerms(hTerms, mTerms).length === 0) {
      issues.push({
        kind: "materials_off_topic",
        severity: "high",
        detail: `No material mentions anything specific to the hypothesis (${[...hTerms].slice(0, 6).join(", ")}).`,
      });
    }
  }

  // 4) Refinement limits.
  const parentTotal = Number((ctx.parentPlan as PlanShape | undefined)?.budget?.total_usd) || undefined;
  const constraints = parseRefinementConstraints(ctx.refinementInstruction, parentTotal);
  if (constraints.max_budget_usd !== undefined && plan.budget) {
    const total = Number(plan.budget.total_usd) || 0;
    if (total > constraints.max_budget_usd * 1.01) {
      issues.push({
        kind: "refinement_budget_not_met",
        severity: "high",
        detail: `The refinement asked for a budget of at most ${usd(constraints.max_budget_usd)}; this plan totals ${usd(total)}.`,
      });
    }
  }
  if (constraints.max_timeline_weeks !== undefined) {
    const weeks = timelineWeeks(plan.timeline);
    if (weeks > constraints.max_timeline_weeks * 1.05) {
      issues.push({
        kind: "refinement_timeline_not_met",
        severity: "high",
        detail: `The refinement asked for a timeline of at most ${constraints.max_timeline_weeks} weeks; the phases add up to ${weeks} weeks.`,
      });
    }
  }

  const verification: PlanVerification = {
    version: 1,
    sources: report,
    budget: budgetOut,
    ...(Object.keys(constraints).length ? { refinement: constraints } : {}),
    issues,
  };
  plan.verification = verification;
  return { plan, verification };
}

// Findings the guards already corrected (shown to the reader, not a concern
// for the reviewer: run 633e1d4f's critique raised the fixed total as "high").
const FIXED_KINDS = new Set<PlanIssue["kind"]>(["budget_total_corrected", "unverified_sources_removed"]);

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
    lines.push(`- budget.total_usd MUST be at most ${c.max_budget_usd} USD, and the line items must add up to it. Cut scope, FTE, duration or quantities to get there.`);
  }
  if (c.max_timeline_weeks !== undefined) {
    lines.push(`- The timeline phases MUST add up to at most ${c.max_timeline_weeks} weeks in total. Write phase durations in weeks.`);
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
    const b = (p.budget && typeof p.budget === "object" ? p.budget : {}) as Loose;
    p.budget = { line_items: arr(b.line_items).map((li) => pick(li, ["category"])), total_usd: "(to be revised)" };
    p.materials = arr(p.materials).map((m) => pick(m, ["name", "supplier", "catalog_number", "notes"]));
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
