import { describe, it, expect, vi } from "vitest";
import type { ExperimentPlan } from "@/lib/samples";
import { exportPlanToPdf } from "./exportPdf";

// jsPDF sets save() on each instance; wrap the constructor so save() keeps
// the generated PDF (uncompressed text) instead of starting a download.
const captured = vi.hoisted(() => ({ pdf: "" }));
vi.mock("jspdf", async (importOriginal) => {
  const mod = await importOriginal<typeof import("jspdf")>();
  function CapturingPDF(...args: ConstructorParameters<typeof mod.jsPDF>) {
    const doc = new mod.jsPDF(...args);
    doc.save = (() => { captured.pdf = doc.output(); return doc; }) as typeof doc.save;
    return doc;
  }
  return { ...mod, jsPDF: CapturingPDF };
});

const plan: ExperimentPlan = {
  title: "Paper biosensor for CRP",
  domain: "diagnostics",
  summary: "Detect CRP in whole blood.",
  hypothesis_restated: "The sensor detects CRP below 0.5 mg/L.",
  success_criteria: ["LOD below 0.5 mg/L"],
  protocol: [{ step: 1, title: "Calibrate", description: "Run a CRP standard curve.", duration: "1 day", source: "see [1]" }],
  materials: [{ name: "CRP standard", supplier: "Sigma-Aldrich", catalog_number: "C4063", quantity: "1", unit_cost_usd: 300, total_cost_usd: 300 }],
  budget: { currency: "USD", line_items: [{ category: "Reagents", amount_usd: 300 }], total_usd: 300 },
  timeline: [{ phase: "Calibration", duration: "1 week", deliverables: ["Standard curve"] }],
  validation: { approach: "Compare with ELISA", primary_metric: "LOD", controls: ["Blank strip"] },
  risks: [{ risk: "Matrix effects", mitigation: "Spike-recovery tests" }],
  team: [{ role: "Research associate", fte: 0.5 }],
};

function capturePdf(run: () => void): string {
  captured.pdf = "";
  run();
  return captured.pdf;
}

describe("exportPlanToPdf references", () => {
  it("lists the literature references the protocol cites as [N]", () => {
    const pdf = capturePdf(() => exportPlanToPdf(plan, "h", 1, [
      { title: "Indirect Immunometric ELISA", year: 2017, authors: ["Smith J"], venue: "Cold Spring Harb Protoc", url: "https://doi.org/10.1101/pdb.prot093708" },
    ]));
    expect(pdf).toContain("References");
    expect(pdf).toContain("[1] Indirect Immunometric ELISA");
    expect(pdf).toContain("https://doi.org/10.1101/pdb.prot093708");
  });

  it("has no References section when the run found no papers", () => {
    const pdf = capturePdf(() => exportPlanToPdf(plan, "h", 1));
    expect(pdf).not.toContain("References");
  });
});

describe("exportPlanToPdf integrity", () => {
  it("prints only retrieved references as sources and the line-item sum as the total", () => {
    const pdf = capturePdf(() => exportPlanToPdf({
      ...plan,
      protocol: [
        { step: 1, title: "Calibrate", description: "Run a CRP standard curve.", duration: "1 day", source: "https://www.jbc.org/article/S0021-9258(19)30082-7/fulltext" },
      ],
      budget: { currency: "USD", line_items: [{ category: "Reagents", amount_usd: 300 }, { category: "Labour", amount_usd: 700 }], total_usd: 400 },
    }, "h", 1));
    expect(pdf).not.toContain("jbc.org");
    expect(pdf).toContain("$1,000");
    expect(pdf).toContain("AUTOMATED CHECKS");
  });
});
