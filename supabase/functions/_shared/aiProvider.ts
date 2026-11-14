// Provider configuration for every LLM and embedding call.
//
// The original build hard-coded the Lovable AI Gateway
// (https://ai.gateway.lovable.dev/v1) and LOVABLE_API_KEY. That gateway key
// belonged to the hosted Lovable Cloud project, which no longer exists, so all
// calls now go to an OpenAI-compatible endpoint picked by environment
// variables. Any OpenAI-compatible provider works: local Ollama (the local
// default), OpenAI, the Hugging Face router, Google Gemini's OpenAI endpoint,
// or the original Lovable gateway.
//
//   AI_BASE_URL            chat base URL, e.g. http://host.docker.internal:11434/v1
//   AI_API_KEY             bearer token (falls back to LOVABLE_API_KEY; local
//                          Ollama accepts any value)
//   AI_MODEL               default chat model for every role
//   AI_MODEL_<ROLE>        comma-separated model chain for one role, tried in
//                          order (fallback chain). Roles: PLAN, FAST, REASONING,
//                          GATE, DOMAIN, DISTILL, EVAL_PLAN, JUDGE
//   AI_STRUCTURED_OUTPUT   "tools" (OpenAI tools + forced tool_choice, default)
//                          or "json_schema" (response_format json_schema; use
//                          for providers that ignore tool_choice, e.g. Ollama)
//   AI_MAX_TOKENS_PARAM    "max_tokens" (default), "max_completion_tokens"
//                          (OpenAI gpt-5 / o-series) or "none"
//   AI_MAX_TOKENS_CAP      upper bound for every output budget. Prompt +
//                          output must fit the model's context window (the
//                          local model is created with num_ctx 8192; Ollama's
//                          default is 4096, and on overflow it silently drops
//                          the start of the prompt mid-answer)
//   AI_MIN_TIMEOUT_MS      floor for every per-call timeout (CPU-only local
//                          models need minutes, hosted ones seconds)
//   AI_COMPACT_OUTPUT      "true" for small, slow local models: every list in
//                          structured output is capped at COMPACT_MAX_ITEMS
//                          (maxItems, enforced by Ollama's JSON grammar), the
//                          model is asked for short text fields, and long
//                          prompt inputs (previous plan, plan under review)
//                          are cut short (fewer prompt tokens for a CPU to
//                          process, and room for the answer). Leave unset for
//                          hosted models.
//   AI_EMBED_BASE_URL      embeddings base URL (defaults to AI_BASE_URL)
//   AI_EMBED_API_KEY       embeddings key (defaults to AI_API_KEY)
//   AI_EMBED_MODEL         embedding model; empty disables embeddings
//   AI_EMBED_DIMENSIONS    "true" sends `dimensions: 768` (OpenAI
//                          text-embedding-3-*, Gemini); a whole number sends
//                          that dimension instead (the database column is
//                          vector(768), so any other value needs a migration
//                          first); leave unset for models that are natively
//                          768-d (nomic-embed-text)
//   AI_REASONING_EFFORT    optional, e.g. "low": sent as `reasoning_effort` on
//                          every chat request (models that think by default)
//
// When AI_BASE_URL points at the Lovable gateway and no AI_MODEL* override is
// set, the original per-role Gemini/GPT-5 chains are used unchanged.

export type AIRole =
  | "PLAN" | "FAST" | "REASONING" | "GATE" | "DOMAIN" | "DISTILL" | "EVAL_PLAN" | "JUDGE";

export type StructuredMode = "tools" | "json_schema";
export type MaxTokensParam = "max_tokens" | "max_completion_tokens" | "none";

export interface AIConfig {
  baseUrl: string;
  apiKey: string | null;
  structuredMode: StructuredMode;
  maxTokensParam: MaxTokensParam;
  maxTokensCap: number;
  minTimeoutMs: number;
  compact: boolean;
  /** Sent as reasoning_effort on every chat request when set. */
  reasoningEffort: string | null;
  chains: Record<AIRole, string[]>;
  embed: {
    baseUrl: string;
    apiKey: string | null;
    model: string | null;
    sendDimensions: boolean;
    /** Dimension requested from the model and expected back. */
    dimensions: number;
  };
}

type Env = Record<string, string | undefined>;

export const DEFAULT_BASE_URL = "http://host.docker.internal:11434/v1";
export const LOVABLE_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1";
export const DEFAULT_LOCAL_MODEL = "qwen2.5:7b";

// The original per-role routing on the Lovable gateway (kept verbatim so the
// hosted setup is one env change away).
export const LOVABLE_CHAINS: Record<AIRole, string[]> = {
  PLAN: ["google/gemini-3-flash-preview", "google/gemini-2.5-flash", "openai/gpt-5-mini"],
  FAST: ["google/gemini-3-flash-preview", "openai/gpt-5-nano"],
  REASONING: ["google/gemini-3-flash-preview", "openai/gpt-5-mini"],
  GATE: ["google/gemini-3-flash-preview", "openai/gpt-5-nano", "google/gemini-2.5-flash-lite"],
  DOMAIN: ["google/gemini-3-flash-preview"],
  DISTILL: ["openai/gpt-5-mini"],
  EVAL_PLAN: ["google/gemini-3-flash-preview"],
  JUDGE: ["openai/gpt-5"],
};

