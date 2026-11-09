// Deterministic integrity checks on a generated plan: protocol sources and
// budget arithmetic.
//
// This file has no imports and no Deno or browser APIs, so the edge function
// (run-experiment, on every new and cached plan) and the frontend
// (src/lib/planIntegrity.ts re-exports it for the plan view and the PDF, which
// also covers plans saved before these checks existed) run the same code.
//
// Why it exists (QA, 9 Nov 2026):
//  - Protocol steps carry a free-text `source`. Nothing checked it, so a run
//    whose literature search found 0 papers still showed three model-made
//    URLs under its steps, one a bioRxiv DOI that does not exist. The
//    citation sanitiser only looked at `[N]` markers in step descriptions.
//  - `budget.total_usd` disagreed with the sum of `budget.line_items` in
//    every model-generated plan (10,233 vs 12,133, 16,235 vs 22,235, ...).

export interface RefLike {
  title?: string | null;
  url?: string | null;
  doi?: string | null;
  year?: number | null;
}

export interface StepLike {
  description?: string;
  source?: string;
}

export interface SourceReport {
  /** Sources that point at a retrieved reference (rewritten to "[N] title"). */
  resolved: number;
  /** Plain-text labels kept (no URL, DOI, PMID, author-year). */
  kept: number;
  /** Sources removed because they cite something that was not retrieved. */
  removed: number;
  /** Links removed from step descriptions for the same reason. */
  links_removed: number;
  /** The removed sources (truncated), for the run's verification record. */
  removed_examples: string[];
}

const DOI_RE = /10\.\d{4,9}\/[^\s"'<>]+/i;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s"'<>]+/gi;
// Anything that reads like a citation: a link, a DOI, a PubMed id, an
// author-year form or a bare year.
const CITATION_LIKE_RE = /(?:https?:\/\/|www\.|\bdoi\b|10\.\d{4,9}\/|\bpmid\b|\bpmc\d|\bet al\b|\b(?:19|20)\d{2}\b)/i;

function trimTrailing(s: string): string {
  return s.replace(/[.,;:)\]}>]+$/, "");
}

/** Lower-cased DOI found in a string (URL or bare), or null. */
export function extractDoi(s: string | null | undefined): string | null {
  if (!s) return null;
  let decoded = s;
  try { decoded = decodeURIComponent(s); } catch { /* keep raw */ }
  const m = decoded.match(DOI_RE);
  if (!m) return null;
  return trimTrailing(m[0]).toLowerCase().replace(/v\d+$/, "");
}

