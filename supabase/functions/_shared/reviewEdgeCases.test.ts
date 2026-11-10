// Edge cases for the modules changed after QA round 3 that the tester's
// examples do not reach: bad data in the version chain, embeddings that
// fail half-way, feedback rows with missing numbers, verdicts that point
// outside the candidate list, and critique wording that only looks like a
// missing control.
// Run: deno test --allow-net --allow-env --allow-read --no-lock supabase/functions/_shared/
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadChain, MAX_CHAIN_DEPTH, nextVersion, parentVersion, sortChain } from "./versionChain.ts";
import { filterByEmbedding } from "./embeddingRelevance.ts";
import { rankFeedbackRows } from "./feedbackRetrieval.ts";
import { calibrateNovelty } from "./noveltyVerdict.ts";
import { tidyRationale } from "./noveltyClassifier.ts";
import { hypothesisConcepts } from "./hypothesisTerms.ts";
import { hypothesisCacheKey, madeByOlderPipeline, PIPELINE_VERSION } from "./pipelineVersion.ts";
import { claimedMissingControls, cleanCritique } from "./critiqueGuards.ts";
import { verifyPlan } from "./planGuards.ts";

const BUTYRATE = "Treating differentiated Caco-2 monolayers with 2 mM sodium butyrate for 72 hours will increase transepithelial electrical resistance (TEER) by at least 25% compared with untreated monolayers, measured with an epithelial voltohmmeter.";

type Row = { id: string; parent_run_id: string | null; version?: number | null; created_at?: string };
const loaders = (rows: Row[]) => ({
  one: (id: string) => Promise.resolve(rows.find((r) => r.id === id) ?? null),
  kids: (ids: string[]) => Promise.resolve(rows.filter((r) => r.parent_run_id !== null && ids.includes(r.parent_run_id))),
});

Deno.test("version chain: branches at every level, numbers missing or repeated, and unreadable parents", async () => {
  // v1 -> v2 -> v3, v1 -> v4, v2 -> v5, v4 -> v6
  const rows: Row[] = [
    { id: "a", parent_run_id: null, version: 1 }, { id: "b", parent_run_id: "a", version: 2 },
    { id: "c", parent_run_id: "b", version: 3 }, { id: "d", parent_run_id: "a", version: 4 },
    { id: "e", parent_run_id: "b", version: 5 }, { id: "f", parent_run_id: "d", version: 6 },
  ];
  const { one, kids } = loaders(rows);
  for (const start of rows) {
    const chain = await loadChain(start, one, kids);
    assertEquals(chain.map((r) => r.id), ["a", "b", "c", "d", "e", "f"], `from ${start.id}`);
    assertEquals(nextVersion(chain), 7);
  }
  assertEquals(parentVersion(rows, rows[5]), 4);
  assertEquals(parentVersion(rows, rows[0]), null);

  // Two refinements numbered alike before the fix: the next one is still above both, and their order is stable.
  const dup: Row[] = [
    { id: "a", parent_run_id: null, version: 1 }, { id: "b", parent_run_id: "a", version: 2 },
    { id: "z", parent_run_id: "b", version: 3, created_at: "2026-11-10T03:00:00Z" },
    { id: "y", parent_run_id: "a", version: 3, created_at: "2026-11-10T04:00:00Z" },
  ];
  const d = loaders(dup);
  const chain = await loadChain(dup[3], d.one, d.kids);
  assertEquals(chain.map((r) => r.id), ["a", "b", "z", "y"]);
  assertEquals(nextVersion(chain), 4);

  // A parent the viewer cannot read (another owner's run): the chain starts at what is readable.
  const orphan: Row[] = [{ id: "v2", parent_run_id: "hidden", version: 2 }, { id: "v3", parent_run_id: "v2", version: 3 }];
  const o = loaders(orphan);
  assertEquals((await loadChain(orphan[1], o.one, o.kids)).map((r) => r.id), ["v2", "v3"]);
  assertEquals(nextVersion(await loadChain(orphan[0], o.one, o.kids)), 4);

  // Bad data: a run that is its own parent, missing version numbers, a loader that throws.
  const self: Row[] = [{ id: "s", parent_run_id: "s", version: null }];
  const s = loaders(self);
  const sc = await loadChain(self[0], s.one, s.kids);
  assertEquals(sc.map((r) => r.id), ["s"]);
  assertEquals(nextVersion(sc), 2);
  assertEquals(nextVersion([]), 2);
  assertEquals(sortChain([{ id: "b", parent_run_id: null }, { id: "a", parent_run_id: null }]).map((r) => r.id), ["a", "b"]);
  let threw = false;
  await loadChain(rows[0], one, () => Promise.reject(new Error("offline"))).catch(() => { threw = true; });
  assert(threw, "a failed load is reported, not shown as a one-version chain");

  // A very deep chain ends at the depth limit instead of looping for ever.
  const deep: Row[] = Array.from({ length: MAX_CHAIN_DEPTH + 20 }, (_, i) => ({ id: `r${i}`, parent_run_id: i === 0 ? null : `r${i - 1}`, version: i + 1 }));
  const dl = loaders(deep);
  const dc = await loadChain(deep[0], dl.one, dl.kids);
  assert(dc.length >= MAX_CHAIN_DEPTH && dc.length <= deep.length, String(dc.length));
});