const ROLES: AIRole[] = ["PLAN", "FAST", "REASONING", "GATE", "DOMAIN", "DISTILL", "EVAL_PLAN", "JUDGE"];

function clean(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

function splitChain(v: string | undefined): string[] | null {
  const items = (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return items.length ? items : null;
}

function isLocalUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal|ollama)(:\d+)?(\/|$)/i.test(url);
}

export const DEFAULT_EMBED_DIMENSIONS = 768;

/** AI_EMBED_DIMENSIONS: "true" asks for 768, a whole number asks for that many, anything else sends nothing. */
export function parseEmbedDimensions(v: string | undefined): { send: boolean; dimensions: number } {
  const t = clean(v)?.toLowerCase() ?? "";
  if (/^(1|true|yes)$/.test(t)) return { send: true, dimensions: DEFAULT_EMBED_DIMENSIONS };
  const n = Number(t);
  if (t && Number.isInteger(n) && n > 1) return { send: true, dimensions: n };
  return { send: false, dimensions: DEFAULT_EMBED_DIMENSIONS };
}

/** Pure resolver — takes an env map so it can be unit-tested. */
export function resolveAIConfig(env: Env): AIConfig {
  const baseUrl = (clean(env.AI_BASE_URL) ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const isLovable = baseUrl.startsWith(LOVABLE_GATEWAY_URL);
  const apiKey = clean(env.AI_API_KEY) ?? clean(env.LOVABLE_API_KEY) ?? (isLocalUrl(baseUrl) ? "ollama" : null);

  const defaultModel = clean(env.AI_MODEL);
  const chains = {} as Record<AIRole, string[]>;
  for (const role of ROLES) {
    chains[role] = splitChain(env[`AI_MODEL_${role}`])
      ?? (defaultModel ? [defaultModel] : null)
      ?? (isLovable ? LOVABLE_CHAINS[role] : [DEFAULT_LOCAL_MODEL]);
  }

  const mode = clean(env.AI_STRUCTURED_OUTPUT)?.toLowerCase();
  const structuredMode: StructuredMode = mode === "json_schema" ? "json_schema" : "tools";

  const mtp = clean(env.AI_MAX_TOKENS_PARAM)?.toLowerCase();
  const maxTokensParam: MaxTokensParam = mtp === "none" || mtp === "max_completion_tokens"
    ? mtp
    : isLovable ? "none" : "max_tokens";

  const minTimeout = Number(clean(env.AI_MIN_TIMEOUT_MS) ?? "0");
  const cap = Number(clean(env.AI_MAX_TOKENS_CAP) ?? "0");

  const embedBase = (clean(env.AI_EMBED_BASE_URL) ?? baseUrl).replace(/\/+$/, "");
  const embedModel = clean(env.AI_EMBED_MODEL) ?? null;
  const embedDims = parseEmbedDimensions(env.AI_EMBED_DIMENSIONS);

  return {
    baseUrl,
    apiKey,
    structuredMode,
    maxTokensParam,
    maxTokensCap: Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : 0,
    minTimeoutMs: Number.isFinite(minTimeout) && minTimeout > 0 ? minTimeout : 0,
    compact: /^(1|true|yes)$/i.test(clean(env.AI_COMPACT_OUTPUT) ?? ""),
    reasoningEffort: clean(env.AI_REASONING_EFFORT)?.toLowerCase() ?? null,
    chains,
    embed: {
      baseUrl: embedBase,
      apiKey: clean(env.AI_EMBED_API_KEY) ?? apiKey,
      model: embedModel,
      sendDimensions: embedDims.send,
      dimensions: embedDims.dimensions,
    },
  };
}

let cached: AIConfig | null = null;

/** Config from the function's environment (read once per worker). */
export function aiConfig(): AIConfig {
  if (!cached) cached = resolveAIConfig(Deno.env.toObject());
  return cached;
}

/** The bearer token to use for chat calls, or null when not configured. */
export function aiApiKey(): string | null {
  return aiConfig().apiKey;
}

export function modelChain(role: AIRole): string[] {
  return aiConfig().chains[role];
}

export function chatCompletionsUrl(): string {
  return `${aiConfig().baseUrl}/chat/completions`;
}

/** Apply the AI_MIN_TIMEOUT_MS floor to a per-call budget. */
export function aiTimeout(ms: number): number {
  return Math.max(ms, aiConfig().minTimeoutMs);
}

/** Longest list a compact-mode structured output may contain. */
export const COMPACT_MAX_ITEMS = 5;

/**
 * Longest text field (characters) a compact-mode structured output may
 * contain. Small local models sometimes fall into a loop inside one string
 * (seen 9 Nov 2026: a refined plan's validation section grew to 13,000
 * characters until the 3,072-token budget ran out and the JSON was cut
 * off). maxLength is enforced by Ollama's JSON grammar, so the string has
 * to close. The compact hint asks for about 30 words, well under this.
 */
export const COMPACT_MAX_CHARS = 400;

/**
 * Character budget for a long prompt input (the previous plan in a
 * refinement, the plan under review in the critique). Compact mode uses the
 * smaller budget so prompt + output fit a small local context window.
 */
export function promptChars(full: number, compact: number, cfg: AIConfig = aiConfig()): number {
  return cfg.compact ? Math.min(full, compact) : full;
}

/** An OpenAI-style tool definition (only the fields adapted here). */
export interface ChatTool {
  type?: string;
  function?: { name?: string; description?: string; parameters?: unknown };
}

/** An OpenAI-style chat request body (only the fields adapted here are typed). */
export interface ChatBody {
  model?: string;
  messages?: { role: string; content: string }[];
  tools?: ChatTool[];
  tool_choice?: { type?: string; function?: { name?: string } };
  response_format?: unknown;
  [key: string]: unknown;
}

/**
 * Copy of a JSON schema with maxItems on every array that has none and,
 * when maxLength is given, maxLength on every free-text string that has
 * none (enums are left alone).
 */
export function capArrays<T>(schema: T, maxItems: number, maxLength?: number): T {
  if (Array.isArray(schema)) return schema.map((s) => capArrays(s, maxItems, maxLength)) as T;
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) out[k] = capArrays(v, maxItems, maxLength);
  if (out.type === "array" && out.maxItems === undefined) out.maxItems = maxItems;
  if (maxLength && out.type === "string" && out.maxLength === undefined && out.enum === undefined) {
    out.maxLength = maxLength;
  }
  return out as T;
}