/** Comparable form of a URL: no scheme, no www., no trailing slash. */
export function normalizeUrl(u: string): string {
  return trimTrailing(u.trim().toLowerCase())
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

function normTitle(t: string): string {
  return t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Keys (normalised URLs and DOIs) under which a reference can be cited. */
function referenceKeys(r: RefLike): string[] {
  const keys: string[] = [];
  if (r.url) keys.push(normalizeUrl(r.url));
  const doi = extractDoi(r.doi ?? null) ?? extractDoi(r.url ?? null);
  if (doi) keys.push(`doi:${doi}`);
  return keys;
}

/** Keys for a link mentioned in model text. */
function linkKeys(link: string): string[] {
  const keys = [normalizeUrl(link)];
  const doi = extractDoi(link);
  if (doi) keys.push(`doi:${doi}`);
  return keys;
}

/**
 * 1-based index of the retrieved reference a piece of text points at:
 * a leading `[N]` marker in range, a URL or DOI of a reference, or (for
 * titles of at least 20 characters) the reference's title. Null otherwise.
 */
export function matchReference(text: string, refs: RefLike[]): number | null {
  if (!text || refs.length === 0) return null;
  // "[2]", "see [2]", "(see [1, 3])": the first in-range index wins; markers
  // that are all out of range mean the text cites something not retrieved.
  const markers = [...text.matchAll(/\[\s*(\d+(?:\s*,\s*\d+)*)\s*\]/g)];
  if (markers.length > 0) {
    for (const m of markers) {
      for (const part of m[1].split(",")) {
        const n = parseInt(part.trim(), 10);
        if (n >= 1 && n <= refs.length) return n;
      }
    }
    return null;
  }
  const mentioned = new Set<string>();
  for (const link of text.match(URL_RE) ?? []) for (const k of linkKeys(link)) mentioned.add(k);
  const bareDoi = extractDoi(text);
  if (bareDoi) mentioned.add(`doi:${bareDoi}`);
  for (let i = 0; i < refs.length; i++) {
    if (referenceKeys(refs[i]).some((k) => mentioned.has(k))) return i + 1;
  }
  const t = normTitle(text);
  for (let i = 0; i < refs.length; i++) {
    const title = normTitle(refs[i].title ?? "");
    if (title.length >= 20 && t.includes(title)) return i + 1;
  }
  return null;
}

export function looksLikeCitation(text: string): boolean {
  return CITATION_LIKE_RE.test(text);
}

/** How a step's source is shown once it resolves to reference N. */
export function referenceLabel(n: number, r: RefLike): string {
  const title = (r.title ?? "").trim() || "Untitled reference";
  return `[${n}] ${title}${r.year ? ` (${r.year})` : ""}`;
}

/**
 * Display value for a step's source, or null when it must not be shown:
 * a source resolving to a retrieved reference becomes "[N] title (year)";
 * one that cites anything else (a URL, DOI, PMID, "et al.", a year) is
 * dropped; a short plain label ("manufacturer's instructions") is kept.
 */
export function verifiedSource(source: string | null | undefined, refs: RefLike[]): string | null {
  const s = (source ?? "").trim();
  if (!s) return null;
  const n = matchReference(s, refs);
  if (n) return referenceLabel(n, refs[n - 1]);
  // A "[N]" that is not a retrieved reference, or anything citation-like.
  if (/\[\s*\d+/.test(s) || looksLikeCitation(s)) return null;
  return s.length > 160 ? `${s.slice(0, 157)}...` : s;
}

/**
 * Rewrite every protocol step's `source` with verifiedSource, and replace
 * links inside step descriptions: a link to a retrieved reference becomes
 * its `[N]` marker, any other link is removed.
 */
export function sanitizeStepSources<T extends StepLike>(
  steps: T[] | undefined | null,
  refs: RefLike[],
): { steps: T[]; report: SourceReport } {
  const report: SourceReport = { resolved: 0, kept: 0, removed: 0, links_removed: 0, removed_examples: [] };
  if (!Array.isArray(steps)) return { steps: [], report };
  const clean = steps.map((step) => {
    if (!step || typeof step !== "object") return step;
    const out = { ...step };
    if (typeof out.source === "string" && out.source.trim()) {
      const original = out.source.trim();
      const shown = verifiedSource(original, refs);
      if (shown === null) {
        delete out.source;
        report.removed++;
        if (report.removed_examples.length < 5) report.removed_examples.push(original.slice(0, 200));
      } else {
        out.source = shown;
        if (matchReference(original, refs)) report.resolved++;
        else report.kept++;
      }
    } else if ("source" in out) {
      delete out.source;
    }
    if (typeof out.description === "string") {
      out.description = out.description.replace(URL_RE, (match) => {
        // The URL pattern also swallows closing punctuation: keep that.
        const link = trimTrailing(match);
        const tail = match.slice(link.length);
        const n = matchReference(link, refs);
        if (n) return `[${n}]${tail}`;
        report.links_removed++;
        return tail;
      }).replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ").replace(/\s+([.,;:])/g, "$1").trim();
    }
    return out;
  });
  return { steps: clean, report };
}

// --- Budget ------------------------------------------------------------------

export interface BudgetLike {
  currency?: string;
  line_items?: { category?: string; amount_usd?: number | string | null; note?: string }[];
  total_usd?: number | string | null;
}

export interface BudgetCheck {
  /** Sum of the line items (what the total must be). */
  line_item_sum: number;
  /** The total the model wrote. */
  stated_total: number | null;
  /** True when the stated total differs from the sum by more than $1. */
  mismatch: boolean;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[$,\s]/g, "")) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function checkBudget(budget: BudgetLike | null | undefined): BudgetCheck | null {
  if (!budget || !Array.isArray(budget.line_items) || budget.line_items.length === 0) return null;
  const sum = Math.round(budget.line_items.reduce((s, li) => s + (num(li?.amount_usd) ?? 0), 0) * 100) / 100;
  const stated = num(budget.total_usd);
  return { line_item_sum: sum, stated_total: stated, mismatch: stated === null || Math.abs(stated - sum) > 1 };
}

/** Total to show for a plan's budget: the line-item sum when there are items. */
export function budgetTotal(budget: BudgetLike | null | undefined): number {
  const c = checkBudget(budget);
  if (c) return c.line_item_sum;
  return num(budget?.total_usd) ?? 0;
}

/**
 * Copy of the budget with total_usd set to the sum of its line items
 * (amounts coerced to numbers). Returns the check that was applied.
 */
export function reconcileBudget<B extends BudgetLike>(budget: B): { budget: B; check: BudgetCheck | null } {
  const check = checkBudget(budget);
  if (!check) return { budget, check: null };
  const line_items = (budget.line_items ?? []).map((li) => ({ ...li, amount_usd: num(li?.amount_usd) ?? 0 }));
  return { budget: { ...budget, line_items, total_usd: check.line_item_sum }, check };
}
