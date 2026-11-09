// Which earlier version a refinement is compared with on the run page.
//
// A refinement is generated from its parent run's plan (parent_run_id), so
// the "changed" markers and the "Refining vX -> vY" banner must use that
// version. Picking simply the next-lower version number goes wrong when a
// refinement failed and was retried: the retry becomes v3, its parent is
// still v1, and v2 is a failed run without a plan (no diff at all, and the
// banner claimed "v2 -> v3").
export interface ChainEntry {
  id: string;
  version: number;
  plan?: unknown;
}

export function refinementBase<T extends ChainEntry>(
  run: { id: string; version: number; parent_run_id: string | null },
  versions: T[],
): T | null {
  const parent = versions.find((v) => v.id === run.parent_run_id);
  if (parent?.plan) return parent;
  return versions
    .filter((v) => v.id !== run.id && v.version < run.version && !!v.plan)
    .sort((a, b) => b.version - a.version)[0] ?? null;
}
