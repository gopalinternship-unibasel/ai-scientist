// Tests for the provider-agnostic AI configuration (aiProvider.ts).
// Run: deno test --allow-net --allow-env --allow-read supabase/functions/_shared/
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  adaptChatBody,
  capArrays,
  COMPACT_MAX_CHARS,
  COMPACT_MAX_ITEMS,
  contentAsJson,
  DEFAULT_BASE_URL,
  DEFAULT_LOCAL_MODEL,
  extractToolArgs,
  LOVABLE_CHAINS,
  parseEmbedDimensions,
  promptChars,
  resolveAIConfig,
} from "./aiProvider.ts";

// The tests poke into the adapted body's nested JSON; ChatBody types only
// the top level, so read the result as loose JSON here.
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseJson = any;
const adapt = (...args: Parameters<typeof adaptChatBody>): LooseJson => adaptChatBody(...args);

Deno.test("defaults to local Ollama with a placeholder key and no embeddings", () => {
  const cfg = resolveAIConfig({});
  assertEquals(cfg.baseUrl, DEFAULT_BASE_URL);
  assertEquals(cfg.apiKey, "ollama");
  assertEquals(cfg.chains.PLAN, [DEFAULT_LOCAL_MODEL]);
  assertEquals(cfg.structuredMode, "tools");
  assertEquals(cfg.embed.model, null);
});

Deno.test("AI_MODEL applies to every role; AI_MODEL_<ROLE> overrides one role as a chain", () => {
  const cfg = resolveAIConfig({
    AI_BASE_URL: "http://localhost:11434/v1/",
    AI_MODEL: "qwen2.5:7b",
    AI_MODEL_JUDGE: "llama3.1:8b, qwen2.5:3b",
  });
  assertEquals(cfg.baseUrl, "http://localhost:11434/v1");
  assertEquals(cfg.chains.PLAN, ["qwen2.5:7b"]);
  assertEquals(cfg.chains.GATE, ["qwen2.5:7b"]);
  assertEquals(cfg.chains.JUDGE, ["llama3.1:8b", "qwen2.5:3b"]);
});

Deno.test("Lovable gateway keeps the original per-role chains and legacy key", () => {
  const cfg = resolveAIConfig({
    AI_BASE_URL: "https://ai.gateway.lovable.dev/v1",
    LOVABLE_API_KEY: "test-key",
  });
  assertEquals(cfg.apiKey, "test-key");
  assertEquals(cfg.chains.PLAN, LOVABLE_CHAINS.PLAN);
  assertEquals(cfg.chains.JUDGE, ["openai/gpt-5"]);
  // The gateway rejected max_tokens on gpt-5, so nothing is sent by default.
  assertEquals(cfg.maxTokensParam, "none");
});

Deno.test("hosted providers without a key are reported as unconfigured", () => {
  const cfg = resolveAIConfig({ AI_BASE_URL: "https://api.openai.com/v1" });
  assertEquals(cfg.apiKey, null);
});

Deno.test("embedding config inherits chat base URL and key unless overridden", () => {
  const a = resolveAIConfig({ AI_BASE_URL: "https://api.openai.com/v1", AI_API_KEY: "k", AI_EMBED_MODEL: "text-embedding-3-small", AI_EMBED_DIMENSIONS: "true" });
  assertEquals(a.embed, { baseUrl: "https://api.openai.com/v1", apiKey: "k", model: "text-embedding-3-small", sendDimensions: true, dimensions: 768 });
  const b = resolveAIConfig({ AI_API_KEY: "k", AI_EMBED_BASE_URL: "http://host.docker.internal:11434/v1", AI_EMBED_API_KEY: "ollama", AI_EMBED_MODEL: "nomic-embed-text" });
  assertEquals(b.embed.baseUrl, "http://host.docker.internal:11434/v1");
  assertEquals(b.embed.apiKey, "ollama");
  assertEquals(b.embed.sendDimensions, false);
});

Deno.test("AI_MIN_TIMEOUT_MS is parsed as a positive floor", () => {
  assertEquals(resolveAIConfig({ AI_MIN_TIMEOUT_MS: "900000" }).minTimeoutMs, 900000);
  assertEquals(resolveAIConfig({ AI_MIN_TIMEOUT_MS: "nope" }).minTimeoutMs, 0);
});

const toolBody = {
  model: "m",
  messages: [{ role: "user", content: "hi" }],
  tools: [{ type: "function", function: { name: "decide", description: "Decide.", parameters: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } } }],
  tool_choice: { type: "function", function: { name: "decide" } },
};

Deno.test("tools mode passes the forced tool call through and adds max_tokens", () => {
  const cfg = resolveAIConfig({ AI_STRUCTURED_OUTPUT: "tools" });
  const out = adapt(toolBody, 300, cfg);
  assertEquals(out.tools, toolBody.tools);
  assertEquals(out.tool_choice, toolBody.tool_choice);
  assertEquals(out.max_tokens, 300);
  assert(!("response_format" in out));
});

