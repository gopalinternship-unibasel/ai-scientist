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

export interface FeedbackAccessInput {
  isOwner: boolean;
  signedIn: boolean;
  shareToken: string | null;
  /** owner_user_id of the run (null for an anonymous run). */
  ownerUserId: string | null;
}

/**
 * Who may rate or correct a run's sections. plan_feedback RLS accepts rows
 * only from the run's owner (signed-in owner by user id, anonymous owner by
 * the browser's owner token), so share-link viewers used to get twelve
 * feedback buttons that always ended in "Could not save feedback" (QA
 * round 2, 9 Nov 2026).
 */
export function canGiveFeedback({ isOwner, signedIn, shareToken, ownerUserId }: FeedbackAccessInput): boolean {
  if (isOwner) return true;
  return !signedIn && !shareToken && ownerUserId === null;
}
