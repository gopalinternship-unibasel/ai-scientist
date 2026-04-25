/**
 * Strict citation enforcer + sanitizer.
 *
 * The model is instructed to use ONLY the bracketed `[N]` format (and
 * optionally `(see [N])` for grouped references), where N is a 1-based index
 * into the literature list. This module:
 *
 *   1. Normalises common alternative forms the model occasionally emits
 *      ((ref. 1), [ref 1], (1), etc.) into the canonical `[N]` form.
 *   2. Strips any citation whose index is out of range — a defense against
 *      hallucinated references.
 *   3. Returns a per-step report of what was rewritten so the caller can
 *      raise the temperature on the planner if too many citations were bad.
 */

const SEE_RE = /\(\s*see\s*\[([^\]]+)\]\s*\)/gi;
// (ref. 1), (ref 1, 2), (refs. 1-3), [ref. 1]
const REF_RE = /[\(\[]\s*refs?\.?\s+([0-9 ,\-]+?)\s*[\)\]]/gi;
// Bare bracketed index like "[3]" or "[1, 2]" — keep these as-is but validate.
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

export interface SanitizeReport {
  /** Number of citations that referenced a non-existent index (stripped). */
  hallucinated: number;
  /** Number of citations rewritten from a non-canonical form. */
  rewritten: number;
  /** Number of valid canonical citations preserved. */
  valid: number;
}

export function sanitizeCitationsWithReport<T extends { description?: string }>(
  steps: T[] | undefined,
  validIndexCount: number,
): { steps: T[]; report: SanitizeReport } {
  const report: SanitizeReport = { hallucinated: 0, rewritten: 0, valid: 0 };
  if (!Array.isArray(steps)) return { steps: steps ?? [], report };

  const clean = steps.map((s) => {
    if (typeof s?.description !== "string") return s;
    let text = s.description;

    // 1) Normalise (ref. N) / [refs 1-3] → [N] or (see [N])
    text = text.replace(REF_RE, (_match, inner: string) => {
      const idxs = validIndices(inner, validIndexCount);
      if (idxs.length === 0) { report.hallucinated++; return ""; }
      report.rewritten++;
      return idxs.length === 1 ? `[${idxs[0]}]` : `(see [${idxs.join(", ")}])`;
    });

    // 2) Validate (see [N]) form
    text = text.replace(SEE_RE, (_match, inner: string) => {
      const idxs = validIndices(inner, validIndexCount);
      if (idxs.length === 0) { report.hallucinated++; return ""; }
      report.valid++;
      return `(see [${idxs.join(", ")}])`;
    });

    // 3) Validate bare [N] form
    text = text.replace(BARE_RE, (match, inner: string) => {
      const idxs = validIndices(inner, validIndexCount);
      if (idxs.length === 0) { report.hallucinated++; return ""; }
      report.valid++;
      return `[${idxs.join(", ")}]`;
    });

    text = text.replace(/\s{2,}/g, " ").replace(/\s+([.,;:])/g, "$1").trim();
    return { ...s, description: text };
  });

  return { steps: clean, report };
}

/** Back-compat shim used by the existing call site. */
export function sanitizeCitations<T extends { description?: string }>(
  steps: T[] | undefined,
  validIndexCount: number,
): T[] {
  return sanitizeCitationsWithReport(steps, validIndexCount).steps;
}
