/**
 * Fetch with exponential backoff + jitter. Retries on network errors and
 * transient 5xx / 429 responses. Returns the final Response (which may still
 * be non-OK if all retries are exhausted) so the caller can inspect status.
 *
 * Does NOT retry on 4xx other than 429 (those are caller errors and won't
 * succeed on retry).
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: { retries?: number; baseDelayMs?: number; label?: string } = {},
): Promise<Response> {
  const retries = opts.retries ?? 3;
  const base = opts.baseDelayMs ?? 800;
  const label = opts.label ?? "fetch";
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
      if (!retryable || attempt === retries) return res;
      try { await res.body?.cancel(); } catch { /* noop */ }
      console.warn(`[${label}] retry ${attempt + 1}/${retries} after ${res.status}`);
    } catch (e) {
      lastErr = e;
      if (attempt === retries) throw e;
      console.warn(`[${label}] retry ${attempt + 1}/${retries} after network error:`, (e as Error).message);
    }
    const delay = base * Math.pow(3, attempt) * (0.7 + Math.random() * 0.6);
    await new Promise((r) => setTimeout(r, delay));
  }
  throw lastErr ?? new Error(`${label} failed after ${retries} retries`);
}
