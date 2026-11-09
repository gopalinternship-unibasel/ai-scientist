import { describe, it, expect } from "vitest";
import { displayQc, type ShownQC } from "./noveltyDisplay";

const METFORMIN = "Treating HepG2 hepatocytes with 10 µM metformin for 24 hours before a 0.5 mM palmitate challenge will reduce intracellular lipid accumulation, measured by Oil Red O staining, by at least 30% compared with vehicle-treated palmitate controls.";
const NMN = "Treating SH-SY5Y neuroblastoma cells with 1 mM nicotinamide mononucleotide (NMN) for 24 hours will raise intracellular NAD+ levels by at least 40% compared with vehicle-treated cells, measured with a luminescent NAD/NADH assay.";
const CRP = "A paper-based electrochemical biosensor functionalized with anti-CRP antibodies will detect C-reactive protein in whole blood at concentrations below 0.5 mg/L within 10 minutes, matching laboratory ELISA sensitivity without requiring sample preprocessing.";

describe("novelty verdicts of runs saved before the server-side check", () => {
  it("run 020ae70a: 'not found' next to palmitate-treated HepG2 lipid papers is shown as 'similar'", () => {
    const qc: ShownQC = {
      signal: "not_found", semantic_overlap: "low", rationale: "None of the candidates discuss metformin.",
      references: [
        { title: "Effects of Piperine on Insulin Resistance and Lipid Accumulation in Palmitate-treated HepG2 Cells" },
        { title: "Effects of grape peel phenolics on lipid accumulation in sodium palmitate-treated HepG2 cells" },
        { title: "Effect of Carotenoids from Phaeodactylum tricornutum on Palmitate-Treated HepG2 Cells" },
      ],
    };
    const shown = displayQc(qc, METFORMIN);
    expect(shown.signal).toBe("similar");
    expect(shown.classifier_signal).toBe("not_found");
    expect(shown.references.length).toBeGreaterThan(0);
  });

  it("run 633e1d4f: 'not found' with 'semantic overlap: high' and no references is no longer contradictory", () => {
    const shown = displayQc({ signal: "not_found", semantic_overlap: "high", rationale: "x", references: [] }, NMN);
    expect(shown.signal).toBe("not_found");
    expect(shown.semantic_overlap).toBe("low");
  });

  it("run b015232c: 'exact match' with slot-blot and HTLV-1 papers is not shown as an exact match", () => {
    const shown = displayQc({
      signal: "exact_match", semantic_overlap: "high", rationale: "ELISA is a textbook-canonical immunoassay ...",
      references: [
        { title: "An improved slot blot assay for protein quantification in serum samples." },
        { title: "Relative Frequency of HTLV-I Infection in Blood Donors in Ahvaz, Southwest of Iran." },
      ],
    }, CRP);
    expect(shown.signal).toBe("not_found");
    expect(shown.references).toEqual([]);
  });

  it("leaves a textbook protocol request's canonical 'exact match' and already-checked runs alone", () => {
    const pcr: ShownQC = { signal: "exact_match", semantic_overlap: "high", rationale: "PCR is canonical.", references: [{ title: "PCR protocols" }] };
    expect(displayQc(pcr, "Use standard PCR with Taq polymerase to amplify the GAPDH housekeeping gene from human genomic DNA.")).toBe(pcr);
    const checked: ShownQC = { signal: "not_found", semantic_overlap: "low", rationale: "x", references: [], novelty_checked: true };
    expect(displayQc(checked, METFORMIN)).toBe(checked);
  });
});
