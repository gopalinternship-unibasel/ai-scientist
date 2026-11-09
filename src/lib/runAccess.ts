// Who may refine a run. The edge function enforces ownership (signed-in
// owner by user id, anonymous owner by the browser's owner token); the UI
// mirrors it so share-link viewers do not get a Refine button that can only
// end in "You can only refine your own experiments."
//
// RLS lets a browser read a run only as its signed-in owner, its anonymous
// owner (x-owner-token) or through a share link (x-share-token). So a
// signed-out viewer without a share token is the anonymous owner.
export interface RefineAccessInput {
  status: string;
  hasPlan: boolean;
  isOwner: boolean;
  signedIn: boolean;
  shareToken: string | null;
}

export function canRefineRun({ status, hasPlan, isOwner, signedIn, shareToken }: RefineAccessInput): boolean {
  if (status !== "done" || !hasPlan) return false;
  if (isOwner) return true;
  return !signedIn && !shareToken;
}
