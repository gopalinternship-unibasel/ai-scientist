// Anonymous owner token, persisted in localStorage so a single browser
// can later filter "my runs" without auth.
const KEY = "ai-scientist:owner-token";

export function getOwnerToken(): string {
  let t = localStorage.getItem(KEY);
  if (!t) {
    t = crypto.randomUUID();
    localStorage.setItem(KEY, t);
  }
  return t;
}

/**
 * Rotate the anonymous owner_token. Called after a successful
 * `claim_anonymous_runs` so a stolen / leaked old token can no longer be used
 * to read runs that have been transferred to a real account.
 */
export function rotateOwnerToken(): string {
  const fresh = crypto.randomUUID();
  localStorage.setItem(KEY, fresh);
  return fresh;
}
