// Tests for live SKU verification (skuVerify.ts) with a stubbed PubChem.
// Run: deno test --allow-net --allow-env --allow-read supabase/functions/_shared/
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { baseProductNumber, lookupMaterialsLive, lookupSigmaSku, nameAgreement, nameLooksRelated, verifyMaterialsLive } from "./skuVerify.ts";

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

Deno.test("nameLooksRelated: another product is not related; a name of form words only is not judged", () => {
  assertEquals(nameLooksRelated("Trehalose dihydrate", "D-(+)-Trehalose dihydrate, BioReagent"), true);
  assertEquals(nameLooksRelated("Sodium azide", "D-(+)-Glucose, powder"), false);
  assertEquals(nameLooksRelated("Stock solution", "D-(+)-Glucose, powder"), true);
  // An acronym against the spelled-out name shares no word: the lookup asks
  // PubChem for the compound's other names before it decides (judged below).
  assertEquals(nameLooksRelated("DMSO", "Dimethyl sulfoxide, Hybri-Max"), false);
});

Deno.test("nameAgreement: same product, a related one, or a different one", () => {
  const same: Array<[string, string]> = [
    ["Sodium butyrate", "Sodium butyrate, >=98.5% (GC)"],
    ["Sodium butyrate (cell culture grade, 5 g)", "Sodium butyrate, >=98.5% (GC)"],
    ["Palmitate", "Palmitic acid, >=99%"],
    ["Nicotinamide mononucleotide (NMN)", "beta-Nicotinamide mononucleotide, >=95% (HPLC)"],
    ["Oil Red O powder", "Oil Red O"],
    ["Triton X-100", "Triton(TM) X-100, for molecular biology"],
    ["Dimethyl sulfoxide (DMSO)", "Dimethyl sulfoxide, for molecular biology"],
    ["Albumin, bovine serum", "Bovine Serum Albumin, heat shock fraction"],
    ["Metformin hydrochloride", "Metformin HCL"],
    ["D-(+)-Glucose", "D-(+)-Glucose, powder, BioReagent"],
  ];
  for (const [a, b] of same) assertEquals(nameAgreement(a, [b]).agreement, "same", `${a} / ${b}`);
  const related: Array<[string, string]> = [
    ["Glucose", "Glucose oxidase from Aspergillus niger"],
    ["Trypsin", "Trypsin inhibitor from Glycine max (soybean)"],
    ["Tween 20", "TWEEN 80"],
    ["Palmitate-BSA conjugate", "Palmitic acid, >=99%"],
  ];
  for (const [a, b] of related) assertEquals(nameAgreement(a, [b]).agreement, "related", `${a} / ${b}`);
  const different: Array<[string, string]> = [
    ["Sodium butyrate", "Sodium chloride, BioXtra, >=99.5% (AT)"],
    ["BSA", "Dimethyl sulfoxide, for molecular biology"],
    ["Metformin", "D-(+)-Trehalose dihydrate"],
    ["Magnesium sulfate", "Sodium sulfate, anhydrous"],
    // Only common ions in common: another salt, not a related product.
    ["Sodium phosphate dibasic", "Sodium phosphate monobasic"],
    ["", "Sodium chloride"],
  ];
  for (const [a, b] of different) assertEquals(nameAgreement(a, [b]).agreement, "different", `${a} / ${b}`);
  // Any one of several catalogue names is enough, and it is reported.
  assertEquals(nameAgreement("Metformin", ["1,1-Dimethylbiguanide hydrochloride", "Metformin hydrochloride", "Glucophage"]),
    { agreement: "same", matched: "Metformin hydrochloride" });
});

// A fuller PubChem stub: product names by source ID, the compound behind a
// source ID, and the compound's other names.
function pubchemFull(
  products: Record<string, string>,
  cids: Record<string, number>,
  names: Record<number, string[]>,
  opts: { synonymsDown?: boolean } = {},
): typeof fetch {
  return ((input: string | URL | Request) => {
    const url = String(input);
    const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
    const compound = url.match(/\/compound\/cid\/(\d+)\/synonyms\//);
    if (compound) {
      if (opts.synonymsDown) return json({}, 503);
      return json({ InformationList: { Information: [{ CID: Number(compound[1]), Synonym: names[Number(compound[1])] ?? [] }] } });
    }
    const id = decodeURIComponent(url.split("/Sigma-Aldrich/")[1].split("/")[0]);
    if (!products[id]) return json({ Fault: { Message: "Invalid identifier" } }, 400);
    if (url.includes("/cids/")) return json({ InformationList: { Information: [{ SID: 1, ...(cids[id] ? { CID: [cids[id]] } : {}) }] } });
    return json({ InformationList: { Information: [{ SID: 1, Synonym: [products[id]] }] } });
  }) as typeof fetch;
}

Deno.test("lookupMaterialsLive: verified only when the names agree, by product name or by a PubChem compound name", async () => {
  const products = {
    D150959_SIGMA: "1,1-Dimethylbiguanide hydrochloride, 97%",
    S7653_SIGMA: "Sodium chloride, BioXtra, >=99.5% (AT)",
    D8418_SIGMA: "Dimethyl sulfoxide, for molecular biology",
    G7141_SIGMA: "Glucose Oxidase from Aspergillus niger",
    B5887_SIGMA: "Sodium butyrate, >=98.5% (GC)",
  };
  const cids = { D150959_SIGMA: 14219, S7653_SIGMA: 5234, D8418_SIGMA: 679 };
  const names = {
    14219: ["Metformin hydrochloride", "1115-70-4", "1,1-Dimethylbiguanide hydrochloride", "Glucophage"],
    5234: ["sodium chloride", "Salt", "Halite", "Table salt"],
    679: ["dimethyl sulfoxide", "67-68-5", "DMSO", "Methyl sulfoxide"],
  };
  const materials = [
    { name: "Metformin", supplier: "Sigma-Aldrich", catalog_number: "D150959" },           // a real pairing under another name
    { name: "Sodium butyrate", supplier: "Sigma-Aldrich", catalog_number: "S7653" },       // sodium chloride's number
    { name: "BSA", supplier: "Sigma-Aldrich", catalog_number: "D8418" },                    // DMSO's number
    { name: "DMSO", supplier: "Sigma-Aldrich", catalog_number: "D8418" },                   // the acronym of the right product
    { name: "Glucose", supplier: "Sigma-Aldrich", catalog_number: "G7141" },                // glucose oxidase: related, not the same
    { name: "Sodium butyrate", supplier: "Sigma-Aldrich", catalog_number: "B5887" },
    { name: "Stock solution", supplier: "Sigma-Aldrich", catalog_number: "B5887" },         // nothing to compare
  ];
  const r = await lookupMaterialsLive(materials, pubchemFull(products, cids, names));
  assertEquals(r.map((x) => x.status), ["match", "mismatch", "mismatch", "match", "unconfirmed", "match", "unconfirmed"]);
  assertEquals(r[0].source, 'D150959_SIGMA; PubChem also names this compound "Metformin hydrochloride"');
  assertEquals(r[1].supplier_hint, 'Sigma-Aldrich lists this SKU as "Sodium chloride, BioXtra, >=99.5% (AT)".');
  assertEquals(r[5].source, "B5887_SIGMA");

  // When the compound's names cannot be fetched, a name that does not agree is left open, not called wrong.
  const down = await lookupMaterialsLive(materials.slice(0, 2), pubchemFull(products, cids, names, { synonymsDown: true }));
  assertEquals(down.map((x) => x.status), ["unconfirmed", "unconfirmed"]);
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
