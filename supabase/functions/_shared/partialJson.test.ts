// Run: deno test --allow-net --allow-env --allow-read supabase/functions/_shared/
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { tryParsePartial } from "./partialJson.ts";

const full = JSON.stringify({
  title: "T", domain: "cell-biology", success_criteria: ["a", "b"],
  protocol: [{ step: 1, title: "Freeze", duration: "1 day" }], budget: { total_usd: 10 },
});

Deno.test("tryParsePartial returns a complete object unchanged", () => {
  assertEquals(tryParsePartial(full), JSON.parse(full));
});

Deno.test("tryParsePartial lists the sections started so far at every cut point", () => {
  let last: string[] = [];
  for (let n = 2; n < full.length; n++) {
    const p = tryParsePartial(full.slice(0, n));
    if (!p) continue;
    const keys = Object.keys(p);
    // Sections only ever grow as more text streams in.
    assertEquals(keys.slice(0, last.length), last);
    last = keys;
  }
  assertEquals(last, ["title", "domain", "success_criteria", "protocol", "budget"]);
});

Deno.test("tryParsePartial closes nested arrays and objects in the right order", () => {
  const p = tryParsePartial('{"title":"T","protocol":[{"step":1,"title":"Fre');
  assertEquals(p, { title: "T", protocol: [{ step: 1, title: "Fre" }] });
});

Deno.test("tryParsePartial drops a key or scalar that is cut off", () => {
  assertEquals(tryParsePartial('{"title":"T","alpha":0.'), { title: "T" });
  assertEquals(tryParsePartial('{"title":"T","dom'), { title: "T" });
  assertEquals(tryParsePartial('{"title":"T","ok":tr'), { title: "T" });
  assertEquals(tryParsePartial('{"title":"T", "domain":'), { title: "T" });
});

Deno.test("tryParsePartial ignores text that is not an object", () => {
  assertEquals(tryParsePartial("Sure, here is"), null);
  assertEquals(tryParsePartial(""), null);
});
