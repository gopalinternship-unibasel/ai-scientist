// Literature queries, relevance and the novelty verdict check (QA round 2,
// 9 Nov 2026). Paper titles below are ones the live APIs returned for these
// hypotheses on 9 Nov 2026.
// Run: deno test --allow-net --allow-env --allow-read supabase/functions/_shared/
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { anchorConcepts, coreQuery, hypothesisConcepts, keywordQuery } from "./hypothesisTerms.ts";
import { degradedQueries } from "./queryDegradation.ts";
import { rankByRelevance } from "./relevanceRank.ts";
import { calibrateNovelty } from "./noveltyVerdict.ts";
import { detectCanonicalTechnique } from "./canonicalTechniques.ts";
import { NOVELTY_CALIBRATION } from "./noveltyCalibration.ts";
import type { LitPaper } from "./literature.ts";

const METFORMIN = "Treating HepG2 hepatocytes with 10 µM metformin for 24 hours before a 0.5 mM palmitate challenge will reduce intracellular lipid accumulation, measured by Oil Red O staining, by at least 30% compared with vehicle-treated palmitate controls.";
const NMN = "Treating SH-SY5Y neuroblastoma cells with 1 mM nicotinamide mononucleotide (NMN) for 24 hours will raise intracellular NAD+ levels by at least 40% compared with vehicle-treated cells, measured with a luminescent NAD/NADH assay.";
const CRP = "A paper-based electrochemical biosensor functionalized with anti-CRP antibodies will detect C-reactive protein in whole blood at concentrations below 0.5 mg/L within 10 minutes, matching laboratory ELISA sensitivity without requiring sample preprocessing.";

const paper = (title: string, abstract: string | null = null, source: LitPaper["source"] = "pubmed"): LitPaper => ({ source, title, abstract });

// --- queries -----------------------------------------------------------------------

Deno.test("queries keep the compound, the challenge and the readout (not 'treating ... hours')", () => {
  const qs = degradedQueries(METFORMIN);
  assertEquals(qs[0], METFORMIN, "full sentence first");
  assert(qs.includes("HepG2 metformin palmitate lipid"), JSON.stringify(qs));
  assert(qs.includes("metformin palmitate lipid"), "intervention and outcome without the cell line");
  for (const q of qs.slice(1)) assertFalse(/treating|hours|before|challenge|measured/i.test(q), q);
});

Deno.test("an acronym in parentheses is the same concept as the words before it", () => {
  const c = hypothesisConcepts(NMN);
  const nmn = c.find((x) => x.query === "nicotinamide mononucleotide");
  assert(nmn, JSON.stringify(c.map((x) => x.query)));
  assertEquals(nmn.forms, [["nicotinamide", "mononucleotide"], ["nmn"]]);
  assertEquals(coreQuery(c), "nicotinamide mononucleotide NAD+ NADH");
  // "HepG2 cells (ATCC)" is not an alias
  assertFalse(hypothesisConcepts("Grow HepG2 cells (ATCC) with 10 uM metformin").some((x) => x.forms.some((f) => f.includes("atcc") && f.includes("hepg2"))));
});

Deno.test("the comparator of a new device is not a subject term", () => {
  const c = hypothesisConcepts(CRP);
  assertEquals(c.find((x) => x.query === "ELISA")?.comparator, true);
  assertEquals(keywordQuery(c, 3), "biosensor anti-CRP antibodies");
  assertFalse(anchorConcepts(c).some((x) => x.query === "ELISA"));
});

Deno.test("capitals-only input reads the same as normal case", () => {
  const a = keywordQuery(hypothesisConcepts(METFORMIN), 4).toLowerCase();
  const b = keywordQuery(hypothesisConcepts(METFORMIN.toUpperCase()), 4).toLowerCase();
  assertEquals(a, b);
});

// --- relevance --------------------------------------------------------------------------

Deno.test("relevance: a metformin + palmitate + HepG2 paper outranks generic HepG2 papers", () => {
  const ranked = rankByRelevance([
    paper("HepG2 cell line: a model for hepatotoxicity studies"),
    paper("Metformin regulates palmitate-induced apoptosis and ER stress response in HepG2 liver cells."),
    paper("Effects of Piperine on Insulin Resistance and Lipid Accumulation in Palmitate-treated HepG2 Cells", null, "openalex"),
    paper("Relative Frequency of HTLV-I Infection in Blood Donors in Ahvaz, Southwest of Iran."),
  ], METFORMIN);
  assert(ranked[0].title.startsWith("Effects of Piperine") || ranked[0].title.startsWith("Metformin regulates"));
  assert(ranked[0].relevance >= 0.35 && ranked[1].relevance >= 0.35);
  assertEquals(ranked[3].relevance, 0);
  assert(ranked.find((p) => p.title.startsWith("Metformin"))!.matched.includes("metformin"));
});

