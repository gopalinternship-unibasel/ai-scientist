// Distillation pass — takes the most-trusted recent corrections in a single
// domain and asks an LLM to synthesise them into 5–8 stable rules. The output
// becomes the planner's "house rules" for that domain (see houseRules.ts).
//
// Auth: caller must be moderator or admin. The corrections_for_distillation()
// RPC is itself security-defined and gated, so we double-check here for a fast
// 403 before paying for an LLM call.
//
// Behaviour: the previous active rules for that domain are deactivated (kept
// for audit) and replaced with the new batch.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.104.1";
import { corsHeaders } from "../_shared/cors.ts";
import { publicKey, serviceKey } from "../_shared/supabaseKeys.ts";
import { callAIWithFallback } from "../_shared/ai-fallback.ts";
import { aiApiKey, extractToolArgs, modelChain } from "../_shared/aiProvider.ts";
import { DOMAINS } from "../_shared/domainNormalize.ts";

interface RuleProposal {
  rule: string;
  confidence: number;
  source_count: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = serviceKey();
  const ANON_KEY = publicKey();
  const AI_API_KEY = aiApiKey();

  if (!AI_API_KEY) {
    return new Response(JSON.stringify({ error: "Service not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Validate caller as moderator/admin via their JWT.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "auth required" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: who } = await userClient.auth.getUser();
  if (!who?.user) {
    return new Response(JSON.stringify({ error: "auth required" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // Role check (defence in depth; the RPC gates the corrections fetch too).
  const { data: roles } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", who.user.id);
  const ok = (roles ?? []).some((r) => r.role === "moderator" || r.role === "admin");
  if (!ok) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { domain?: string; domains?: string[]; async?: boolean } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const targets = body.domains ?? (body.domain ? [body.domain] : DOMAINS as unknown as string[]);
  // Use the user's client so the RPC sees their JWT for the role check inside.
  const supabase = userClient;
  // Use service role for writes (bypasses RLS once we've authorised the caller).
  const writer = createClient(SUPABASE_URL, SERVICE_KEY);

  const results: { domain: string; created: number; skipped?: string }[] = [];

  const distillAll = async () => {
    for (const domain of targets) {
      try {
        const { data: corrections, error: corrErr } = await supabase.rpc(
          "corrections_for_distillation",
          { _domain: domain, _limit: 200 },
        );
        if (corrErr) {
          console.warn(`distill ${domain}: rpc failed`, corrErr.message);
          results.push({ domain, created: 0, skipped: "rpc_failed" });
          continue;
        }
        // Need a meaningful corpus before distilling.
        const items = (corrections ?? []) as Array<{ section: string; correction: string; rating: number | null; dup_count: number }>;
        if (items.length < 4) {
          results.push({ domain, created: 0, skipped: "too_few_corrections" });
          continue;
        }

        const condensed = items
          .slice(0, 80)
          .map((c, i) => `[${i + 1}] section=${c.section}${c.rating != null ? ` rating=${c.rating}/5` : ""} (×${c.dup_count}): ${c.correction.slice(0, 220)}`)
          .join("\n");

        const { res: aiRes } = await callAIWithFallback({
          apiKey: AI_API_KEY,
          // DISTILL chain (gpt-5-mini on the Lovable gateway): rule quality
          // compounds across every future plan in this domain, so reasoning
          // matters more than cost. Low volume (cron job).
          models: modelChain("DISTILL"),
          label: "distill-house-rules",
          retries: 1,
          timeoutMs: 60_000,
          maxTokens: 1500,
          buildBody: (model) => ({
            model,
            messages: [
              {
                role: "system",
                content: `You are an expert research methodologist. Given a list of CORRECTIONS that real scientists left on past experiment plans in the ${domain.toUpperCase()} domain, distill them into 5-8 STABLE HOUSE RULES that should guide future plans in this domain.

  Each rule must be:
  - Concrete and actionable (e.g. "Always use sterile-filtered FBS for primary cell culture", not "Be careful with cells")
  - Generalisable across hypotheses (avoid one-off SKU corrections — those are handled separately)
  - Phrased in 1-2 sentences, max 200 chars
  - Backed by multiple corrections when possible

  For each rule, set:
  - confidence (0-1): how strong is the evidence across the corpus
  - source_count: how many of the input corrections support this rule

  If the corpus does not yield clear stable rules, return fewer rules (or none) rather than inventing them.`,
              },
              { role: "user", content: `DOMAIN: ${domain}\n\nCORRECTIONS:\n${condensed}\n\nDistill into stable house rules.` },
            ],
            tools: [{
              type: "function",
              function: {
                name: "submit_house_rules",
                description: "Distilled stable rules for this domain.",
                parameters: {
                  type: "object",
                  properties: {
                    rules: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          rule: { type: "string", description: "1-2 sentence concrete rule, max 200 chars" },
                          confidence: { type: "number", minimum: 0, maximum: 1 },
                          source_count: { type: "integer", minimum: 1 },
                        },
                        required: ["rule", "confidence", "source_count"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["rules"],
                  additionalProperties: false,
                },
              },
            }],
            tool_choice: { type: "function", function: { name: "submit_house_rules" } },
          }),
        });

        if (!aiRes.ok) {
          console.warn(`distill ${domain}: ai gateway ${aiRes.status}`);
          results.push({ domain, created: 0, skipped: `ai_${aiRes.status}` });
          continue;
        }
        const aiJson = await aiRes.json();
        const args = extractToolArgs(aiJson);
        if (!args) {
          results.push({ domain, created: 0, skipped: "no_tool_call" });
          continue;
        }
        const parsed = JSON.parse(args) as { rules: RuleProposal[] };
        const rules = (parsed.rules ?? [])
          .filter((r) => r.rule && r.rule.trim().length >= 10)
          .slice(0, 8);

        if (rules.length === 0) {
          results.push({ domain, created: 0, skipped: "no_rules_proposed" });
          continue;
        }

        // Deactivate the previous batch (kept for audit), then insert.
        await writer
          .from("domain_rules")
          .update({ active: false })
          .eq("domain", domain)
          .eq("active", true);

        const { error: insErr } = await writer
          .from("domain_rules")
          .insert(rules.map((r) => ({
            domain,
            rule: r.rule.slice(0, 280),
            confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0.5)),
            source_count: Math.max(1, Math.floor(Number(r.source_count) || 1)),
            active: true,
          })));
        if (insErr) {
          console.error(`distill ${domain}: insert failed`, insErr.message);
          results.push({ domain, created: 0, skipped: "insert_failed" });
          continue;
        }
        results.push({ domain, created: rules.length });
      } catch (e) {
        console.error(`distill ${domain}: unexpected`, e);
        results.push({ domain, created: 0, skipped: "exception" });
      }
    }
  };

  // { async: true }: answer at once and distil in the background. A slow
  // model (CPU-only local Ollama) takes many minutes per domain, far beyond
  // the API gateway's 150 s request timeout, and the admin page would
  // report a failure while the rules were still being written.
  const waitUntil = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
    .EdgeRuntime?.waitUntil;
  if (body.async && waitUntil) {
    waitUntil(distillAll().then(
      () => console.log(JSON.stringify({ step: "distill_done", results })),
      (e) => console.error("distill background run failed", e),
    ));
    return new Response(JSON.stringify({ started: true, domains: targets.length }), {
      status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  await distillAll();

  return new Response(JSON.stringify({ results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
