import { describe, it, expect, vi, beforeEach } from "vitest";
import { startRunStream, type RunStreamEvent } from "./runStream";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

describe("startRunStream SSE parser", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("emits an error event when the response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "rate limited" }), { status: 429 }),
      ),
    );
    const events: RunStreamEvent[] = [];
    await startRunStream({
      hypothesis: "h",
      ownerToken: "tok",
      onEvent: (e) => events.push(e),
    });
    expect(events).toEqual([{ type: "error", message: "rate limited" }]);
  });

  it("dispatches typed events from a well-formed SSE stream", async () => {
    const body = sseStream([
      'event: run\ndata: {"id":"abc","cached":false}\n\n',
      'event: qc\ndata: {"papers":[]}\n\n',
      'event: done\ndata: {"id":"abc"}\n\n',
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 })),
    );
    const events: RunStreamEvent[] = [];
    await startRunStream({
      hypothesis: "h",
      ownerToken: "tok",
      onEvent: (e) => events.push(e),
    });
    expect(events.map((e) => e.type)).toEqual(["run", "qc", "done"]);
    expect((events[0] as Extract<RunStreamEvent, { type: "run" }>).id).toBe("abc");
  });

  it("handles chunks that split lines mid-stream", async () => {
    const body = sseStream([
      'event: run\ndata: {"id":"',
      'abc","cached":true}\n\nevent: done\ndata: {"id":"abc"}\n\n',
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 })),
    );
    const events: RunStreamEvent[] = [];
    await startRunStream({
      hypothesis: "h",
      ownerToken: "tok",
      onEvent: (e) => events.push(e),
    });
    const run = events.find((e) => e.type === "run") as Extract<RunStreamEvent, { type: "run" }>;
    expect(run.cached).toBe(true);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("ignores malformed JSON payloads without throwing", async () => {
    const body = sseStream([
      'event: run\ndata: {not json\n\n',
      'event: done\ndata: {"id":"x"}\n\n',
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 })),
    );
    const events: RunStreamEvent[] = [];
    await startRunStream({
      hypothesis: "h",
      ownerToken: "tok",
      onEvent: (e) => events.push(e),
    });
    expect(events).toEqual([{ type: "done", id: "x" }]);
  });

  it("skips comment lines (heartbeats) starting with ':'", async () => {
    const body = sseStream([
      ': heartbeat\n\n',
      'event: done\ndata: {"id":"x"}\n\n',
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 })),
    );
    const events: RunStreamEvent[] = [];
    await startRunStream({
      hypothesis: "h",
      ownerToken: "tok",
      onEvent: (e) => events.push(e),
    });
    expect(events).toEqual([{ type: "done", id: "x" }]);
  });
});
