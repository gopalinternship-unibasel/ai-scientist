// Version of the run pipeline (literature search, novelty check, plan
// checks). It is part of the plan-cache key (run-experiment hashes the
// hypothesis together with it) and is stored in qc.pipeline_version and
// plan.verification.pipeline_version.
//
// Raise it whenever a change makes earlier cached plans or novelty verdicts
// wrong to replay: a request for the same hypothesis then computes a fresh
// run instead of copying one made by the older pipeline, and the run page
// says that older runs were made before the current checks.
//
// History:
//   (none) runs before QA round 3 (until 10 Nov 2026)
//   3      QA round 3 fixes (10 Nov 2026): catalog numbers verified or
//          marked unverified, readout / missing-materials / dilution checks,
//          embedding relevance filter for related work.
//   4      Review of those fixes (10 Nov 2026, evening): "verified" needs
//          the catalogue's name to agree with the material (version 3
//          verified "Sodium butyrate" with sodium chloride's number),
//          sub-lines keep their own ATCC numbers, lengths are no longer read
//          as doses, dose series and dilution sources are read correctly.
export const PIPELINE_VERSION = 4;

/**
 * Plan-cache key of a hypothesis: SHA-256 of the normalised text and the
 * pipeline version. Until QA round 3 it was the text alone, so plans and
 * novelty verdicts made before the checks they now fail were replayed to
 * new users (cached copies e4ff6aa6, ac7bd85e, eb182ad0 of 9 Nov 2026).
 * Older rows keep their old hash and simply stop matching.
 */
export async function hypothesisCacheKey(hypothesis: string, version: number = PIPELINE_VERSION): Promise<string> {
  // NFKC turns the micro sign into Greek mu, so "10 µM" and an upper-cased "10 ΜM" share a key.
  const norm = (hypothesis ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${norm}\u0000pipeline:${version}`));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Whether a stored run (its qc or plan.verification) was made by an older pipeline. */
export function madeByOlderPipeline(stored: { pipeline_version?: unknown } | null | undefined): boolean {
  const v = Number(stored?.pipeline_version);
  return !Number.isFinite(v) || v < PIPELINE_VERSION;
}
