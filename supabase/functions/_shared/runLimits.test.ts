import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideRunLimit, hostedCapsActive, quotaFor, resolveRunCaps } from "./runLimits.ts";

const caps = { global: 40, anon: 3, user: 10 };

Deno.test("caps are read from settings and ignore junk", () => {
  assertEquals(resolveRunCaps({}), { global: null, anon: null, user: null });
  assertEquals(
    resolveRunCaps({ RUN_LIMIT_GLOBAL_PER_DAY: "40", RUN_LIMIT_ANON_PER_DAY: " 3 ", RUN_LIMIT_USER_PER_DAY: "0" }),
    { global: 40, anon: 3, user: null },
  );
  assertEquals(resolveRunCaps({ RUN_LIMIT_ANON_PER_DAY: "abc" }).anon, null);
  assert(!hostedCapsActive(resolveRunCaps({})));
  assert(hostedCapsActive(resolveRunCaps({ RUN_LIMIT_GLOBAL_PER_DAY: "5" })));
});

Deno.test("a run under every cap is allowed", () => {
  assertEquals(decideRunLimit(caps, false, { identity: 2, global: 39 }).ok, true);
  assertEquals(decideRunLimit(caps, true, { identity: 9, global: 0 }).ok, true);
});

Deno.test("the fourth run of an anonymous visitor is refused with the visitor message", () => {
  const d = decideRunLimit(caps, false, { identity: 3, global: 10 });
  assertEquals(d.ok, false);
  assertEquals(d.reason, "identity");
  assert(d.message!.includes("3 new plans per day"));
});

Deno.test("the eleventh run of a signed-in user is refused, the anonymous cap does not apply to them", () => {
  assertEquals(decideRunLimit(caps, true, { identity: 10, global: 10 }).ok, false);
  assertEquals(decideRunLimit(caps, true, { identity: 5, global: 10 }).ok, true);
});

Deno.test("the global cap stops everyone, signed in or not", () => {
  for (const signedIn of [true, false]) {
    const d = decideRunLimit(caps, signedIn, { identity: 0, global: 40 });
    assertEquals(d.ok, false);
    assertEquals(d.reason, "global");
    assert(d.message!.includes("daily limit for this demo"));
  }
});

Deno.test("a cap that is not set does not apply", () => {
  const onlyGlobal = { global: 5, anon: null, user: null };
  assertEquals(decideRunLimit(onlyGlobal, false, { identity: 99, global: 4 }).ok, true);
  assertEquals(decideRunLimit(onlyGlobal, false, { identity: 0, global: 5 }).ok, false);
  const none = { global: null, anon: null, user: null };
  assertEquals(decideRunLimit(none, false, { identity: 1000, global: 1000 }).ok, true);
});

Deno.test("quota shows the hourly local rule when no cap is set", () => {
  const q = quotaFor({ global: null, anon: null, user: null }, false, { identity: 4, global: 4 });
  assertEquals(q, { limit: 100, used: 4, remaining: 96, window: "hour" });
});

Deno.test("quota remaining is the smaller of the identity and global rooms", () => {
  assertEquals(quotaFor(caps, false, { identity: 1, global: 10 }), { limit: 3, used: 1, remaining: 2, window: "day" });
  assertEquals(quotaFor(caps, false, { identity: 1, global: 39 }).remaining, 1);
  assertEquals(quotaFor(caps, true, { identity: 0, global: 40 }).remaining, 0);
});

Deno.test("quota stays numeric for every partial combination of caps", () => {
  const combos = [
    { global: 5, anon: null, user: null },
    { global: null, anon: 3, user: null },
    { global: null, anon: null, user: 10 },
    { global: 5, anon: 3, user: null },
    { global: 5, anon: null, user: 10 },
    { global: null, anon: 3, user: 10 },
  ];
  for (const c of combos) {
    for (const signedIn of [false, true]) {
      const q = quotaFor(c, signedIn, { identity: 2, global: 7 });
      for (const v of [q.limit, q.used, q.remaining]) assert(Number.isFinite(v), JSON.stringify({ c, signedIn, q }));
      assert(q.limit > 0, JSON.stringify({ c, signedIn, q }));
      assertEquals(JSON.parse(JSON.stringify(q)).remaining, q.remaining);
    }
  }
});

Deno.test("quota for a caller no set cap applies to shows the local figure", () => {
  // Only the visitor cap is set and the caller is signed in.
  assertEquals(
    quotaFor({ global: null, anon: 3, user: null }, true, { identity: 2, global: 7 }),
    { limit: 100, used: 2, remaining: 98, window: "day" },
  );
});