const COMPACT_HINT = `Be concise: keep every text field to one or two short sentences (at most about 30 words) and every list to at most ${COMPACT_MAX_ITEMS} items. Keep exact numbers (concentrations, volumes, durations, costs).`;

/**
 * Adapt an OpenAI-style request body to the configured provider:
 *  - json_schema mode turns a forced tool call into response_format
 *    json_schema (grammar-constrained JSON on Ollama, which ignores
 *    tool_choice);
 *  - max tokens are sent under the parameter name the provider accepts.
 */
export function adaptChatBody(body: ChatBody, maxTokens: number | undefined, cfg: AIConfig = aiConfig()): ChatBody {
  const out: ChatBody = { ...body };
  if (cfg.compact && Array.isArray(out.tools) && out.tool_choice?.function?.name) {
    out.tools = out.tools.map((t) => t?.function?.parameters
      ? { ...t, function: { ...t.function, parameters: capArrays(t.function.parameters, COMPACT_MAX_ITEMS, COMPACT_MAX_CHARS) } }
      : t);
    out.messages = [...(out.messages ?? []), { role: "system", content: COMPACT_HINT }];
  }
  if (cfg.structuredMode === "json_schema" && Array.isArray(out.tools) && out.tool_choice?.function?.name) {
    const name: string = out.tool_choice.function.name;
    const tool = out.tools.find((t) => t?.function?.name === name);
    if (tool?.function?.parameters) {
      out.response_format = {
        type: "json_schema",
        json_schema: { name, schema: tool.function.parameters, strict: true },
      };
      const hint = `Respond with ONLY a single JSON object that is the arguments of the \`${name}\` function${tool.function.description ? ` (${tool.function.description})` : ""}. No prose, no markdown fences.`;
      out.messages = [...(out.messages ?? []), { role: "system", content: hint }];
      delete out.tools;
      delete out.tool_choice;
    }
  }
  if (cfg.reasoningEffort && out.reasoning_effort === undefined) out.reasoning_effort = cfg.reasoningEffort;
  if (maxTokens && cfg.maxTokensParam !== "none") {
    out[cfg.maxTokensParam] = cfg.maxTokensCap ? Math.min(maxTokens, cfg.maxTokensCap) : maxTokens;
  }
  return out;
}

function stripFences(s: string): string {
  const t = s.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fence ? fence[1].trim() : t;
}

/**
 * Pull the JSON arguments of a forced tool call out of a (non-streaming) chat
 * completion. Accepts the OpenAI tool_calls shape (string or object
 * arguments) and, as a fallback, a JSON object returned as plain content —
 * which is what json_schema mode produces, and what some models do when they
 * ignore tool_choice.
 */
interface ChatCompletion {
  choices?: { message?: { content?: unknown; tool_calls?: { function?: { arguments?: unknown } }[] } }[];
}

export function extractToolArgs(aiJson: unknown): string | null {
  const msg = (aiJson as ChatCompletion | null)?.choices?.[0]?.message;
  const args = msg?.tool_calls?.[0]?.function?.arguments;
  if (typeof args === "string" && args.trim()) return args;
  if (args && typeof args === "object") return JSON.stringify(args);
  return contentAsJson(typeof msg?.content === "string" ? msg.content : "");
}

/** Return the JSON object inside free-text content, or null. */
export function contentAsJson(content: string): string | null {
  const t = stripFences(content ?? "");
  if (!t) return null;
  if (t.startsWith("{")) return t;
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  return first >= 0 && last > first ? t.slice(first, last + 1) : null;
}
