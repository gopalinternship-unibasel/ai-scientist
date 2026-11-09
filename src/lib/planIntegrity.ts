// The plan-integrity checks the edge function runs on every plan
// (supabase/functions/_shared/planIntegrity.ts, import-free so both sides
// share one implementation). The plan view and the PDF apply them again so
// plans saved before the checks existed (9 Nov 2026) also hide sources that
// are not retrieved references and show the line-item sum as the total.
import {
  checkBudget,
  verifiedSource,
  type RefLike,
} from "../../supabase/functions/_shared/planIntegrity.ts";
import type { ExperimentPlan, PlanCheckIssue } from "./samples";

export {
  budgetTotal,
  checkBudget,
  costLineItems,
  matchReference,
  verifiedSource,
} from "../../supabase/functions/_shared/planIntegrity.ts";

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * What to tell the reader about the plan's automated checks: the server's
 * findings when the plan has them, otherwise the two checks the client can
 * redo itself (budget arithmetic, sources outside the reference list).
 */
export function planCheckNotes(plan: ExperimentPlan, references: RefLike[]): PlanCheckIssue[] {
  if (plan.verification?.issues) return plan.verification.issues;
  const notes: PlanCheckIssue[] = [];
  const b = checkBudget(plan.budget);
  if (b?.mismatch) {
    notes.push({
      kind: "budget_total_corrected",
      severity: "medium",
      detail: `The model's budget total (${b.stated_total === null ? "missing" : usd(b.stated_total)}) does not equal the sum of its line items (${usd(b.line_item_sum)}); the sum is shown.`,
    });
  }
  const hidden = (plan.protocol ?? []).filter((s) => s.source && verifiedSource(s.source, references) === null).length;
  if (hidden > 0) {
    notes.push({
      kind: "unverified_sources_removed",
      severity: "medium",
      detail: `${hidden} protocol source(s) cite papers or links the literature search did not return; they are hidden.`,
    });
  }
  return notes;
}

// Findings the server corrects itself; every other finding is for the reader
// to check (the guards only flag it).
const FIXED_KINDS = new Set(["budget_total_corrected", "unverified_sources_removed"]);

/** "Fixed" for corrections the checks made, "Check" for findings left to the reader. */
export function checkLabel(issue: PlanCheckIssue): "Fixed" | "Check" {
  return FIXED_KINDS.has(issue.kind) ? "Fixed" : "Check";
}
