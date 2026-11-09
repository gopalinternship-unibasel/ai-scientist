// AI call with model fallback. If the primary model returns a hard failure
// (5xx, 429, 408, network error), we transparently retry with a secondary
// model. Restores plan generation when one provider has a bad day.
//
// Used by both non-streaming (tool-call JSON) and streaming requests.
//
// The endpoint, key and per-role model chains come from the environment
// (see aiProvider.ts); the original build hard-coded the Lovable gateway.
import { fetchWithRetry } from "./fetch-with-retry.ts";
import { adaptChatBody, aiTimeout, chatCompletionsUrl, modelChain } from "./aiProvider.ts";

export type ModelChain = string[];

// Hot-path generation: long context + strict JSON + streaming.
// On the Lovable gateway this is gemini-3-flash-preview → gemini-2.5-flash →
// gpt-5-mini; locally it is AI_MODEL_PLAN (default qwen2.5:7b).
export const PLAN_MODELS: ModelChain = modelChain("PLAN");

// Cheap classification / short structured output (novelty, etc.).
export const FAST_MODELS: ModelChain = modelChain("FAST");

// Reasoning-first single calls (critic).
export const REASONING_MODELS: ModelChain = modelChain("REASONING");

interface CallOpts {
  apiKey: string;
  /** Output budget; sent as max_tokens / max_completion_tokens per AI_MAX_TOKENS_PARAM. */
  maxTokens?: number;
  models: ModelChain;
  // deno-lint-ignore no-explicit-any
  buildBody: (model: string) => any;
  label: string;
  // Per-attempt retry count inside fetchWithRetry. Keep low when we have
  // a fallback available so we don't spend 30s on a dead model.
  retries?: number;
  timeoutMs?: number;
}

/**
 * Try each model in turn. Returns the first OK Response, or the last
 * non-OK Response if all models fail.
 */
export async function callAIWithFallback(opts: CallOpts): Promise<{ res: Response; modelUsed: string }> {
  let lastRes: Response | null = null;
  let lastErr: unknown = null;
  for (let i = 0; i < opts.models.length; i++) {
    const model = opts.models[i];
    const isLast = i === opts.models.length - 1;
    try {
      const res = await fetchWithRetry(chatCompletionsUrl(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(adaptChatBody(opts.buildBody(model), opts.maxTokens)),
      }, {
        label: `${opts.label}:${model}`,
        retries: opts.retries ?? (isLast ? 2 : 1),
        timeoutMs: aiTimeout(opts.timeoutMs ?? 60_000),
      });
      if (res.ok) return { res, modelUsed: model };
      lastRes = res;
      // 4xx other than 429/408 are caller errors — fallback won't help.
      if (res.status >= 400 && res.status < 500 && res.status !== 429 && res.status !== 408) {
        return { res, modelUsed: model };
      }
      console.warn(`[ai-fallback] ${opts.label} model=${model} failed status=${res.status}, trying next`);
      try { await res.body?.cancel(); } catch { /* noop */ }
    } catch (e) {
      lastErr = e;
      console.warn(`[ai-fallback] ${opts.label} model=${model} threw:`, (e as Error).message);
      if (isLast) throw e;
    }
  }
  if (lastRes) return { res: lastRes, modelUsed: opts.models[opts.models.length - 1] };
  throw lastErr ?? new Error(`${opts.label}: all models failed`);
}

/**
 * Classify an arbitrary error / response status into a stable error kind that
 * the client can use to render tailored guidance + appropriate retry UI.
 */
export type ErrorKind =
  | "TIMEOUT"        // upstream model hung / aborted
  | "RATE_LIMIT"     // 429 from upstream provider
  | "CREDITS"        // 402 — workspace out of AI credits
  | "PARSE"          // model output couldn't be parsed
  | "UPSTREAM"       // 5xx or other upstream failure
  | "POLICY"         // 400 from provider citing content policy
  | "VALIDATION"     // input rejected by a guard (e.g. the hypothesis gate)
  | "INTERNAL";      // anything else

export function classifyHttpError(status: number, body?: string): ErrorKind {
  if (status === 408) return "TIMEOUT";
  if (status === 429) return "RATE_LIMIT";
  if (status === 402) return "CREDITS";
  if (status === 400 && body && /policy|safety|blocked/i.test(body)) return "POLICY";
  if (status >= 500) return "UPSTREAM";
  return "INTERNAL";
}

/**
 * Encode error kind + human message into the single `error` column. Format:
 *   "KIND: message"
 * The client splits on the first `: ` to extract the kind.
 */
export function encodeError(kind: ErrorKind, message: string): string {
  return `${kind}: ${message}`;
}

export function userMessageForKind(kind: ErrorKind): string {
  switch (kind) {
    case "TIMEOUT": return "The model took too long to respond. This usually clears up on a retry.";
    case "RATE_LIMIT": return "AI provider rate limit hit. Wait a moment and retry.";
    case "CREDITS": return "Out of AI credits. Top up in workspace settings before retrying.";
    case "PARSE": return "The model returned a malformed plan. A retry usually fixes this.";
    case "UPSTREAM": return "Upstream AI service was unavailable. Please retry — we'll try a backup model.";
    case "POLICY": return "The content was flagged by the provider's safety filter. Try rewording the hypothesis.";
    default: return "Something went wrong on our end. Please retry.";
  }
}
