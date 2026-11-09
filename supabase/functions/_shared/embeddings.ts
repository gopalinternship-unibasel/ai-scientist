// Shared embedding helper.
//
// History: the Lovable AI Gateway dropped its /v1/embeddings endpoint in
// 2026-04, so this helper was switched off (it returned null and the
// feedback loop ran in degraded mode). Embeddings now go through any
// OpenAI-compatible /v1/embeddings endpoint configured in aiProvider.ts —
// locally Ollama's nomic-embed-text, which is natively 768-d and therefore
// matches the vector(768) column on plan_feedback and the match_plan_feedback
// / find_duplicate_feedback RPCs.
//
// Callers degrade gracefully when this returns null (no model configured,
// provider down, wrong dimension):
//   - feedback rows are stored with embedding=null and skipped by retrieval
//   - de-duplication falls back to (run, section) uniqueness instead of cosine
//   - the backfill job retries rows that are still pending

import { fetchWithRetry } from "./fetch-with-retry.ts";
import { aiConfig, aiTimeout } from "./aiProvider.ts";

export const EMBEDDING_DIMS = 768;

// Embedding inputs are capped so a long correction cannot blow past the
// model's context window (nomic-embed-text: 2048 tokens).
const MAX_INPUT_CHARS = 6000;

let loggedDisabled = false;

/** True when an embedding model is configured. */
export function embeddingsEnabled(): boolean {
  return !!aiConfig().embed.model;
}

/**
 * Embed one text into the shared 768-d space. Returns null on any failure so
 * callers can fall back. `_apiKey` is kept for call-site compatibility; the
 * key comes from AI_EMBED_API_KEY / AI_API_KEY.
 */
export async function embedText(text: string, _apiKey?: string | null): Promise<number[] | null> {
  const cfg = aiConfig().embed;
  if (!cfg.model) {
    if (!loggedDisabled) {
      loggedDisabled = true;
      console.info("[embeddings] disabled — AI_EMBED_MODEL is not set; feedback retrieval running in degraded mode");
    }
    return null;
  }
  const input = (text ?? "").trim().slice(0, MAX_INPUT_CHARS);
  if (!input) return null;
  try {
    const res = await fetchWithRetry(`${cfg.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: cfg.model,
        input,
        ...(cfg.sendDimensions ? { dimensions: EMBEDDING_DIMS } : {}),
      }),
    }, { label: `embed:${cfg.model}`, retries: 2, timeoutMs: aiTimeout(30_000) });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[embeddings] ${cfg.model} returned ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }
    const json = await res.json();
    const vec = json?.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIMS || !vec.every((x) => typeof x === "number")) {
      console.warn(`[embeddings] ${cfg.model} returned ${Array.isArray(vec) ? vec.length : "no"} dims, expected ${EMBEDDING_DIMS}`);
      return null;
    }
    return vec as number[];
  } catch (e) {
    console.warn("[embeddings] request failed:", (e as Error).message);
    return null;
  }
}
