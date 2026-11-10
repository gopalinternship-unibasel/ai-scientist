// Deterministic clean-up of the reviewer critique before it is saved.
//
// The critique is an LLM call; with the small local model it invented
// content and looped (QA round 2 and the round-3 fix check, qwen2.5:3b):
//  - "palmitate is a controlled substance" / "The plan states that
//    controlled substances are present (metformin, sodium palmitate, Oil Red
//    O)" while the plan says controlled_substances: false and the safety
//    screen flagged none;
//  - "update HepG2 to CRL-2530": a catalog number that appears nowhere in
//    the plan or the pre-checks;
//  - "QA feedback: QA feedback: QA feedback: ..." until the field cap.
// QA round 3 added two more invented kinds:
//  - "missing vehicle/palmitate-only control" for plans v2 and v3, which
//    have a "Vehicle Controls" step;
//  - "the budget exceeds $20,000" for a plan that totals $17,540 (run
//    92185b64).
// Concerns built on such claims are dropped (and counted in
// `removed_concerns`), repeated phrases are collapsed. Import-free.

export interface CritiqueConcern {
  severity?: string;
  area?: string;
  issue?: string;
  suggestion?: string;
}

export interface Critique {
  overall_score?: number;
  strengths?: string[];
  concerns?: CritiqueConcern[];
  missing_controls?: string[];
  statistical_notes?: string;
  ethical_notes?: string;
  /** How many concerns this clean-up removed, and why. */
  removed_concerns?: { reason: string; issue: string }[];
  [key: string]: unknown;
}

