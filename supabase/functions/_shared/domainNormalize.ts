// Domain normalizer — maps free-text plan.domain into a small controlled
// vocabulary so cross-run feedback retrieval can compare apples to apples.
//
// Used by BOTH the planner edge function (when persisting runs.domain) and
// the client (before inserting plan_feedback.domain). Keep this file pure
// JS/TS so it can be imported from either runtime without bundler tricks.

export const DOMAINS = [
  "cell-biology",
  "molecular-biology",
  "biochemistry",
  "microbiology",
  "neuroscience",
  "immunology",
  "genetics",
  "genomics",
  "proteomics",
  "pharmacology",
  "clinical",
  "ecology",
  "plant-biology",
  "chemistry",
  "organic-chemistry",
  "materials-science",
  "nanotechnology",
  "physics",
  "engineering",
  "computer-science",
  "machine-learning",
  "other",
] as const;

export type CanonicalDomain = (typeof DOMAINS)[number];

// Keyword → canonical. Order matters: more specific patterns first.
const RULES: Array<[RegExp, CanonicalDomain]> = [
  [/\b(crispr|pcr|qpcr|rna[\s-]?seq|sequencing|gene\s+expression|mrna\s+expression|plasmid|transfection|knockout)\b/i, "molecular-biology"],
  [/\b(cell\s+culture|hela|hek\s?293|hct\s?116|a549|ips[c]?|stem\s+cell|fluorescence\s+microscop|flow\s+cytometry|mitochond)/i, "cell-biology"],
  [/\b(enzyme|kinase|protein\s+(folding|purif)|western\s+blot|elisa|chromatograph)\b/i, "biochemistry"],
  [/\b(bacter|e\.?\s?coli|yeast|fungal|biofilm|antibiotic|microbiom)/i, "microbiology"],
  [/\b(neur(on|al)|brain|synap|fmri|eeg|optogenet|axon|dendrit)/i, "neuroscience"],
  [/\b(t\s?cell|b\s?cell|cytokine|il-?\d+|tnf|antibod|immune|vaccine|inflamm)/i, "immunology"],
  [/\b(gwas|snp|allele|hereditar|mendel|haplotyp)/i, "genetics"],
  [/\b(genom(e|ic)|exome|metagenom|whole[\s-]?genome)/i, "genomics"],
  [/\b(proteom|mass\s+spec|peptide\s+identif)/i, "proteomics"],
  [/\b(drug|pharmaco|ic50|ec50|dose[\s-]?response|pk\/pd|adme)/i, "pharmacology"],
  [/\b(clinical\s+trial|patient|cohort|randomi[sz]ed|placebo|biomarker)/i, "clinical"],
  [/\b(ecosystem|biodivers|species\s+richness|habitat|climate\s+change)/i, "ecology"],
  [/\b(arabidopsis|maize|wheat|photosynth|chloroplast|root\s+system)/i, "plant-biology"],
  [/\b(catalys|reaction\s+mechanism|nmr|reflux|reagent\s+synthesis|organic\s+synthesis)/i, "organic-chemistry"],
  [/\b(electrochem|inorganic|coordination\s+complex|spectroscop)/i, "chemistry"],
  [/\b(graphene|composite|alloy|polymer|tensile|young's\s+modulus|crystal\s+structure|lattice)/i, "materials-science"],
  [/\b(nano(particle|wire|tube|rod)|quantum\s+dot|self[\s-]?assembl)/i, "nanotechnology"],
  [/\b(quantum|relativ|photon|particle\s+physics|condensed\s+matter|superconduct)/i, "physics"],
  [/\b(finite\s+element|mechanical\s+design|circuit|microcontroll|cad|fluid\s+dynamics)/i, "engineering"],
  [/\b(neural\s+network|deep\s+learning|transformer|llm|gradient\s+descent|reinforcement\s+learning)/i, "machine-learning"],
  [/\b(algorithm|compiler|database|distributed\s+system|operating\s+system)/i, "computer-science"],
];

/**
 * Pure regex-based normaliser.
 *
 * Returns `null` (not 'other') when nothing matches, so callers can decide
 * whether to fall through to a more expensive LLM classifier.
 */
export function normalizeDomainStrict(...inputs: Array<string | null | undefined>): CanonicalDomain | null {
  const blob = inputs.filter(Boolean).join(" ").toLowerCase();
  if (!blob.trim()) return null;
  for (const d of DOMAINS) {
    if (blob === d || blob.replace(/[\s_]+/g, "-") === d) return d;
  }
  for (const [re, dom] of RULES) {
    if (re.test(blob)) return dom;
  }
  return null;
}

/**
 * Backwards-compatible wrapper — returns 'other' when nothing matches so
 * existing call sites that don't care about LLM fallback keep working.
 */
export function normalizeDomain(...inputs: Array<string | null | undefined>): CanonicalDomain {
  return normalizeDomainStrict(...inputs) ?? "other";
}

/**
 * LLM-backed fallback classifier. Only call this when `normalizeDomainStrict`
 * returns null — it's cheap (gpt-5-nano, ~$0.0001/call) but not free.
 *
 * Returns 'other' on any failure so callers don't need to special-case errors.
 */
export async function classifyDomainWithLLM(
  text: string,
  apiKey: string,
): Promise<CanonicalDomain> {
  if (!text.trim() || !apiKey) return "other";
  const snippet = text.slice(0, 1500);
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error("domain-classify timed out after 5000ms")), 5_000);
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      signal: ac.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are a precise classifier. Pick the SINGLE best domain label for the given research text from the controlled vocabulary. If nothing fits well, return "other". Do not invent labels.`,
          },
          { role: "user", content: `TEXT:\n${snippet}\n\nReturn the domain via the tool.` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "classify_domain",
            parameters: {
              type: "object",
              properties: {
                domain: { type: "string", enum: DOMAINS as unknown as string[] },
              },
              required: ["domain"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "classify_domain" } },
      }),
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return "other";
    const j = await res.json();
    const args = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return "other";
    const parsed = JSON.parse(args);
    const dom = parsed?.domain;
    return (DOMAINS as readonly string[]).includes(dom) ? (dom as CanonicalDomain) : "other";
  } catch (e) {
    console.warn("classifyDomainWithLLM failed:", e);
    return "other";
  }
}

/**
 * Resolve a domain: try regex first, fall back to LLM only when that returns
 * null. Always returns a canonical label.
 */
export async function resolveDomain(
  apiKey: string,
  ...inputs: Array<string | null | undefined>
): Promise<CanonicalDomain> {
  const strict = normalizeDomainStrict(...inputs);
  if (strict) return strict;
  const blob = inputs.filter(Boolean).join("\n").trim();
  if (!blob) return "other";
  return await classifyDomainWithLLM(blob, apiKey);
}

// Cheap spam / quality filter for free-text feedback corrections.
// Returns null when text passes; otherwise a user-facing reason string.
const URL_RE = /(https?:\/\/|www\.)\S+/gi;
const REPEATED_CHAR_RE = /(.)\1{6,}/;

export function validateCorrection(raw: string): string | null {
  const text = (raw ?? "").trim();
  if (text.length < 8) return "Please write at least 8 characters.";
  if (text.length > 2000) return "Please keep corrections under 2000 characters.";
  if (REPEATED_CHAR_RE.test(text)) return "Looks like spam — too many repeated characters.";
  const urlChars = (text.match(URL_RE) ?? []).join("").length;
  if (urlChars / text.length > 0.5) return "Please describe the issue in your own words, not just links.";
  const letters = (text.match(/[a-zA-Z]/g) ?? []).length;
  if (letters / text.length < 0.3) return "Please write in plain language.";
  return null;
}
