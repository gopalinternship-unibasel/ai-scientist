// Rationales saved before 9 Nov 2026 (run b1cd3e59) say "Candidate 0 ...",
// an index into a list the reader never sees; new runs replace it with the
// paper's title server-side. Without the list, say what it is.
export function readableRationale(r: string): string {
  return (r ?? "").replace(/\b(?:candidate|entry|index)\s*(?:#|no\.?\s*)?\d+\b/gi, "one of the retrieved papers");
}
