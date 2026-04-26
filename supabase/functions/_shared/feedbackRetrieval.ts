// Feedback retrieval — closes the learning loop.
//
// When generating a new plan, we look up structured corrections that real
// scientists submitted on PAST plans for similar experiments and inject them
// as few-shot guidance into the planner prompt. Corrections compound over
// time without retraining the model.
//
// Similarity = domain match (exact) + token-overlap on the hypothesis excerpt
// (Jaccard, same scheme used elsewhere). We weight by abs(rating-3) so the
// strongest signals (1-star "wrong" or 5-star "exactly right") rank highest.

// deno-lint-ignore no-explicit-any
type SbClient = any;

export interface FeedbackHint {
  section: string;
  rating: number | null;
  correction: string;
  domain: string | null;
  hypothesis_excerpt: string | null;
  similarity: number;
}

const STOP = new Set([
  "the","a","an","of","in","on","to","for","and","or","with","by","from","at",
  "is","are","be","this","that","these","those","will","can","using","use",
  "we","our","study","experiment","hypothesis","measure","measured","versus","vs",
]);

function tok(s: string): Set<string> {
  return new Set(
    (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s\-]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP.has(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const uni = a.size + b.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

const DOMAIN_MATCH_BONUS = 0.25;
const MIN_SIMILARITY = 0.05;
const MAX_HINTS = 5;

/**
 * Pull recent feedback rows and return the top-N most relevant hints for the
 * current hypothesis + domain. Failures are non-fatal — we return [].
 */
export async function retrieveRelevantFeedback(
  supabase: SbClient,
  hypothesis: string,
  domainGuess: string | null,
): Promise<FeedbackHint[]> {
  try {
    // Pull the recent corpus. We cap at 200 rows ordered by recency — this
    // keeps the cross-run lookup cheap and biases toward fresh corrections.
    const { data, error } = await supabase
      .from("plan_feedback")
      .select("section, rating, correction, domain, hypothesis_excerpt")
      .not("correction", "is", null)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error || !Array.isArray(data) || data.length === 0) return [];

    const hypoTokens = tok(hypothesis);
    const domainNorm = (domainGuess ?? "").toLowerCase().trim();

    const scored: FeedbackHint[] = data
      .map((row: Record<string, unknown>) => {
        const correction = String(row.correction ?? "").trim();
        if (!correction) return null;
        const excerpt = (row.hypothesis_excerpt as string) ?? "";
        const rowDomain = ((row.domain as string) ?? "").toLowerCase().trim();
        const overlap = jaccard(hypoTokens, tok(excerpt));
        const domainBoost = domainNorm && rowDomain && rowDomain === domainNorm ? DOMAIN_MATCH_BONUS : 0;
        const rating = (row.rating as number | null) ?? null;
        // weight = similarity × (1 + abs(rating-3)/2). 1- or 5-star → 2×; 3-star → 1×.
        const ratingWeight = rating == null ? 1 : 1 + Math.abs(rating - 3) / 2;
        const similarity = (overlap + domainBoost) * ratingWeight;
        return {
          section: String(row.section ?? "overall"),
          rating,
          correction,
          domain: (row.domain as string) ?? null,
          hypothesis_excerpt: excerpt || null,
          similarity,
        } as FeedbackHint;
      })
      .filter((h): h is FeedbackHint => h !== null && h.similarity >= MIN_SIMILARITY)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, MAX_HINTS);

    return scored;
  } catch (e) {
    console.error("retrieveRelevantFeedback failed:", e);
    return [];
  }
}

/**
 * Render hints as a prompt fragment. Returns empty string when no hints.
 * Format is intentionally compact so it doesn't bloat the system prompt.
 */
export function feedbackPromptFragment(hints: FeedbackHint[]): string {
  if (hints.length === 0) return "";
  const lines = hints.map((h, i) => {
    const ratingStr = h.rating == null ? "" : ` (rated ${h.rating}/5)`;
    return `[${i + 1}] section=${h.section}${ratingStr}: ${h.correction.slice(0, 400)}`;
  });
  return `\n\nLEARNED CORRECTIONS — real scientists have flagged the following issues on prior plans for similar experiments. Apply these lessons to THIS plan unless they clearly do not fit:\n${lines.join("\n")}`;
}