// --- verdict check --------------------------------------------------------------------------

Deno.test("verdict: 'not found' with palmitate-treated HepG2 lipid papers becomes 'similar' (run 020ae70a)", () => {
  const concepts = hypothesisConcepts(METFORMIN);
  const ranked = rankByRelevance([
    paper("Effects of Piperine on Insulin Resistance and Lipid Accumulation in Palmitate-treated HepG2 Cells", null, "openalex"),
    paper("Effects of grape peel phenolics on lipid accumulation in sodium palmitate-treated HepG2 cells", null, "openalex"),
    paper("Effect of Carotenoids from Phaeodactylum tricornutum on Palmitate-Treated HepG2 Cells", null, "openalex"),
  ], METFORMIN, concepts);
  const v = calibrateNovelty({ signal: "not_found", rationale: "None of the candidates discuss metformin.", chosen: [], semantic_overlap: "low" }, ranked, concepts);
  assertEquals(v.signal, "similar");
  assertEquals(v.corrected_from, "not_found");
  assertEquals(v.semantic_overlap, "medium");
  assert(v.chosen.length >= 2);
  assert(v.rationale.includes("Related prior work was retrieved"));
});

Deno.test("verdict: 'not found' + 'semantic overlap high' for NMN raising NAD+ is not left contradictory (run 633e1d4f)", () => {
  const concepts = hypothesisConcepts(NMN);
  const ranked = rankByRelevance([
    paper("Nicotinamide Mononucleotide Supplementation Improves Mitochondrial Dysfunction and Rescues Cellular Senescence", "NMN raised NAD+ and lowered the NADH ratio.", "openalex"),
    paper("Targeting NAMPT with antibody-drug conjugates in neuroblastoma"),
  ], NMN, concepts);
  const v = calibrateNovelty({ signal: "not_found", rationale: "x", chosen: [], semantic_overlap: "high" }, ranked, concepts);
  assertEquals(v.signal, "similar");
  assertEquals(v.chosen[0], 0);
});

Deno.test("verdict: 'exact match' needs a paper that names the hypothesis' core", () => {
  const concepts = hypothesisConcepts(CRP);
  const offTopic = rankByRelevance([
    paper("An improved slot blot assay for protein quantification in serum samples."),
    paper("Rapid detection of Peste des Petits ruminants virus using RT-LAMP with FTA card-based sample preservation."),
  ], CRP, concepts);
  const a = calibrateNovelty({ signal: "exact_match", rationale: "x", chosen: [0, 1], semantic_overlap: "high" }, offTopic, concepts);
  assertEquals(a.signal, "not_found");
  assertEquals(a.chosen, [], "off-topic papers are not shown as references");
  assertEquals(a.semantic_overlap, "low");

  const met = hypothesisConcepts(METFORMIN);
  const sameSystemOtherOutcome = rankByRelevance([
    paper("Metformin regulates palmitate-induced apoptosis and ER stress response in HepG2 liver cells."),
  ], METFORMIN, met);
  const b = calibrateNovelty({ signal: "exact_match", rationale: "x", chosen: [0], semantic_overlap: "high" }, sameSystemOtherOutcome, met);
  assertEquals(b.signal, "similar");

  const same = rankByRelevance([
    paper("Metformin attenuates palmitate-induced lipid accumulation in HepG2 hepatocytes"),
  ], METFORMIN, met);
  const c = calibrateNovelty({ signal: "exact_match", rationale: "x", chosen: [0], semantic_overlap: "high" }, same, met);
  assertEquals(c.signal, "exact_match");
  assertEquals(c.corrected_from, undefined);
});

Deno.test("verdict: 'not found' with nothing on-topic stays 'not found' with low overlap", () => {
  const concepts = hypothesisConcepts(METFORMIN);
  const ranked = rankByRelevance([paper("Relative Frequency of HTLV-I Infection in Blood Donors")], METFORMIN, concepts);
  const v = calibrateNovelty({ signal: "not_found", rationale: "x", chosen: [0], semantic_overlap: "high" }, ranked, concepts);
  assertEquals(v.signal, "not_found");
  assertEquals(v.chosen, []);
  assertEquals(v.semantic_overlap, "low");
});

// --- canonical techniques --------------------------------------------------------------

Deno.test("canonical rule: a biosensor compared with ELISA and a claim measured by Western blot are not canonical", () => {
  assertFalse(detectCanonicalTechnique(CRP).matched);
  assertFalse(detectCanonicalTechnique("Treating HeLa cells with 5 uM cisplatin will reduce BCL-2 protein by 50%, measured by Western blot.").matched);
});

Deno.test("canonical rule: the calibration set's protocol requests still match", () => {
  for (const c of NOVELTY_CALIBRATION.filter((x) => x.expected_signal === "exact_match")) {
    assert(detectCanonicalTechnique(c.hypothesis).matched, c.hypothesis);
  }
});
