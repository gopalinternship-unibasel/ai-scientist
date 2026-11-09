import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hashForNewRun, markRunDone, type RunsTable } from "./runPersistence.ts";

type Err = { code?: string; message: string } | null;

// Fake runs table: answers each update with the next queued error and
// records what was written.
function fakeDb(errors: Err[]) {
  const writes: Record<string, unknown>[] = [];
  const db: RunsTable = {
    from: () => ({
      update: (values) => ({
        eq: (_col, _id) => {
          writes.push(values);
          return Promise.resolve({ error: errors.shift() ?? null });
        },
      }),
    }),
  };
  return { db, writes };
}

Deno.test("hashForNewRun keeps the hash for new runs and drops it for refinements", () => {
  assertEquals(hashForNewRun("abc", false), "abc");
  assertEquals(hashForNewRun("abc", true), null);
});

Deno.test("markRunDone saves plan and status in one update", async () => {
  const { db, writes } = fakeDb([null]);
  const r = await markRunDone(db, "run-1", { plan: { title: "t" }, domain: "cell-biology" });
  assertEquals(r.droppedHash, false);
  assertEquals(writes, [{ plan: { title: "t" }, domain: "cell-biology", status: "done" }]);
});

Deno.test("markRunDone retries without the hash when another done run holds it (23505)", async () => {
  const { db, writes } = fakeDb([{ code: "23505", message: "duplicate key value violates unique constraint" }, null]);
  const r = await markRunDone(db, "run-2", { plan: { title: "t" } });
  assertEquals(r.droppedHash, true);
  assertEquals(writes.length, 2);
  assertEquals(writes[1], { plan: { title: "t" }, status: "done", hypothesis_hash: null });
});

Deno.test("markRunDone throws on any other error instead of leaving the run in 'plan'", async () => {
  const { db } = fakeDb([{ code: "42501", message: "permission denied" }]);
  await assertRejects(() => markRunDone(db, "run-3", { plan: {} }), Error, "permission denied");
});
