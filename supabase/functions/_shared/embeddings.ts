// Shared embedding helper.
//
// NOTE (2026-04): The Lovable AI Gateway dropped its /v1/embeddings endpoint;
// none of the currently allowed models are embedding models. Until a
// supported embedding model is restored, this helper is a no-op that returns
// `null` so callers degrade gracefully:
//   - feedback rows are stored with embedding=null and skipped by retrieval
//   - de-duplication falls back to (run, section) uniqueness instead of cosine
//   - retrieval-augmented hints are temporarily disabled for new feedback
//
// Keeping the function signature stable means we can swap a real embedding
// provider back in (OpenAI text-embedding-3-small, voyage-3, or whatever the
// gateway re-adds) without touching any call site.

export const EMBEDDING_DIMS = 768;

// Set to false at module load — the gateway returns 400 for every model we'd
// try. Logged once at boot so it's visible in function logs without spamming
// per-call warnings.
const EMBEDDINGS_ENABLED = false;
if (!EMBEDDINGS_ENABLED) {
  console.info("[embeddings] disabled — gateway has no embedding model available; feedback retrieval running in degraded mode");
}

export async function embedText(_text: string, _apiKey: string): Promise<number[] | null> {
  return null;
}

