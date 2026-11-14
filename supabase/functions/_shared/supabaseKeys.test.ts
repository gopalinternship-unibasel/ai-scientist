import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { publicKey, serviceKey } from "./supabaseKeys.ts";

const env = (m: Record<string, string>) => (k: string) => m[k];

Deno.test("legacy key names are used when present", () => {
  const get = env({ SUPABASE_SERVICE_ROLE_KEY: "svc", SUPABASE_ANON_KEY: "anon" });
  assertEquals(serviceKey(get), "svc");
  assertEquals(publicKey(get), "anon");
});

Deno.test("legacy names win over the new dictionaries", () => {
  const get = env({
    SUPABASE_SERVICE_ROLE_KEY: "svc",
    SUPABASE_SECRET_KEYS: '{"default":"sb_secret_x"}',
    SUPABASE_ANON_KEY: "anon",
    SUPABASE_PUBLISHABLE_KEYS: '{"default":"sb_publishable_x"}',
  });
  assertEquals(serviceKey(get), "svc");
  assertEquals(publicKey(get), "anon");
});

Deno.test("new dictionaries give the default key", () => {
  const get = env({
    SUPABASE_SECRET_KEYS: '{"default":"sb_secret_x","other":"y"}',
    SUPABASE_PUBLISHABLE_KEYS: '{"default":"sb_publishable_x"}',
  });
  assertEquals(serviceKey(get), "sb_secret_x");
  assertEquals(publicKey(get), "sb_publishable_x");
});

Deno.test("empty legacy values fall through to the dictionaries", () => {
  const get = env({ SUPABASE_ANON_KEY: "  ", SUPABASE_PUBLISHABLE_KEYS: '{"default":"pk"}' });
  assertEquals(publicKey(get), "pk");
});

Deno.test("missing keys throw a clear error", () => {
  assertThrows(() => serviceKey(env({})), Error, "SUPABASE_SECRET_KEYS");
  assertThrows(() => publicKey(env({})), Error, "SUPABASE_PUBLISHABLE_KEYS");
});

Deno.test("a malformed dictionary throws instead of returning garbage", () => {
  assertThrows(() => serviceKey(env({ SUPABASE_SECRET_KEYS: "not json" })), Error, "not valid JSON");
  assertThrows(() => publicKey(env({ SUPABASE_PUBLISHABLE_KEYS: "{}" })), Error, "default");
});
