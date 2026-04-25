/**
 * Validate inline `(see [N])` style citations the model emits in protocol step
 * descriptions. Removes references to indices that don't exist in the actual
 * paper list, preventing hallucinated citations from reaching the user.
 *
 * Accepts shapes like:  (see [1])   (see [1, 3])   (see [12])
 * Indices are 1-based to match the prompt convention.
 */
const CITATION_RE = /\(\s*see\s*\[([^\]]+)\]\s*\)/gi;

export function sanitizeCitations<T extends { description?: string }>(
  steps: T[] | undefined,
  validIndexCount: number,
): T[] {
  if (!Array.isArray(steps)) return steps ?? [];
  return steps.map((s) => {
    if (typeof s?.description !== "string") return s;
    const cleaned = s.description.replace(CITATION_RE, (_match, inner: string) => {
      const valid = String(inner)
        .split(/[,\s]+/)
        .map((n) => parseInt(n, 10))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= validIndexCount);
      if (valid.length === 0) return ""; // strip bogus citation entirely
      return `(see [${valid.join(", ")}])`;
    }).replace(/\s{2,}/g, " ").trim();
    return { ...s, description: cleaned };
  });
}
