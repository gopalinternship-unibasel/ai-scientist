// Similarity thresholds that depend on the embedding model. Each one can be
// set through an environment setting; the defaults are the values measured for
// the local model (nomic-embed-text). A setting is used only when it is a
// number strictly between 0 and 1.

export function fractionSetting(raw: string | undefined, fallback: number): number {
  const t = raw?.trim();
  if (!t) return fallback;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : fallback;
}

export function denoSetting(name: string): string | undefined {
  return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(name);
}
