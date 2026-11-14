// Supabase API keys for the edge functions.
//
// Projects made before Nov 2025 (and the local stack) inject the legacy keys
// SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY. New hosted projects inject
// SUPABASE_PUBLISHABLE_KEYS and SUPABASE_SECRET_KEYS instead: JSON objects
// that hold the key under "default". The legacy name wins when both exist, so
// the local stack behaves as before.

type EnvGet = (name: string) => string | undefined;

const denoEnv: EnvGet = (name) =>
  (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(name);

function nonEmpty(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

function fromDictionary(raw: string | undefined, label: string): string | undefined {
  const text = nonEmpty(raw);
  if (!text) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  const key = (parsed as { default?: unknown } | null)?.default;
  if (typeof key !== "string" || !key.trim()) throw new Error(`${label} has no "default" key`);
  return key.trim();
}

/** Key with full database access (service role key or default secret key). */
export function serviceKey(get: EnvGet = denoEnv): string {
  const key = nonEmpty(get("SUPABASE_SERVICE_ROLE_KEY")) ?? fromDictionary(get("SUPABASE_SECRET_KEYS"), "SUPABASE_SECRET_KEYS");
  if (!key) throw new Error("No Supabase secret key: set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEYS");
  return key;
}

/** Public key (anon key or default publishable key). */
export function publicKey(get: EnvGet = denoEnv): string {
  const key = nonEmpty(get("SUPABASE_ANON_KEY")) ?? fromDictionary(get("SUPABASE_PUBLISHABLE_KEYS"), "SUPABASE_PUBLISHABLE_KEYS");
  if (!key) throw new Error("No Supabase public key: set SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEYS");
  return key;
}
