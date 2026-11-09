// Saving a finished plan on its run row.
//
// runs has a partial unique index on hypothesis_hash WHERE status = 'done'
// (migration 20260425202033): one finished run per hypothesis is the cache
// entry that later identical hypotheses are served from. Marking a second
// run with the same hash as done therefore fails with 23505 (HTTP 409 from
// PostgREST). That happened to every refinement (it repeats its parent's
// hypothesis, and the parent is done) and to two owners who start the same
// new hypothesis before either finishes. The update error was never
// checked, so the plan was lost and the run stayed in "plan" until the
// stale-run cleanup failed it.

/** Refinements are not cache entries for the bare hypothesis: no hash. */
export function hashForNewRun(hash: string, isRefinement: boolean): string | null {
  return isRefinement ? null : hash;
}

// Minimal shape of the supabase-js client used here (keeps it testable).
export interface RunsTable {
  from(table: "runs"): {
    update(values: Record<string, unknown>): {
      eq(column: "id", value: string): PromiseLike<{ error: { code?: string; message: string } | null }>;
    };
  };
}

/**
 * Set status 'done' with the plan. On a hash collision the run keeps its
 * plan and gives up its hash (the earlier run stays the cache entry), the
 * same way the cached-copy insert handles it. Any other failure throws, so
 * the caller marks the run failed instead of leaving it in "plan".
 */
export async function markRunDone(
  db: RunsTable,
  runId: string,
  fields: Record<string, unknown>,
): Promise<{ droppedHash: boolean }> {
  const done = { ...fields, status: "done" };
  let { error } = await db.from("runs").update(done).eq("id", runId);
  if (error?.code === "23505") {
    ({ error } = await db.from("runs").update({ ...done, hypothesis_hash: null }).eq("id", runId));
    if (!error) return { droppedHash: true };
  }
  if (error) throw new Error(`could not save the finished plan: ${error.message}`);
  return { droppedHash: false };
}
