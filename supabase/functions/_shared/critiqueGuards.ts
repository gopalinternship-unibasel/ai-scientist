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
  const out: Critique = { ...critique };
  const removed: { reason: string; issue: string }[] = [];

  const clean = (s: unknown) => (typeof s === "string" ? collapseRepeats(s) : s);
  if (Array.isArray(out.strengths)) out.strengths = out.strengths.map((s) => clean(s) as string);
  if (Array.isArray(out.missing_controls)) out.missing_controls = out.missing_controls.map((s) => clean(s) as string);
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
        const key = (c.issue ?? "").toLowerCase().replace(/\W+/g, " ").trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }
  if (removed.length > 0) out.removed_concerns = removed;
  return out;
}
