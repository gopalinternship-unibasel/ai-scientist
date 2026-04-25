import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { findCatalogIssues } from "./catalogCheck.ts";
import { checkFeasibility } from "./feasibilityCheck.ts";

Deno.test("catalog format guard accepts well-formed IDT cat#s; flags malformed", () => {
  // 7-digit IDT numbers all pass the format guard — we cannot distinguish a
  // hallucinated 7-digit from a real 7-digit without a vendor API. The
  // strengthened plan-prompt is what discourages fabrication; the format
  // guard's job is only to catch obvious nonsense (letters, wrong length).
  const issues = findCatalogIssues([
    { name: "Alt-R Cas9", supplier: "IDT", catalog_number: "1074181" },     // wrong but well-formed
    { name: "Custom oligo", supplier: "IDT", catalog_number: "Custom" },
    { name: "Alt-R tracrRNA", supplier: "IDT", catalog_number: "1072558" }, // real
    { name: "Bogus", supplier: "IDT", catalog_number: "ABC-XYZ" },          // malformed
  ]);
  assert(issues.some((i) => i.catalog_number === "ABC-XYZ"), "should flag malformed");
  assert(!issues.some((i) => i.catalog_number === "Custom"), "Custom should pass");
});

Deno.test("catalog format guard accepts known good entries", () => {
  const issues = findCatalogIssues([
    { name: "Taq DNA Polymerase", supplier: "Thermo Fisher", catalog_number: "18038042" },
    { name: "DMEM, high glucose", supplier: "Thermo Fisher", catalog_number: "11965092" },
    { name: "Metformin Hydrochloride", supplier: "Sigma-Aldrich", catalog_number: "PHR1084-1G" },
    { name: "MCF-7", supplier: "ATCC", catalog_number: "HTB-22" },
    { name: "CellTiter-Glo", supplier: "Promega", catalog_number: "G7572" },
    { name: "Q5 Polymerase", supplier: "NEB", catalog_number: "M0491S" },
  ]);
  assertEquals(issues, []);
});

Deno.test("catalog format guard catches obviously fake Sigma SKU", () => {
  const issues = findCatalogIssues([
    { name: "Mystery Reagent", supplier: "Sigma-Aldrich", catalog_number: "ABC123XYZ" },
  ]);
  assertEquals(issues.length, 1);
  assertEquals(issues[0].reason, "format_mismatch");
});

Deno.test("feasibility blocks zebrafish at 4 K", () => {
  const r = checkFeasibility(
    "Quantum entanglement between trehalose-stabilized graphene nanofibers in a 4 K bath suppresses neuronal axon regeneration in zebrafish");
  assertEquals(r.ok, false);
  assertEquals(r.principle, "Cryogenic exposure of living vertebrates");
});

Deno.test("feasibility allows 4 K nanomaterial study without vertebrates", () => {
  const r = checkFeasibility(
    "Trehalose-stabilized graphene nanofibers exhibit quantum coherence at 4 K in a helium bath");
  assertEquals(r.ok, true);
});

Deno.test("feasibility still allows normal cell culture", () => {
  const r = checkFeasibility("Treating MCF-7 cells with 5 mM metformin reduces viability");
  assertEquals(r.ok, true);
});
