// Calibration set for the novelty classifier.
//
// This is NOT a unit test of the LLM — we don't want to spend tokens in CI
// on every commit. Instead it's a documented fixture you can replay manually
// (or on a nightly cron) to detect drift in `classifyNovelty`.
//
// Each case lists the signal we believe is correct, plus alternatives we'd
// also accept (the classifier model is non-deterministic at the boundary).

export interface CalibrationCase {
  hypothesis: string;
  expected_signal: "exact_match" | "similar" | "not_found";
  rationale: string;
  tolerance?: Array<"exact_match" | "similar" | "not_found">;
}

export const NOVELTY_CALIBRATION: CalibrationCase[] = [
  // ── Should fire as exact_match (canonical-technique override path) ──
  {
    hypothesis:
      "Use standard PCR with Taq polymerase to amplify the GAPDH housekeeping gene from human genomic DNA.",
    expected_signal: "exact_match",
    rationale: "PCR is a textbook canonical technique; canonical-detector forces exact_match.",
  },
  {
    hypothesis:
      "Perform a Western blot to detect β-actin in HeLa cell lysate using a commercial anti-actin antibody.",
    expected_signal: "exact_match",
    rationale: "Western blot is canonical and β-actin is the standard loading control.",
  },
  {
    hypothesis:
      "Quantify TNF-α in serum samples by sandwich ELISA using a commercial k