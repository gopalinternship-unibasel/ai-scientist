import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runFailure } from "./ai-fallback.ts";

Deno.test("a model call that timed out fails the run as TIMEOUT, anything else as INTERNAL", () => {
  assertEquals(runFailure(new Error("plan-stream timed out after 3600000ms")).kind, "TIMEOUT");
  const abort = new Error("The signal has been aborted");
  abort.name = "AbortError";
  assertEquals(runFailure(abort).kind, "TIMEOUT");
  assertEquals(runFailure(new TypeError("x is undefined")).kind, "INTERNAL");
});
