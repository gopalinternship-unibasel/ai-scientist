// Feedback retrieval — closes the learning loop.
//
// When generating a new plan, we look up structured corrections that real
// scientists have submitted on PAST plans for similar experiments and inject
// them as few-shot guidance into the planner prompt. This is the cross-run
// learning layer: corrections compound over time without retraining the model.
//
// Similarity is computed as a domain match (exact) + token-overlap on the
// hypothesis excerpt (Jaccard, same scheme used elsewhere in this codebase).
// We rank by `similarity × abs(rating-3)` so low-rated corrections (1-2) carry
// the most weight — they're explicit "this part was wrong" signals.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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
  "is","are","be","this","that","these","those","will","can