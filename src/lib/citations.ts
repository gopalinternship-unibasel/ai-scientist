/**
 * Client-side mirror of the edge function's citation sanitizer. Used for
 * defense-in-depth on already-stored runs and for unit testing the regex
 * behavior in jsdom (the edge module imports Deno-only types).
 *
 * Removes inline `(see [N])` references whose index is out of range for the
 * provided literature list length.
 */
const CITATION_RE = /\(\s*see\s*\[([^\]]+)\]\s*\)/gi;

export function sanitizeCitations<T extends { description?: string }>(
  steps: T[] | undefined,
  validIndexCount: number,
): T[] {
  if (!Array.isArray(steps)) return steps ?? [];
  return steps.map((s) => {
    if (typeof s?.description !== "string") return s;
    const cleaned = s.description
      .replace(CITATION_RE, (_match, inner: string) => {
        const valid = String(inner)
          .split(/[,\s]+/)
          .map((n) => parseInt(n, 10))
          .filter((n) => Number.isInteger(n) && n >= 1 && n <= validIndexCount);
        if (valid.length === 0) return "";
        return `(see [${valid.join(", ")}])`;
      })
      .replace(/\s{2,}/g, " ")
      .trim();
    return { ...s, description: cleaned };
  });
}
