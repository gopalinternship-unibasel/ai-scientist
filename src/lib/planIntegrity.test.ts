import { describe, it, expect } from "vitest";
import type { ExperimentPlan } from "./samples";
import { checkLabel, planCheckNotes, shownBudget } from "./planIntegrity";
import { budgetTotal } from "./planIntegrity";

const base: ExperimentPlan = {
  title: "t", domain: "cell_biology", summary: "s", hypothesis_restated: "h", success_criteria: [],
  protocol: [{ step: 1, title: "Treat", description: "Add 10 uM metformin.", duration: "1 day" }],
  materials: [
    { name: "HepG2 cells", supplier: "ATCC", quantity: "1 vial", unit_cost_usd: 580, total_cost_usd: 580 },
    { name: "FBS", supplier: "Thermo Fisher", quantity: "500 mL", unit_cost_usd: 715, total_cost_usd: 715 },
  ],
  budget: { currency: "USD", line_items: [{ category: "Materials", amount_usd: 615 }, { category: "Labour", amount_usd: 5100 }], total_usd: 5715 },
  timeline: [], validation: { approach: "a", primary_metric: "m", controls: [] }, risks: [], team: [],
};

describe("plan checks shown for plans saved before the round-2 fixes", () => {
  it("raises a materials line below the materials table and says so (run 020ae70a)", () => {
    const old: ExperimentPlan = {
      ...base,
      verification: { issues: [{ kind: "materials_subtotal_mismatch", severity: "medium", detail: "The budget line \"Materials\" ($615) does not match the materials table subtotal ($1,295)." }] },
    };
    expect(budgetTotal(shownBudget(old))).toBe(6395);
    const notes = planCheckNotes(old, []);
    expect(notes.map((n) => n.kind)).toEqual(["materials_line_corrected"]);
    expect(checkLabel(notes[0])).toBe("Fixed");
    expect(notes[0].detail).toContain("$1,295");
  });

  it("restates an old total note with the sum that is now shown (run 020ae70a)", () => {
    const old: ExperimentPlan = {
      ...base,
      verification: {
        budget: { stated_total: 18325, line_item_sum: 5715, corrected: true },
        issues: [{ kind: "budget_total_corrected", severity: "medium", detail: "The model's budget total ($18,325) did not equal the sum of its line items ($5,715); the total now shows the sum." }],
      },
    };
    const total = planCheckNotes(old, []).find((n) => n.kind === "budget_total_corrected");
    expect(total?.detail).toContain("$18,325");
    expect(total?.detail).toContain("$6,395");
  });

  it("does not repeat an invented link in the removed-sources note (run 6745b824)", () => {
    const old: ExperimentPlan = {
      ...base,
      budget: { currency: "USD", line_items: [{ category: "Materials", amount_usd: 1295 }], total_usd: 1295 },
      verification: { issues: [{ kind: "unverified_sources_removed", severity: "medium", detail: "4 protocol source(s) cited papers or links that the literature search did not return and were removed (for example https://www.biorxiv.org/content/10.1101/2020.01.09.925616v1)." }] },
    };
    const [note] = planCheckNotes(old, []);
    expect(note.detail).toBe("4 protocol source(s) cited papers or links that the literature search did not return and were removed.");
  });
});
