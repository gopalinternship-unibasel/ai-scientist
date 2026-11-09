// Best-effort parse of a JSON object that is still streaming in.
//
// Closes every unfinished string, array and object (in the right order) and
// drops a trailing key or value that is cut off mid-token, so callers can see
// which top-level sections of a streamed plan have started. Returns null when
// nothing usable parses.
//
// The earlier inline version closed every open bracket with "}", so as soon
// as the stream was inside an array (success_criteria, protocol, ...) no
// partial parse succeeded and the run page could not list sections.

export function tryParsePartial(s: string): Record<string, unknown> | null {
  const text = s.trimStart();
  if (!text.startsWith("{")) return null;
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (const c of text) {
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") stack.push("}");
    else if (c === "[") stack.push("]");
    else if (c === "}" || c === "]") stack.pop();
  }
  const asObject = (candidate: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(candidate);
      return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
    } catch {
      return null;
    }
  };
  if (stack.length === 0 && !inStr) return asObject(text);

  let trial = text;
  if (inStr) trial = (esc ? trial.slice(0, -1) : trial) + '"';
  const closers = stack.slice().reverse().join("");
  const attempts = [
    trial,
    trial.replace(/,\s*$/, ""),
    // a key without its value yet:  ..., "key":   or  ..., "key"
    trial.replace(/,?\s*"(?:[^"\\]|\\.)*"\s*:?\s*$/, ""),
    // a scalar cut off mid-token:  "alpha": 0.  /  "ok": tr
    trial.replace(/,?\s*"(?:[^"\\]|\\.)*"\s*:\s*[^\s,{}[\]"]+$/, ""),
    trial.replace(/,?\s*[^\s,{}[\]"]+$/, ""),
  ];
  for (const a of attempts) {
    const v = asObject(a + closers);
    if (v) return v;
  }
  return null;
}
