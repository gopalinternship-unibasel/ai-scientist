// SSE client for the run-experiment edge function.
// Emits typed events as the backend progresses through QC, plan, and critique generation.
import type { ExperimentPlan, LiteratureQC, PlanCritique } from "@/lib/samples";
import { supabase } from "@/integrations/supabase/client";

export type RunStreamEvent =
  | { type: "run"; id: string; cached: boolean }
  | { type: "qc"; qc: LiteratureQC }
  | { type: "progress"; chars: number; partial: Partial<ExperimentPlan> | null }
  | { type: "plan"; plan: ExperimentPlan }
  | { type: "critique"; critique: PlanCritique }
  | { type: "done"; id: string }
  | { type: "error"; message: string };

interface StartArgs {
  hypothesis: string;
  ownerToken: string;
  signal?: AbortSignal;
  onEvent: (e: RunStreamEvent) => void;
}

const URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/run-experiment`;

export async function startRunStream({ hypothesis, ownerToken, signal, onEvent }: StartArgs) {
  // Use the user's session token if available so the edge function can attribute the run.
  const { data: { session } } = await supabase.auth.getSession();
  const bearer = session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const resp = await fetch(URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({ hypothesis, owner_token: ownerToken }),
    signal,
  });

  if (!resp.ok) {
    let msg = `Request failed (${resp.status})`;
    try {
      const j = await resp.json();
      if (j.error) msg = j.error;
    } catch { /* noop */ }
    onEvent({ type: "error", message: msg });
    return;
  }
  if (!resp.body) {
    onEvent({ type: "error", message: "No response body" });
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let currentEvent = "message";

  const dispatch = (event: string, dataStr: string) => {
    try {
      const data = JSON.parse(dataStr);
      switch (event) {
        case "run": onEvent({ type: "run", id: data.id, cached: !!data.cached }); break;
        case "qc": onEvent({ type: "qc", qc: data }); break;
        case "progress": onEvent({ type: "progress", chars: data.chars, partial: data.partial ?? null }); break;
        case "plan": onEvent({ type: "plan", plan: data }); break;
        case "critique": onEvent({ type: "critique", critique: data }); break;
        case "done": onEvent({ type: "done", id: data.id }); break;
        case "error": onEvent({ type: "error", message: data.message }); break;
      }
    } catch {
      // ignore malformed
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buf.indexOf("\n")) !== -1) {
      let line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);

      if (line === "") {
        currentEvent = "message";
        continue;
      }
      if (line.startsWith(":")) continue;
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
        continue;
      }
      if (line.startsWith("data: ")) {
        dispatch(currentEvent, line.slice(6));
        continue;
      }
    }
  }
}
