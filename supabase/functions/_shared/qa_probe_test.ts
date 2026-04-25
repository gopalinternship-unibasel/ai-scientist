// One-shot QA probe: exercises real literature search + ranking + canonical
// detection + feasibility + hypothesis gate against the live external APIs.
// Run via supabase--test_edge_functions.

import { searchLiterature } from "./literature.ts";
import { rankByRelevance } from "./relevanceRank.ts";
import { detectCanonicalTechnique } from "./canonicalTechniques.ts";
import { checkFeasibility } from "./feasibilityCheck.ts";

const RELEVANCE_FLOOR = 0.015;

async function probe(label: string, h: string) {
  console.log("\n================================================================");
  console.log("PROBE:", label);
  console.log("INPUT:", h);
  // 1) feasibility
  const feas = checkFeasibility(h);
  console.log("feasibility:", feas.ok ? "OK" : `BLOCKED — ${feas.principle}`);
  if (!feas.ok) return;
  // 2) canonical
  const canon = detectCanonicalTechnique(h);
  console.log("canonical:", canon.matched ? canon.name : "no");
  // 3) literature
  const lit = await searchLiterature(h);
  console.log(`literature: ${lit.papers.length} papers (s2:${lit.sources.s2} oa:${lit.sources.openalex} pm:${lit.sources.pubmed})`);
  const ranked = rankByRelevance(lit.papers, h);
  const top = ranked.slice(0, 3);
  for (const p of top) {
    console.log(`  • [${p.relevance.toFixed(3)}] ${p.title.slice(0, 90)}  (${p.source}, ${p.year ?? "?"})`);
  }
  const topRel = ranked[0]?.relevance ?? 0;
  let signal: string;
  if (canon.matched && topRel >= RELEVANCE_FLOOR) signal = "exact_match (canonical override)";
  else if (ranked.length === 0 || topRel < RELEVANCE_FLOOR) signal = "not_found (no relevant lit)";
  else signal = "similar (LLM would classify)";
  console.log("→ heuristic signal:", signal);
}

Deno.test({
  name: "QA probe – literature QC across 3 cases",
  sanitizeOps: false, sanitizeResources: false,
  async fn() {
    await probe("LIT-1 canonical PCR",
      "Standard PCR amplification of the human GAPDH gene from genomic DNA using Taq polymerase");
    await probe("LIT-2 deeply novel (should be not_found)",
      "Quantum entanglement between trehalose-stabilized graphene nanofibers in a 4 K bath suppresses neuronal axon regeneration in zebrafish");
    await probe("LIT-3 in-between (CRISPR in axolotl)",
      "CRISPR-Cas9 knockout of Sox2 in axolotl limb blastema cells impairs digit regeneration");
  },
});

Deno.test("QA probe – feasibility + gate edge cases", () => {
  const cases = [
    "improve cancer treatment",
    "I really love eating pizza on Fridays with friends",
    "Use a standard brightfield optical microscope at 400x to directly resolve individual carbon atoms in a graphene lattice",
    "Build a perpetual motion machine that outputs more energy than it consumes",
    "Send a faster-than-light signal between two quantum-entangled photons to transmit classical information",
  ];
  for (const c of cases) {
    const f = checkFeasibility(c);
    console.log(`  feas("${c.slice(0, 60)}…") → ${f.ok ? "OK" : "BLOCKED: " + f.principle}`);
  }
});
