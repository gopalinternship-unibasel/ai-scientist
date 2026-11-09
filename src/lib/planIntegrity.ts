// The plan-integrity checks the edge function runs on every plan
// (supabase/functions/_shared/planIntegrity.ts, import-free so both sides
// share one implementation). The plan view and the PDF apply them again so
// plans saved before the checks existed (9 Nov 2026) also hide sources that
// are not retrieved references, show the line-item sum as the total and
// count every listed material in the budget.
import {
  checkBudget,
  displayBudget,
  verifiedSource,
  type RefLike,
} from "../../supabase/functions/_shared/planIntegrity.ts";
import type { ExperimentPlan, PlanCheckIssue } from "./samples";

export {
  budgetTotal,
  checkBudget,
  costLineItems,
  displayBudget,
  matchReference,
  verifiedSource,
} from "../../supabase/functions/_shared/planIntegrity.ts";

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** The budget as shown: materials line covering the materials table, total = sum of line items. */
export function shownBudget(plan: ExperimentPlan): ExperimentPlan["budget"] {
  return displayBudget(plan.budget, plan.materials).budget;
}

// Older notes quoted the first removed source ("... were removed (for
// example https://...)."), which showed the invented link again.
function withoutRemovedExample(detail: string): string {
  return detail.replace(/ \(for example [\s\S]*\)(?=\.$)/, "");
}

/**
 * What to tell the reader about the plan's automated checks: the server's
 * findings when the plan has them, otherwise the checks the client can redo
 * itself (budget arithmetic, sources outside the reference list). Plans
 * saved before the materials-line rule are shown with their materials line
 * raised to the materials table subtotal, and the note says so.
 */
export function planCheckNotes(plan: ExperimentPlan, references: RefLike[]): PlanCheckIssue[] {
  const shown = displayBudget(plan.budget, plan.materials);
  const materialsNote: PlanCheckIssue | null = shown.materialsLine
    ? {
      kind: "materials_line_corrected",
      severity: "medium",
      detail: `The budget line "${shown.materialsLine.category}" (${usd(shown.materialsLine.stated)}) was lower than the materials table subtotal (${usd(shown.materialsLine.table)}); it now shows the subtotal, and the total includes it.`,
    }
    : null;

  if (plan.verification?.issues) {
    const notes = plan.verification.issues
      // A stored "does not match" note is answered by the correction above.
      .filter((i) => !(materialsNote && i.kind === "materials_subtotal_mismatch"))
      .map((i) => (i.kind === "unverified_sources_removed" ? { ...i, detail: withoutRemovedExample(i.detail) } : i));
    if (materialsNote && !notes.some((i) => i.kind === "materials_line_corrected")) notes.unshift(materialsNote);
    return notes;
  }
  const notes: PlanCheckIssue[] = materialsNote ? [materialsNote] : [];
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

// Findings the checks correct themselves (supabase/functions/_shared/
// planGuards.ts FIXED_KINDS); every other finding is for the reader to check.
const FIXED_KINDS = new Set([
  "budget_total_corrected", "unverified_sources_removed", "materials_line_corrected", "catalog_numbers_removed",
]);

/** "Fixed" for corrections the checks made, "Check" for findings left to the reader. */
export function checkLabel(issue: PlanCheckIssue): "Fixed" | "Check" {
  return FIXED_KINDS.has(issue.kind) ? "Fixed" : "Check";
}
