// A refinement chain: the original run and every refinement made from it,
// however deep (v1 -> v2 -> v3) and however branched (v1 refined twice).
//
// QA round 3 (runs 7a01520f -> 40c0b182 -> 69a412a9): the run page loaded
// only the root and its direct children, so v1 and v2 showed "v1 | v2"
// without v3 and v3 showed "v2 | v3" without v1; the server numbered a new
// refinement from its parent's direct children only, so refining v1 again
// would have made a second "v3". Both now walk the whole chain.
//
// Import-free: the edge function (service role) and the run page (the
// browser's RLS-scoped client) pass their own row loaders.

export interface ChainRow {
  id: string;
  parent_run_id: string | null;
  version?: number | null;
}

/** Longest chain walked (guards against a cycle in bad data). */
export const MAX_CHAIN_DEPTH = 50;

/**
 * Every run in the chain of `start`: up to the root through parent_run_id,
 * then down through all descendants. Runs the loader cannot read (another
 * owner's, without a share link) are simply not included.
 */
export async function loadChain<T extends ChainRow>(
  start: T,
  loadOne: (id: string) => Promise<T | null>,
  loadChildren: (parentIds: string[]) => Promise<T[]>,
): Promise<T[]> {
  const byId = new Map<string, T>([[start.id, start]]);
  let root = start;
  for (let depth = 0; root.parent_run_id && depth < MAX_CHAIN_DEPTH; depth++) {
    if (byId.has(root.parent_run_id)) break; // a cycle in bad data
    const parent = await loadOne(root.parent_run_id);
    if (!parent) break;
    byId.set(parent.id, parent);
    root = parent;
  }
  // Down from the root, level by level. Runs already met on the way up are
  // walked through too (their own refinements are part of the chain).
  const visited = new Set([root.id]);
  let frontier = [root.id];
  for (let depth = 0; frontier.length > 0 && depth < MAX_CHAIN_DEPTH; depth++) {
    const kids = (await loadChildren(frontier)).filter((k) => !visited.has(k.id));
    for (const k of kids) {
      visited.add(k.id);
      if (!byId.has(k.id)) byId.set(k.id, k);
    }
    frontier = kids.map((k) => k.id);
  }
  return sortChain([...byId.values()]);
}

/** Version order; equal numbers (two refinements numbered alike before this fix) by id. */
export function sortChain<T extends ChainRow & { created_at?: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    (a.version ?? 1) - (b.version ?? 1)
    || (a.created_at ?? "").localeCompare(b.created_at ?? "")
    || a.id.localeCompare(b.id));
}

/** The number a new refinement anywhere in this chain gets: one above the highest. */
export function nextVersion(chain: ChainRow[]): number {
  return chain.reduce((m, r) => Math.max(m, Number(r.version) || 1), 1) + 1;
}

/** The version a run was refined from, when it is in the chain. */
export function parentVersion(chain: ChainRow[], run: ChainRow): number | null {
  const p = chain.find((r) => r.id === run.parent_run_id);
  return p ? Number(p.version) || 1 : null;
}
