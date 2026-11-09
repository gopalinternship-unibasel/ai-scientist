// Critique clean-up, from the critiques of runs 78967afc and 739dddf1
// (round-3 fix check, qwen2.5:3b) and the QA's round-2 examples.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { cleanCritique, collapseRepeats } from "./critiqueGuards.ts";

const plan = {
  materials: [{ name: "HepG2 cells", supplier: "ATCC" }, { name: "Metformin", supplier: "Sigma-Aldrich" }],
  safety: { biosafety_level: "BSL-1", controlled_substances: false, hazards: ["Metformin", "Sodium palmitate"] },
};

Deno.test("critique: a looping phrase is collapsed", () => {
  assertEquals(collapseRepeats("QA feedback: QA feedback: QA feedback: QA feedback: use a calibrator"), "QA feedback: use a calibrator");
  assertEquals(collapseRepeats("Use 3 replicates per group."), "Use 3 replicates per group.");
});

Deno.test("critique: invented controlled-substance claims and catalog numbers are dropped", () => {
  const c = cleanCritique({
    overall_score: 2,
    concerns: [
      { severity: "high", area: "safety", issue: "The plan states that controlled substances are present (metformin, sodium palmitate, Oil Red O).", suggestion: "Raise the biosafety level." },
      { severity: "medium", area: "materials", issue: "The HepG2 line should be ordered as CRL-2530.", suggestion: "Update HepG2 to CRL-2530." },
      { severity: "medium", area: "validation", issue: "No vehicle control for metformin.", suggestion: "Add a vehicle control." },
      { severity: "medium", area: "validation", issue: "No vehicle control for metformin.", suggestion: "Add a vehicle control." },
    ],
  }, { plan, preChecks: "" });
  assertEquals(c?.concerns?.map((x) => x.issue), ["No vehicle control for metformin."]);
  assertEquals(c?.removed_concerns?.length, 2);
});

Deno.test("critique: real controlled substances and catalog numbers from the plan or the pre-checks stay", () => {
  const withSku = { ...plan, materials: [...plan.materials, { name: "Trehalose", catalog_number: "T9531" }], safety: { ...plan.safety, controlled_substances: true } };
  const c = cleanCritique({
    concerns: [
      { issue: "Ketamine is a controlled substance; the DEA licence is missing.", suggestion: "Add the licence." },
      { issue: "T9531 is listed for trehalose; confirm the grade.", suggestion: "Check T9531." },
    ],
  }, { plan: withSku });
  assertEquals(c?.concerns?.length, 2);
  assert(!c?.removed_concerns);
});
