/**
 * Client-side mirror of the edge function's citation sanitizer. Used for
 * defense-in-depth on already-stored runs and for unit testing the regex
 * behavior in jsdom (the edge module imports Deno-only types).
 */

const SEE_RE = /\(\s*see\s*\[([^\]]+)\]\s*\)/gi;
const REF_RE = /[\(\[]\s*refs?\.?\s+([0-9 ,\-]+?)\s*[\)\]]/gi;
const BARE_RE = /\[\s*(\d+(?:\s*[,\s]\s*\d+)*)\s*\]/g;

function expandRange(s: string): number[] {
  const out: number[] = [];
  for (const part of s.split(/[,\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = parseInt(m[1], 10);
    const b = m[2] ? parseInt(m[2], 10) : a;
    if (Number.isInteger(a) && Number.isInteger(b) && a <= b && b - a < 20) {
      for (let i = a; i <= b; i++) out.push(i);
    }
  }
  return out;
}

function validIndices(raw: string, max: number): number[] {
  return Array.from(new Set(expandRange(raw)))
    .filter((n) => n >= 1 && n <= max)
    .sort((a, b) => a - b);
}

export function sanitizeCitations<T extends { description?: string }>(
  steps: T[] | undefined,
  validIndexCount: number,
): T[] {
  if (!Array.isArray(steps)) return steps ?? [];
  return steps.map((s) => {
    if (typeof s?.description !== "string") return s;
    let text = s.description;
    text = text.replace(REF_RE, (_m, inner: string) => {
      const idxs = validIndices(inner, validIndexCount);
      if (idxs.length === 0) return "";
      return idxs.length === 1 ? `[${idxs[0]}]` : `(see [${idxs.join(", ")}])`;
    });
    text = text.replace(SEE_RE, (_m, inner: string) => {
      const idxs = validIndices(inner, validIndexCount);
      return idxs.length === 0 ? "" : `(see [${idxs.join(", ")}])`;
    });
    text = text.replace(BARE_RE, (_m, inner: string) => {
      const idxs = validIndices(inner, validIndexCount);
      return idxs.length === 0 ? "" : `[${idxs.join(", ")}]`;
    });
    text = text.replace(/\s{2,}/g, " ").replace(/\s+([.,;:])/g, "$1").trim();
    return { ...s, description: text };
  });
}
