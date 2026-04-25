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