Deno.test("embedding filter: wrong shapes and failures keep every candidate; nothing near keeps none", async () => {
  const papers = [{ title: "A", abstract: null }, { title: "B" }, { title: "" }];
  const at = (cos: number) => [cos, Math.sqrt(1 - cos * cos)];
  // One vector too few, a rejected promise, an empty list: the filter did not run.
  for (const embed of [
    () => Promise.resolve([[1, 0], at(0.9), at(0.8)]),
    () => Promise.reject(new Error("timeout")),
    () => Promise.resolve([] as number[][]),
  ]) {
    const r = await filterByEmbedding("h", papers, { embed });
    assertEquals([r.available, r.kept.length, r.dropped.length], [false, 3, 0]);
  }
  // Every candidate below the floor: none is related work.
  const far = await filterByEmbedding("h", papers, { floor: 0.66, margin: 0.15, embed: () => Promise.resolve([[1, 0], at(0.6), at(0.5), at(0.3)]) });
  assertEquals([far.available, far.kept.length, far.dropped.length, far.threshold], [true, 0, 3, 0.66]);
  // A zero vector (an empty title) has no direction: similarity 0, dropped, no NaN.
  const zero = await filterByEmbedding("h", papers, { floor: 0.66, margin: 0.15, embed: () => Promise.resolve([[1, 0], at(0.9), at(0.8), [0, 0]]) });
  assertEquals(zero.kept.map((p) => p.title), ["A", "B"]);
  assertEquals(zero.dropped[0].embed_similarity, 0);
  // No candidates at all.
  assertEquals((await filterByEmbedding("h", [], { embed: () => Promise.resolve(null) })).kept, []);
});

Deno.test("lessons: rows with a missing or broken similarity rank last and stay within 0 to 1", () => {
  const ranked = rankFeedbackRows([
    { id: "nan", section: "materials", rating: 5, correction: "Use fatty-acid-free BSA.", similarity: "not a number" },
    { id: "none", section: "materials", rating: 1, correction: "List the stain." },
    { id: "high", section: "protocol", rating: 5, correction: "Fix before staining.", similarity: 1.2 },
    { id: "neg", section: "protocol", rating: 3, correction: "Wash twice.", similarity: -0.2 },
    { id: "empty", section: "protocol", rating: 3, correction: "   ", similarity: 0.9 },
  ], null);
  assertEquals(ranked[0].id, "high");
  assert(!ranked.some((h) => h.id === "empty"), "a blank correction is no lesson");
  for (const h of ranked) {
    assert(Number.isFinite(h.similarity) && h.similarity >= 0 && h.similarity <= 1, JSON.stringify(h));
    assert(Number.isFinite(h.score), JSON.stringify(h));
  }
});

