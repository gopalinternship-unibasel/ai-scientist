// How closely an applied lesson (a past correction) matched this hypothesis,
// as the percentage the run page shows.
//
// Runs since QA round 3 store the cosine similarity (0-1) in `similarity`
// and the ranking score in `score`. Older runs stored the ranking score in
// `similarity`: (cosine + 0.05 domain bonus) x a rating weight of 1 to 2,
// which the tooltip showed as "163% match" (run 7a01520f). For those the
// rating weight is divided out again and the result capped at 100%.
export interface LessonMatch {
  similarity: number;
  rating: number | null;
  score?: number;
}

export function lessonMatchPercent(e: LessonMatch): number {
  let s = Number(e.similarity);
  if (!Number.isFinite(s) || s < 0) return 0;
  if (s > 1 && e.score === undefined) {
    const weight = e.rating == null ? 1 : 1 + Math.abs(e.rating - 3) / 2;
    s = s / weight;
  }
  return Math.round(Math.min(1, s) * 100);
}
