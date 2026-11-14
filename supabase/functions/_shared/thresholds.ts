// Similarity thresholds that depend on the embedding model. Each one can be
// set through an environment setting. The defaults for the related-work
// filter and the exact-match floor (0.66, 0.15, 0.78) were measured for the
// local model (nomic-embed-text); the feedback floor (0.55) dates from
// Google's text-embedding-004. A setting is used only when it is a number
// strictly between 0 and 1.

export function fractionSetting(raw: string | undefined, fallback: number): number {
  const t = raw?.trim();
  if (!t) return fallback;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : fallback;
}

export function denoSetting(name: string): string | undefined {
  return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(name);
}
