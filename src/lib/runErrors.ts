// Typed failure reasons stored in `runs.error` as "KIND: message".
// Mirrors supabase/functions/_shared/ai-fallback.ts. Kept in sync manually
// since we can't share TS code across the Vite/Deno boundary.
export type ErrorKind =
  | "TIMEOUT" | "RATE_LIMIT" | "CREDITS"
  | "PARSE" | "UPSTREAM" | "POLICY" | "VALIDATION" | "INTERNAL";

const KNOWN: ErrorKind[] = [
  "TIMEOUT", "RATE_LIMIT", "CREDITS", "PARSE", "UPSTREAM", "POLICY", "VALIDATION", "INTERNAL",
];

export interface ParsedError {
  kind: ErrorKind;
  message: string;
}

/** Parse a `runs.error` string into kind + human message. */
export function parseRunError(raw: string | null | undefined): ParsedError {
  if (!raw) return { kind: "INTERNAL", message: "Unknown error." };
  const idx = raw.indexOf(": ");
  if (idx > 0) {
    const head = raw.slice(0, idx);
    if ((KNOWN as string[]).includes(head)) {
      return { kind: head as ErrorKind, message: raw.slice(idx + 2) };
    }
  }
  // Legacy / unstructured strings — try to infer.
  const lower = raw.toLowerCase();
  if (/timed out|stalled|connection lost/.test(lower)) {
    return { kind: "TIMEOUT", message: raw };
  }
  if (/rate limit/.test(lower)) return { kind: "RATE_LIMIT", message: raw };
  if (/credit/.test(lower)) return { kind: "CREDITS", message: raw };
  if (/malformed|parse/.test(lower)) return { kind: "PARSE", message: raw };
  return { kind: "INTERNAL", message: raw };
}

/** Short hint shown below the error message to guide the user's next step. */
export function hintForKind(kind: ErrorKind): string {
  switch (kind) {
    case "TIMEOUT": return "The model took too long. Retrying usually clears it up.";
    case "RATE_LIMIT": return "An upstream provider rate-limited us. Wait a moment, then retry.";
    case "CREDITS": return "Your workspace AI credits are exhausted. Top up before retrying.";
    case "PARSE": return "The model returned malformed output. A retry usually fixes this.";
    case "UPSTREAM": return "The AI provider was unavailable. We'll try a backup model on retry.";
    case "POLICY": return "Try rewording the hypothesis without trigger terms before retrying.";
    case "VALIDATION": return "Rewrite it as one testable hypothesis: an intervention, the system it acts on, a measurable outcome and a comparison, then start a new experiment.";
    default: return "Please retry. If it keeps failing, reword the hypothesis.";
  }
}

/** Whether a Retry button makes sense for this kind. */
export function isRetryable(kind: ErrorKind): boolean {
  // The same input gets the same verdict from the hypothesis gate.
  return kind !== "CREDITS" && kind !== "VALIDATION";
}
