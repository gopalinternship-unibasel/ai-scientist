// Shared embedding helper. Uses Lovable AI Gateway's Gemini text-embedding-004
// (768 dims). Centralised so feedback insert and retrieval produce vectors in
// the same space.
//
// Returns null on any error so callers can degrade gracefully — embeddings
// are an optimisation, never a hard requirement for the feature to work.

export const EMBEDDING_DIMS = 768;
const EMBEDDING_MODEL = "google/text-embedding-004";

export async function embedText(text: string, apiKey: string): Promise<number[] | null> {
  const trimmed = (text || "").trim().slice(0, 8000);
  if (!trimmed) return null;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: trimmed }),
    });
    if (!res.ok) {
      console.warn("embedText non-OK", res.status, await res.text().catch(() => ""));
      return null;
    }
    const json = await res.json();
    const vec = json?.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIMS) {
      console.warn("embedText unexpected shape", { len: vec?.length });
      return null;
    }
    return vec as number[];
  } catch (e) {
    console.warn("embedText failed:", e);
    return null;
  }
}