Deno.test("novelty verdict: picks outside the candidate list, no candidates, and an exact match without evidence", () => {
  const concepts = hypothesisConcepts(BUTYRATE);
  const paper = { title: "Effects of sodium butyrate on the intestinal barrier function in a Caco-2 cell monolayer model", abstract: "Butyrate increased transepithelial electrical resistance (TEER).", relevance: 0.71, matched: ["Caco-2", "butyrate"], embed_similarity: 0.81 };
  // Indices that point nowhere are not references.
  const wild = calibrateNovelty({ signal: "similar", rationale: "x", chosen: [7, -1, 0, 99], semantic_overlap: "medium" }, [paper], concepts);
  assertEquals(wild.chosen, [0]);
  // "Exact match" or "similar" with nothing retrieved is "not found" with no references.
  for (const signal of ["exact_match", "similar"] as const) {
    const none = calibrateNovelty({ signal, rationale: "x", chosen: [0, 1], semantic_overlap: "high" }, [], concepts);
    assertEquals(none.chosen, [], signal);
    if (signal === "exact_match") assertEquals([none.signal, none.semantic_overlap], ["not_found", "low"]);
  }
  // In the pipeline "similar" needs a paper to show: picks that share next to
  // nothing with the hypothesis are dropped, and then nothing is left.
  const weak = { title: "Barrier function of epithelia: a review", relevance: 0.12, matched: [] };
  const pipeline = calibrateNovelty({ signal: "similar", rationale: "x", chosen: [0], semantic_overlap: "medium" }, [weak], concepts, { requireReference: true });
  assertEquals([pipeline.signal, pipeline.corrected_from, pipeline.chosen.length, pipeline.semantic_overlap], ["not_found", "similar", 0, "low"]);
  // The run page's re-check of older runs (titles only) leaves such a verdict alone.
  const page = calibrateNovelty({ signal: "similar", rationale: "x", chosen: [0], semantic_overlap: "medium" }, [weak], concepts);
  assertEquals([page.signal, page.corrected_from], ["similar", undefined]);
  // With a paper that is on topic the verdict stays and cites it.
  const kept = calibrateNovelty({ signal: "similar", rationale: "x", chosen: [], semantic_overlap: "medium" }, [paper], concepts, { requireReference: true });
  assertEquals([kept.signal, kept.chosen], ["similar", [0]]);
  // "Not found" stays when nothing is on topic, and cites nothing.
  const off = { title: "Hydrogenase from Clostridium", relevance: 0.1, matched: [] };
  const nf = calibrateNovelty({ signal: "not_found", rationale: "x", chosen: [0], semantic_overlap: "high" }, [off], concepts);
  assertEquals([nf.signal, nf.chosen.length, nf.semantic_overlap], ["not_found", 0, "low"]);
});

Deno.test("novelty rationale: a stray Chinese word and a sentence cut off by the length cap are tidied", () => {
  // Run 42c080d0 (10 Nov 2026, qwen2.5:7b): the 400-character cap cut the text after a Chinese "but".
  const cut = "The 2014 study examines the effect of sodium butyrate on the Caco-2 barrier model, including TER at 24, 48 and 72 hours. While the exact concentration and duration differ, both studies investigate the但";
  assertEquals(tidyRationale(cut, BUTYRATE), "The 2014 study examines the effect of sodium butyrate on the Caco-2 barrier model, including TER at 24, 48 and 72 hours.");
  assertEquals(tidyRationale("Related work exists，但 it uses another cell line.", BUTYRATE), "Related work exists it uses another cell line.");
  // One long unfinished sentence keeps its words and says it is cut.
  assertEquals(tidyRationale("Several papers treat Caco-2 monolayers with butyrate and measure", BUTYRATE), "Several papers treat Caco-2 monolayers with butyrate and measure...");
  // Finished text, quoted endings and empty text are left alone.
  for (const ok of ["No close match was retrieved.", 'It is closest to "the barrier paper".', "Similar (medium overlap)", ""]) {
    assertEquals(tidyRationale(ok, BUTYRATE), ok);
  }
  // A hypothesis written in Chinese keeps a Chinese rationale.
  assertEquals(tidyRationale("已有类似研究。", "丁酸钠提高Caco-2单层的跨上皮电阻。"), "已有类似研究。");
});