Deno.test("json_schema mode converts a forced tool call into response_format", () => {
  const cfg = resolveAIConfig({ AI_STRUCTURED_OUTPUT: "json_schema", AI_MAX_TOKENS_PARAM: "max_completion_tokens" });
  const out = adapt(toolBody, 300, cfg);
  assert(!("tools" in out) && !("tool_choice" in out));
  assertEquals(out.response_format.type, "json_schema");
  assertEquals(out.response_format.json_schema.name, "decide");
  assertEquals(out.response_format.json_schema.schema, toolBody.tools[0].function.parameters);
  assertEquals(out.messages.length, 2);
  assertEquals(out.max_completion_tokens, 300);
  // The caller's body is not mutated.
  assertEquals(toolBody.messages.length, 1);
});

Deno.test("AI_MAX_TOKENS_CAP bounds every output budget", () => {
  const cfg = resolveAIConfig({ AI_MAX_TOKENS_CAP: "2048" });
  assertEquals(adapt({ model: "m", messages: [] }, 8000, cfg).max_tokens, 2048);
  assertEquals(adapt({ model: "m", messages: [] }, 300, cfg).max_tokens, 300);
});

Deno.test("max_tokens is omitted when AI_MAX_TOKENS_PARAM=none", () => {
  const out = adapt({ model: "m", messages: [] }, 500, resolveAIConfig({ AI_MAX_TOKENS_PARAM: "none" }));
  assert(!("max_tokens" in out));
});

Deno.test("extractToolArgs reads tool_calls (string or object) and falls back to JSON content", () => {
  assertEquals(extractToolArgs({ choices: [{ message: { tool_calls: [{ function: { arguments: '{"ok":true}' } }] } }] }), '{"ok":true}');
  assertEquals(extractToolArgs({ choices: [{ message: { tool_calls: [{ function: { arguments: { ok: true } } }] } }] }), '{"ok":true}');
  assertEquals(extractToolArgs({ choices: [{ message: { content: '```json\n{"ok":false}\n```' } }] }), '{"ok":false}');
  assertEquals(extractToolArgs({ choices: [{ message: { content: 'Sure! {"ok":true} done' } }] }), '{"ok":true}');
  assertEquals(extractToolArgs({ choices: [{ message: { content: "no json here" } }] }), null);
  assertEquals(extractToolArgs(null), null);
});

Deno.test("contentAsJson keeps a bare object unchanged", () => {
  assertEquals(contentAsJson('  {"a":1}  '), '{"a":1}');
});

const listBody = {
  model: "m",
  messages: [{ role: "user", content: "plan" }],
  tools: [{ type: "function", function: { name: "submit", parameters: {
    type: "object",
    properties: {
      steps: { type: "array", items: { type: "object", properties: { tags: { type: "array", items: { type: "string" } } } } },
      fixed: { type: "array", maxItems: 2, items: { type: "string" } },
    },
  } } }],
  tool_choice: { type: "function", function: { name: "submit" } },
};

Deno.test("compact mode is off unless AI_COMPACT_OUTPUT is true", () => {
  assertEquals(resolveAIConfig({}).compact, false);
  assertEquals(resolveAIConfig({ AI_COMPACT_OUTPUT: "true" }).compact, true);
  const out = adapt(listBody, 100, resolveAIConfig({}));
  assertEquals(out.tools, listBody.tools);
  assertEquals(out.messages.length, 1);
});

Deno.test("compact mode caps every list (nested too) and asks for short fields", () => {
  const cfg = resolveAIConfig({ AI_COMPACT_OUTPUT: "true", AI_STRUCTURED_OUTPUT: "json_schema" });
  const out = adapt(listBody, 100, cfg);
  const schema = out.response_format.json_schema.schema;
  assertEquals(schema.properties.steps.maxItems, COMPACT_MAX_ITEMS);
  assertEquals(schema.properties.steps.items.properties.tags.maxItems, COMPACT_MAX_ITEMS);
  // An explicit maxItems is kept.
  assertEquals(schema.properties.fixed.maxItems, 2);
  assert(out.messages.some((m: { content: string }) => /Be concise/.test(m.content)));
  // The shared schema object is not mutated.
  assertEquals("maxItems" in listBody.tools[0].function.parameters.properties.steps, false);
});

Deno.test("capArrays leaves non-array schemas alone", () => {
  assertEquals(capArrays({ type: "string" }, 3), { type: "string" });
});

Deno.test("promptChars shrinks long prompt inputs only in compact mode", () => {
  assertEquals(promptChars(12000, 6000, resolveAIConfig({})), 12000);
  assertEquals(promptChars(12000, 6000, resolveAIConfig({ AI_COMPACT_OUTPUT: "1" })), 6000);
});