/** "QA feedback: QA feedback: QA feedback: x" -> "QA feedback: x" (a phrase of 2-60 characters repeated 3+ times). */
export function collapseRepeats(text: string): string {
  if (!text) return text;
  let out = text;
  for (let i = 0; i < 3; i++) {
    const next = out.replace(/(.{2,60}?)(?:\s*\1){2,}/gs, "$1");
    if (next === out) break;
    out = next;
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

// Catalog-number-like tokens: ATCC "CRL-2530", Sigma "T9531", Thermo "11965092".
const CATALOG_TOKEN = /\b(?:[A-Z]{2,4}-\d{2,5}|[A-Z]{1,3}\d{4,7}(?:-\d+[A-Z]*)?|\d{7,9})\b/g;
const CONTROLLED = /\bcontrolled[- ]substances?\b|\bDEA\b|\bscheduled? (?:drug|substance)/i;

// "missing vehicle/palmitate-only control", "lacks a positive control", "no untreated control group".
const MISSING_CONTROL = /\b(?:missing|lacks?|lacking|no|without|absent|omits?|needs?|add(?:s|ing)?)\s+(?:an?\s+|the\s+|any\s+)?((?:[\w+/-]+\s+){0,3}?[\w+/-]+)\s+controls?\b/i;
// Words that do not say which control is meant.
const CONTROL_FILLER = new Set([
  "a", "an", "the", "any", "proper", "appropriate", "adequate", "additional", "suitable", "explicit", "clear",
  "dedicated", "separate", "and", "or", "of", "for", "with", "group", "groups", "treatment", "condition", "experimental",
  // "quality control", "temperature control" are not control groups.
  "better", "more", "further", "rigorous", "stricter", "tighter", "quality", "temperature", "humidity", "process",
  "contamination", "infection", "cost", "budget", "version", "access", "inventory", "document", "change",
]);

/** The control kinds a critique says are missing ("vehicle", "palmitate-only"). */
export function claimedMissingControls(text: string): string[] {
  const m = (text ?? "").match(MISSING_CONTROL);
  if (!m) return [];
  return m[1].toLowerCase().split(/[\s/]+/).map((w) => w.replace(/[^a-z0-9+-]/g, ""))
    .filter((w) => w.length >= 3 && !CONTROL_FILLER.has(w));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whether the plan already has a control of one of these kinds ("Vehicle Controls" step, validation.controls). */
export function planHasControl(planText: string, kinds: string[]): boolean {
  const t = (planText ?? "").toLowerCase();
  return kinds.some((k) => {
    const base = escapeRe(k.replace(/-only$/, ""));
    return new RegExp(`\\b${base}(?:-only|-treated|\\s+only)?[\\s-]+(?:\\w+[\\s-]+)?controls?\\b`).test(t)
      || new RegExp(`\\bcontrols?\\W{1,4}(?:\\w+\\W+){0,2}${base}\\b`).test(t);
  });
}

/**
 * "The budget exceeds $20,000": the amount a concern says the plan's budget
 * or total is above, or null. The subject must be the budget or the total:
 * "an EVOM2 alone costs over $3,000" is a remark about a price, and is true
 * or false whatever the plan totals.
 */
const BUDGET_ABOVE = /\b(?:budget|total)\b[^.;:]{0,40}?\b(?:exceeds?|exceeding|over|above|more than|greater than|surpass(?:es)?)\s+(?:the\s+)?(?:\w+\s+){0,2}?(?:US)?\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k|K|thousand)?/i;

export function claimedBudgetAbove(text: string): number | null {
  const m = (text ?? "").match(BUDGET_ABOVE);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return m[2] ? n * 1000 : n;
}

export function cleanCritique(
  critique: Critique | null,
  ctx: {
    /** The plan as saved (JSON). */
    plan: unknown;
    /** Text of the deterministic pre-check findings the critic was given. */
    preChecks?: string;
    /** Whether the deterministic safety screen flagged controlled substances. */
    controlledFlagged?: boolean;
  },
): Critique | null {
  if (!critique || typeof critique !== "object") return critique;
  const planText = JSON.stringify(ctx.plan ?? {});
  const known = `${planText}\n${ctx.preChecks ?? ""}`;
  const planSaysControlled = /"controlled_substances"\s*:\s*true/.test(planText);
  const totalRaw = Number((ctx.plan as { budget?: { total_usd?: unknown } } | null)?.budget?.total_usd);
  const planTotal = Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : null;
  const out: Critique = { ...critique };
  const removed: { reason: string; issue: string }[] = [];

  const clean = (s: unknown) => (typeof s === "string" ? collapseRepeats(s) : s);
  if (Array.isArray(out.strengths)) out.strengths = out.strengths.map((s) => clean(s) as string);
  if (Array.isArray(out.missing_controls)) {
    out.missing_controls = out.missing_controls.map((s) => clean(s) as string).filter((s) => {
      // A "missing" control the plan already has is not missing.
      const kinds = claimedMissingControls(/control/i.test(String(s)) ? `missing ${s}` : `missing ${s} control`);
      if (kinds.length > 0 && planHasControl(planText, kinds)) {
        removed.push({ reason: `lists a control the plan already has (${kinds.join(", ")})`, issue: String(s).slice(0, 160) });
        return false;
      }
      return true;
    });
  }
  out.statistical_notes = clean(out.statistical_notes) as string | undefined;
  out.ethical_notes = clean(out.ethical_notes) as string | undefined;

  if (Array.isArray(out.concerns)) {
    const seen = new Set<string>();
    out.concerns = out.concerns
      .map((c) => ({ ...c, issue: clean(c?.issue) as string, suggestion: clean(c?.suggestion) as string }))
      .filter((c) => {
        const text = `${c.issue ?? ""} ${c.suggestion ?? ""}`;
        if (CONTROLLED.test(text) && !planSaysControlled && !ctx.controlledFlagged) {
          removed.push({ reason: "claims a controlled substance the plan and the safety screen do not have", issue: (c.issue ?? "").slice(0, 160) });
          return false;
        }
        const invented = (text.match(CATALOG_TOKEN) ?? []).filter((t) => !known.includes(t));
        if (invented.length > 0) {
          removed.push({ reason: `names catalog numbers that are not in the plan (${invented.slice(0, 3).join(", ")})`, issue: (c.issue ?? "").slice(0, 160) });
          return false;
        }
        const controls = claimedMissingControls(c.issue ?? "");
        if (controls.length > 0 && planHasControl(planText, controls)) {
          removed.push({ reason: `says a control is missing that the plan has (${controls.join(", ")})`, issue: (c.issue ?? "").slice(0, 160) });
          return false;
        }
        const above = claimedBudgetAbove(c.issue ?? "");
        if (above !== null && planTotal !== null && planTotal <= above) {
          removed.push({ reason: `says the budget exceeds $${above.toLocaleString("en-US")}, but the plan totals $${Math.round(planTotal).toLocaleString("en-US")}`, issue: (c.issue ?? "").slice(0, 160) });
          return false;
        }
        const key = (c.issue ?? "").toLowerCase().replace(/\W+/g, " ").trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }
  if (removed.length > 0) out.removed_concerns = removed;
  return out;
}