Deno.test("cache key and pipeline marker: odd inputs", async () => {
  assertEquals(await hypothesisCacheKey(""), await hypothesisCacheKey("   "));
  assert(await hypothesisCacheKey("a") !== await hypothesisCacheKey("b"));
  assertEquals((await hypothesisCacheKey("x")).length, 64);
  // The same text with the micro sign and with Greek mu is one hypothesis.
  assertEquals(await hypothesisCacheKey("10 µM metformin"), await hypothesisCacheKey("10 μM metformin"));
  for (const bad of [undefined, null, {}, { pipeline_version: "abc" }, { pipeline_version: null }, { pipeline_version: PIPELINE_VERSION - 1 }]) {
    assert(madeByOlderPipeline(bad as { pipeline_version?: unknown } | null | undefined), JSON.stringify(bad));
  }
  assertEquals(madeByOlderPipeline({ pipeline_version: String(PIPELINE_VERSION) }), false);
  assertEquals(madeByOlderPipeline({ pipeline_version: PIPELINE_VERSION + 1 }), false);
});

Deno.test("critique: 'quality control' is not a control group; a control the plan lacks stays a concern", () => {
  assertEquals(claimedMissingControls("The plan needs better quality control of the stain."), []);
  assertEquals(claimedMissingControls("No temperature control during imaging."), []);
  assertEquals(claimedMissingControls("Lacks a positive control."), ["positive"]);
  assertEquals(claimedMissingControls("Controls are well chosen."), []);
  const plan = { protocol: [{ title: "Vehicle Controls", description: "Run quality control on the plate reader. Treat untreated cells with vehicle only." }] };
  const c = cleanCritique({
    concerns: [
      { severity: "medium", area: "qc", issue: "The plan needs better quality control of the stain.", suggestion: "Add a reference dye." },
      { severity: "high", area: "controls", issue: "No positive control (for example an AMPK activator).", suggestion: "Add AICAR." },
      { severity: "high", area: "controls", issue: "Missing vehicle control.", suggestion: "Add one." },
    ],
  }, { plan });
  assertEquals(c?.concerns?.map((x) => x.area), ["qc", "controls"]);
  assertEquals(c?.concerns?.[1].issue, "No positive control (for example an AMPK activator).");
  // Nothing to clean, and no critique at all.
  assertEquals(cleanCritique(null, { plan }), null);
  assertEquals(cleanCritique({}, { plan: null })?.removed_concerns, undefined);
});

Deno.test("verifyPlan: a second pass over its own output changes nothing and keeps the looked-up statuses", () => {
  const materials = [
    { name: "Sodium butyrate", supplier: "Sigma-Aldrich", catalog_number: "B5887", total_cost_usd: 60 },
    { name: "Caco-2 cells", supplier: "ATCC", catalog_number: "CCL-22", total_cost_usd: 600 },
    { name: "Transwell inserts", supplier: "Corning", catalog_number: "3470", total_cost_usd: 300 },
  ];
  const protocol = [
    { step: 1, title: "Culture", description: "Culture Caco-2 cells on Transwell inserts for 21 days.", duration: "21 days" },
    { step: 2, title: "Treat", description: "Treat the monolayers with 2 mM sodium butyrate for 72 hours.", duration: "72 hours" },
    { step: 3, title: "Measure", description: "Measure TEER with an epithelial voltohmmeter.", duration: "1 hour" },
  ];
  const budget = { line_items: [{ category: "Materials", amount_usd: 960 }, { category: "Labour", amount_usd: 2000 }], total_usd: 2960 };
  const first = verifyPlan({ materials, protocol, budget, timeline: [{ phase: "All", duration: "4 weeks" }] }, {
    hypothesis: BUTYRATE, references: [], fresh: true,
    liveSku: [{ material_index: 0, catalog_number: "B5887", status: "match", source: "B5887_SIAL" }],
  });
  const mats = (p: { materials?: { catalog_number?: string; catalog_status?: string; notes?: string }[] }) =>
    (p.materials ?? []).map((m) => [m.catalog_number, m.catalog_status]);
  assertEquals(mats(first.plan), [["B5887", "verified"], ["HTB-37", "verified"], ["3470", "unverified"]]);
  // The cached copy: no live lookup this time.
  const second = verifyPlan(first.plan, { hypothesis: BUTYRATE, references: [] });
  assertEquals(mats(second.plan), mats(first.plan));
  assertEquals((second.plan.materials ?? [])[1].notes, (first.plan.materials ?? [])[1].notes, "the correction note is not added twice");
  assertEquals(second.verification.issues.map((i) => i.kind).sort(), first.verification.issues.map((i) => i.kind).sort());
  assertEquals(second.plan.budget?.total_usd, first.plan.budget?.total_usd);
});
