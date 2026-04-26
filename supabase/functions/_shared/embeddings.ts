// Shared embedding helper. Uses Lovable AI Gateway's Gemini text-embedding-004
// (768 dims). Centralised so feedback insert and retrieval produce vectors in
// the same space.
//
// Returns null on any error so callers can degrade gracefully — embeddings
// are an optimisation, never a hard requirement for the feature to work.

export const EMBEDDING_DIMS = 768;
const EMBEDDING_MODEL = "google/text-embedding-004";

/**
 * Embed text via the Lovable AI Gateway with bounded exponential backoff.
 *
 * Returns null on permanent failure (auth, malformed input, exhausted retries).
 * Retries on 429 / 5xx — those are the failure modes that strand a feedback
 * row with `embedding=null` forever and silently drop it from retrieval.
 */
export async function embedText(text: string, apiKey: string): Promise<number[] | null> {
  const trimmed = (text || "").trim().slice(0, 8000);
  if (!trimmed) return null;

  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: trimmed }),
      });
      if (res.ok) {
        const json = await res.json();
        const vec = json?.data?.[0]?.embedding;
        if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIMS) {
          console.warn("embedText unexpected shape", { len: vec?.length });
          return null;
        }
        return vec as number[];
      }
      // Retry only on transient: 429 (rate limit) and 5xx (gateway hiccup).
      // Everything else (400 = bad input, 401/403 = auth) is permanent.
      const transient = res.status === 429 || res.status >= 500;
      const body = await res.text().catch(() => "");
      console.warn(`embedText non-OK ${res.status} (attempt ${attempt}/${MAX_ATTEMPTS}) ${transient ? "— retrying" : "— giving up"}`, body.slice(0, 200));
      if (!transient || attempt === MAX_ATTEMPTS) return null;
    } catch (e) {
      // Network errors are always worth one more try.
      console.warn(`embedText threw (attempt ${attempt}/${MAX_ATTEMPTS}):`, e);
      if (attempt === MAX_ATTEMPTS) return null;
    }
    // Exponential backoff with jitter: 400ms, 1.2s, (capped).
    const delay = Math.min(400 * Math.pow(3, attempt - 1), 3000) + Math.random() * 200;
    await new Promise((r) => setTimeout(r, delay));
  }
  return null;
}
