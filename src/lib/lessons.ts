// How closely an applied lesson (a past correction) matched this hypothesis,
// as the run page shows it.
//
// Runs since QA round 3 store the cosine similarity (0-1) in `similarity`
// and the ranking score in `score`. Older runs stored the ranking score in
// `similarity`: (cosine + up to 0.05 domain bonus) x a rating weight of 1 to
// 2, which the tooltip showed as "163% match" (run 7a01520f). The cosine
// cannot be recovered exactly from that (the rating may have changed since),
// so those runs show its lower bound: score / 2 - 0.05, as "at least N%".
export interface LessonMatch {
  similarity: number;
  rating: number | null;
  score?: number;
}

export interface LessonMatchDisplay {
  percent: number;
  /** True for older runs, where only a lower bound is known. */
  atLeast: boolean;
}

export function lessonMatch(e: LessonMatch): LessonMatchDisplay {
  const s = Number(e.similarity);
  if (!Number.isFinite(s) || s <= 0) return { percent: 0, atLeast: false };
  if (e.score === undefined && s > 1) {
    return { percent: Math.round(Math.min(1, Math.max(0, s / 2 - 0.05)) * 100), atLeast: true };
  }
  return { percent: Math.round(Math.min(1, s) * 100), atLeast: false };
}

/** "77% match" or, for older runs, "at least 77% match". */
export function lessonMatchLabel(e: LessonMatch): string {
  const m = lessonMatch(e);
  return `${m.atLeast ? "at least " : ""}${m.percent}% match`;
}

/** The percentage alone (never above 100). */
export function lessonMatchPercent(e: LessonMatch): number {
  return lessonMatch(e).percent;
}
