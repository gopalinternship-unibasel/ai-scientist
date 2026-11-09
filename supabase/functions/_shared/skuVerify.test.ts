// Tests for live SKU verification (skuVerify.ts) with a stubbed PubChem.
// Run: deno test --allow-net --allow-env --allow-read supabase/functions/_shared/
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { baseProductNumber, lookupSigmaSku, nameLooksRelated, verifyMaterialsLive } from "./skuVerify.ts";

// PubChem stub: known source IDs answer with the product name, anything else
// with PubChem's "Invalid identifier" 400.
function pubchem(known: Record<string, string>, calls: string[] = []): typeof fetch {
  return ((input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const id = decodeURIComponent(url.split("/Sigma-Aldrich/")[1].split("/")[0]);
    if (known[id]) {
      return Promise.resolve(new Response(JSON.stringify({
        InformationList: { Information: [{ SID: 1, Synonym: [known[id]] }] },
      }), { status: 200 }));
    }
    return Promise.resolve(new Response('{"Fault":{"Code":"PUGREST.BadRequest","Message":"Invalid identifier"}}', { status: 400 }));
  }) as typeof fetch;
}

Deno.test("baseProductNumber drops a pack-size suffix only", () => {
  assertEquals(baseProductNumber("PHR1084-1G"), "PHR1084");
  assertEquals(baseProductNumber("a1234-5ml"), "A1234");
  assertEquals(baseProductNumber("T0167"), "T0167");
});

Deno.test("lookupSigmaSku resolves a SKU and tries the next brand suffix on 400", async () => {
  const calls: string[] = [];
  const r = await lookupSigmaSku("T0167", "Sigma-Aldrich", pubchem({ T0167_SIAL: "D-(+)-Trehalose dihydrate" }, calls));
  assertEquals(r, { status: "found", name: "D-(+)-Trehalose dihydrate", source_id: "T0167_SIAL" });
  assertEquals(calls.length, 2); // _SIGMA (400) then _SIAL
});

Deno.test("lookupSigmaSku reports not_found after every brand, unknown on server errors", async () => {
  assertEquals(await lookupSigmaSku("Z9999", "Sigma", pubchem({})), { status: "not_found" });
  const down = (() => Promise.resolve(new Response("busy", { status: 503 }))) as typeof fetch;
  assertEquals(await lookupSigmaSku("T0167", "Sigma", down), { status: "unknown" });
  const offline = (() => Promise.reject(new Error("offline"))) as typeof fetch;
  assertEquals(await lookupSigmaSku("T0167", "Sigma", offline), { status: "unknown" });
});

Deno.test("nameLooksRelated compares substantive words and skips bare acronyms", () => {
  assertEquals(nameLooksRelated("Trehalose dihydrate", "D-(+)-Trehalose dihydrate, BioReagent"), true);
  assertEquals(nameLooksRelated("DMSO", "Dimethyl sulfoxide, Hybri-Max"), true);
  assertEquals(nameLooksRelated("Sodium azide", "D-(+)-Glucose, powder"), false);
});

Deno.test("verifyMaterialsLive flags only SKUs that resolve to a different product", async () => {
  const stub = pubchem({
    T0167_SIGMA: "D-(+)-Trehalose dihydrate, BioReagent",
    G7021_SIGMA: "D-(+)-Glucose, powder, BioReagent",
  });
  const issues = await verifyMaterialsLive([
    { name: "Trehalose dihydrate", supplier: "Sigma-Aldrich", catalog_number: "T0167" },   // matches
    { name: "Thermo DMEM", supplier: "Thermo Fisher", catalog_number: "11965092" },        // not Sigma → skipped
    { name: "Sodium pyruvate", supplier: "Sigma-Aldrich", catalog_number: "G7021" },       // wrong product
    { name: "Anti-CRP antibody", supplier: "Sigma-Aldrich", catalog_number: "C1688" },     // unknown to PubChem → no issue
  ], stub);
  assertEquals(issues.length, 1);
  assertEquals(issues[0].material_index, 2);
  assertEquals(issues[0].reason, "name_mismatch_on_supplier");
  assertEquals(issues[0].supplier_hint, 'Sigma-Aldrich lists this SKU as "D-(+)-Glucose, powder, BioReagent".');
});

Deno.test("verifyMaterialsLive never flags when the lookup service is down", async () => {
  const down = (() => Promise.resolve(new Response("busy", { status: 503 }))) as typeof fetch;
  const issues = await verifyMaterialsLive([{ name: "Glucose", supplier: "Sigma", catalog_number: "G7021" }], down);
  assertEquals(issues, []);
});