Deno.test("compact mode caps free-text strings so a looping model has to close them", () => {
  const body = {
    model: "m",
    messages: [{ role: "user", content: "x" }],
    tools: [{
      type: "function",
      function: {
        name: "submit",
        parameters: {
          type: "object",
          properties: {
            approach: { type: "string" },
            level: { type: "string", enum: ["BSL-1", "BSL-2"] },
            short: { type: "string", maxLength: 20 },
            steps: { type: "array", items: { type: "object", properties: { text: { type: "string" } } } },
          },
        },
      },
    }],
    tool_choice: { type: "function", function: { name: "submit" } },
  };
  const out = adapt(body, 100, resolveAIConfig({ AI_COMPACT_OUTPUT: "true", AI_STRUCTURED_OUTPUT: "json_schema" }));
  const p = out.response_format.json_schema.schema.properties;
  assertEquals(p.approach.maxLength, COMPACT_MAX_CHARS);
  assertEquals(p.steps.items.properties.text.maxLength, COMPACT_MAX_CHARS);
  assertEquals("maxLength" in p.level, false);
  assertEquals(p.short.maxLength, 20);
  // Without compact mode nothing is capped.
  const hosted = adapt(body, 100, resolveAIConfig({ AI_STRUCTURED_OUTPUT: "tools" }));
  assertEquals("maxLength" in hosted.tools[0].function.parameters.properties.approach, false);
});

Deno.test("AI_EMBED_DIMENSIONS: true asks for 768, a number asks for that many, junk sends nothing", () => {
  assertEquals(parseEmbedDimensions(undefined), { send: false, dimensions: 768 });
  assertEquals(parseEmbedDimensions("true"), { send: true, dimensions: 768 });
  assertEquals(parseEmbedDimensions("768"), { send: true, dimensions: 768 });
  assertEquals(parseEmbedDimensions("1536"), { send: true, dimensions: 1536 });
  assertEquals(parseEmbedDimensions("0"), { send: false, dimensions: 768 });
  assertEquals(parseEmbedDimensions("abc"), { send: false, dimensions: 768 });
  assertEquals(resolveAIConfig({ AI_EMBED_DIMENSIONS: "512" }).embed.dimensions, 512);
});

Deno.test("AI_REASONING_EFFORT is added to the chat body only when set", () => {
  assertEquals(resolveAIConfig({}).reasoningEffort, null);
  assert(!("reasoning_effort" in adapt(toolBody, 300, resolveAIConfig({}))));
  const cfg = resolveAIConfig({ AI_REASONING_EFFORT: " Low " });
  assertEquals(cfg.reasoningEffort, "low");
  assertEquals(adapt(toolBody, 300, cfg).reasoning_effort, "low");
  assertEquals(adapt({ ...toolBody, reasoning_effort: "high" }, 300, cfg).reasoning_effort, "high");
});

Deno.test("tools_required mode sends only the forced tool with tool_choice required", () => {
  const cfg = resolveAIConfig({ AI_STRUCTURED_OUTPUT: "tools_required" });
  assertEquals(cfg.structuredMode, "tools_required");
  const body = {
    model: "m",
    messages: [{ role: "user", content: "hi" }],
    tools: [
      { type: "function", function: { name: "other", parameters: { type: "object", properties: {} } } },
      { type: "function", function: { name: "decide", parameters: { type: "object", properties: { ok: { type: "boolean" } } } } },
    ],
    tool_choice: { type: "function", function: { name: "decide" } },
  };
  const out = adaptChatBody(body, 300, cfg);
  assertEquals(out.tool_choice, "required");
  assertEquals(out.tools?.length, 1);
  assertEquals(out.tools?.[0].function?.name, "decide");
  assert(!("response_format" in out));
  // The request passed in is not changed.
  assertEquals(body.tools.length, 2);
  assertEquals(body.tool_choice, { type: "function", function: { name: "decide" } });
});

Deno.test("tools_required mode leaves a request alone when it forces no function", () => {
  const cfg = resolveAIConfig({ AI_STRUCTURED_OUTPUT: "tools_required" });
  const auto = { model: "m", messages: [], tools: [{ type: "function", function: { name: "a" } }], tool_choice: "auto" };
  assertEquals(adaptChatBody(auto, undefined, cfg).tool_choice, "auto");
  const plain = { model: "m", messages: [] };
  assert(!("tool_choice" in adaptChatBody(plain, undefined, cfg)));
  // A forced name that is not among the tools is passed through unchanged.
  const missing = {
    model: "m",
    messages: [],
    tools: [{ type: "function", function: { name: "a" } }],
    tool_choice: { type: "function", function: { name: "b" } },
  };
  assertEquals(adaptChatBody(missing, undefined, cfg).tool_choice, missing.tool_choice);
});

Deno.test("an unknown AI_STRUCTURED_OUTPUT value falls back to tools", () => {
  assertEquals(resolveAIConfig({ AI_STRUCTURED_OUTPUT: "something" }).structuredMode, "tools");
  assertEquals(resolveAIConfig({ AI_STRUCTURED_OUTPUT: "TOOLS_REQUIRED" }).structuredMode, "tools_required");
});
