import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface S2Paper {
  paperId: string;
  title: string;
  abstract?: string | null;
  year?: number | null;
  authors?: { name: string }[];
  venue?: string | null;
  citationCount?: number | null;
  url?: string | null;
  externalIds?: Record<string, string> | null;
}

async function searchSemanticScholar(query: string): Promise<{ papers: S2Paper[]; rateLimited: boolean }> {
  const q = query.replace(/\s+/g, " ").trim().slice(0, 280);
  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", q);
  url.searchParams.set("limit", "8");
  url.searchParams.set(
    "fields",
    "title,abstract,year,authors.name,venue,citationCount,url,externalIds"
  );

  // Retry up to 3 times with backoff for 429s.
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "AI-Scientist/1.0 (Lovable)" },
    });
    if (res.ok) {
      const json = await res.json();
      return { papers: (json.data ?? []) as S2Paper[], rateLimited: false };
    }
    if (res.status === 429) {
      console.warn(`S2 rate limited, attempt ${attempt + 1}`);
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    console.error("Semantic Scholar error", res.status, await res.text());
    return { papers: [], rateLimited: false };
  }
  return { papers: [], rateLimited: true };
}

async function classifyNovelty(
  hypothesis: string,
  papers: S2Paper[]
): Promise<{ signal: "not_found" | "similar" | "exact_match"; rationale: string; chosen: number[] }> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY || papers.length === 0) {
    return {
      signal: papers.length === 0 ? "not_found" : "similar",
      rationale: papers.length === 0 ? "No papers retrieved from Semantic Scholar." : "Heuristic match on retrieved papers.",
      chosen: papers.slice(0, 3).map((_, i) => i),
    };
  }

  const condensed = papers.slice(0, 8).map((p, i) => ({
    i,
    title: p.title,
    year: p.year,
    venue: p.venue,
    abstract: (p.abstract ?? "").slice(0, 600),
  }));

  const body = {
    model: "google/gemini-3-flash-preview",
    messages: [
      {
        role: "system",
        content:
          "You are a research librarian assessing novelty. Given a hypothesis and candidate papers, judge whether the exact experiment has been done, similar work exists, or it appears to be new ground. Choose 1-3 papers most relevant.",
      },
      {
        role: "user",
        content: `HYPOTHESIS:\n${hypothesis}\n\nCANDIDATES:\n${JSON.stringify(condensed)}`,
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "report_novelty",
          description: "Report novelty assessment.",
          parameters: {
            type: "object",
            properties: {
              signal: { type: "string", enum: ["not_found", "similar", "exact_match"] },
              rationale: { type: "string", description: "1-2 sentence justification." },
              chosen: {
                type: "array",
                items: { type: "integer" },
                description: "Indices (0-based) of the most relevant 1-3 papers.",
              },
            },
            required: ["signal", "rationale", "chosen"],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "report_novelty" } },
  };

  const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!aiRes.ok) {
    console.error("AI gateway error", aiRes.status, await aiRes.text());
    return {
      signal: "similar",
      rationale: "AI classification unavailable; defaulting to similar work exists based on retrieval.",
      chosen: papers.slice(0, 3).map((_, i) => i),
    };
  }

  const aiJson = await aiRes.json();
  const call = aiJson.choices?.[0]?.message?.tool_calls?.[0];
  try {
    const args = JSON.parse(call.function.arguments);
    return args;
  } catch {
    return {
      signal: "similar",
      rationale: "Unable to parse classification.",
      chosen: papers.slice(0, 3).map((_, i) => i),
    };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { hypothesis } = await req.json();
    if (!hypothesis || typeof hypothesis !== "string" || hypothesis.length < 10) {
      return new Response(JSON.stringify({ error: "Provide a hypothesis (min 10 chars)." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { papers, rateLimited } = await searchSemanticScholar(hypothesis);
    const verdict = await classifyNovelty(hypothesis, papers);
    if (rateLimited && papers.length === 0) {
      verdict.rationale = "Semantic Scholar is rate-limiting requests. Treating as unknown novelty.";
    }

    const references = (verdict.chosen ?? [])
      .map((i) => papers[i])
      .filter(Boolean)
      .slice(0, 3)
      .map((p) => ({
        title: p.title,
        year: p.year,
        authors: (p.authors ?? []).slice(0, 4).map((a) => a.name),
        venue: p.venue,
        citationCount: p.citationCount,
        url:
          p.url ??
          (p.externalIds?.DOI
            ? `https://doi.org/${p.externalIds.DOI}`
            : `https://www.semanticscholar.org/paper/${p.paperId}`),
      }));

    return new Response(
      JSON.stringify({ signal: verdict.signal, rationale: verdict.rationale, references }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("literature-qc error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
