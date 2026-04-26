import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkFeasibility } from "./feasibilityCheck.ts";

Deno.test("Abbe limit: blocks atom-imaging via light microscopy", () => {
  const r = checkFeasibility("Use confocal microscopy to image individual gold atoms in nanoparticles.");
  assertEquals(r.ok, false);
  assertEquals(r.principle, "Abbe diffraction limit");
});

Deno.test("FTL: blocks superluminal signalling", () => {
  const r = checkFeasibility("Demonstrate faster-than-light information transfer between two photonic chips.");
  assertEquals(r.ok, false);
});

Deno.test("Cryogenic vertebrate: blocks live-mouse 4K exposure", () => {
  const r = checkFeasibility("Cool live mice to liquid helium temperature and measure neural activity.");
  assertEquals(r.ok, false);
});

Deno.test("Sub-ms qPCR: blocks impossible PCR timescale", () => {
  const r = checkFeasibility("Measure gene expression changes by qPCR with sub-millisecond temporal resolution.");
  assertEquals(r.ok, false);
  assertEquals(r.principle, "Sub-millisecond PCR / qPCR readout");
});

Deno.test("Mammalian without CO2: blocks HeLa in ambient air", () => {
  const r = checkFeasibility("Grow HeLa cells in DMEM in ambient air without CO2 for two weeks.");
  assertEquals(r.ok, false);
});

Deno.test("RT superconductor: blocks ambient-pressure claim", () => {
  const r = checkFeasibility("Demonstrate room-temperature superconductivity in copper at ambient pressure.");
  assertEquals(r.ok, false);
});

Deno.test("Valid hypothesis: passes", () => {
  const r = checkFeasibility("Test whether resveratrol at 50 µM reduces proliferation of MCF-7 breast cancer cells.");
  assertEquals(r.ok, true);
});
