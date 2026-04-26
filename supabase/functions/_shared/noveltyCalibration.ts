// Calibration set for the novelty classifier.
//
// This is NOT a per-commit unit test (we don't spend tokens in CI). It's a
// documented fixture for manual or nightly drift checks of `classifyNovelty`.
//
// Each case names the expected signal plus tolerated alternatives, since the
// classifier model is non-deterministic at the boundary between similar and
// exact_match.

export interface CalibrationCase {
  hypothesis: string;
  expected_signal: "exact_match" | "similar" | "not_found";
  rationale: string;
  tolerance?: Array<"exact_match" | "similar" | "not_found">;
}

export const NOVELTY_CALIBRATION: CalibrationCase[] = [
  // exact_match — textbook canonical methods
  {
    hypothesis: "Use standard PCR with Taq polymerase to amplify the GAPDH housekeeping gene from human genomic DNA.",
    expected_signal: "exact_match",
    rationale: "PCR is canonical; the canonical-detector override forces exact_match.",
  },
  {
    hypothesis: "Perform a Western blot to detect beta-actin in HeLa cell lysate using a commercial anti-actin antibody.",
    expected_signal: "exact_match",
    rationale: "Western blot is canonical and beta-actin is the standard loading control.",
  },
  {
    hypothesis: "Quantify TNF-alpha in human serum by sandwich ELISA using a commercial DuoSet kit.",
    expected_signal: "exact_match",
    rationale: "ELISA is canonical; TNF-alpha quantification is heavily published.",
  },

  // similar — known technique, unusual context (in-between case)
  {
    hypothesis: "Apply CRISPR-Cas9 knockout of the PER2 gene in cultured axolotl limb-blastema cells to study circadian regulation of regeneration.",
    expected_signal: "similar",
    rationale: "CRISPR + circadian biology are well-studied, but the axolotl-blastema combination is unusual.",
    tolerance: ["not_found"],
  },
  {
    hypothesis: "Use single-cell RNA-seq to profile gene expression in the brain of the naked mole-rat after hypoxic exposure.",
    expected_signal: "similar",
    rationale: "scRNA-seq + hypoxia is well-published; naked-mole-rat brain hypoxia studies exist but are rarer.",
    tolerance: ["exact_match"],
  },

  // not_found — novel / highly specific
  {
    hypothesis: "Engineer a synthetic riboswitch that responds to ferrocene-derivative concentration to drive GFP expression in B. subtilis biofilms grown on lunar-regolith simulant.",
    expected_signal: "not_found",
    rationale: "The combination of ferrocene-responsive riboswitch + lunar-regolith biofilm is highly unlikely to have prior art.",
    tolerance: ["similar"],
  },
  {
    hypothesis: "Test whether sonication at 7.3 MHz selectively disrupts the membrane of Toxoplasma gondii tachyzoites without harming co-cultured human fibroblasts.",
    expected_signal: "not_found",
    rationale: "Specific frequency + specific organism + selective membrane disruption — unlikely combination.",
    tolerance: ["similar"],
  },
];
