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
  "is","are","be","this","that","these","those","will","can","using