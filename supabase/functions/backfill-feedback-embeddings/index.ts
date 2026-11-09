// backfill-feedback-embeddings — one-shot (or periodically called) batch
// embedding job for plan_feedback rows where embedding is NULL.
//
// Safe to call repeatedly. Returns counts. No auth — read-only of public
// columns + service-role write of the embedding vector. Limit is bounded
// per call to keep latency predictable; the caller can loop.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import { embedText, embeddingsEnabled } from "../_shared/embeddings.ts";

const DEFAULT_BATCH = 25;
const MAX_BATCH = 100;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const limitParam = Number(url.searchParams.get("limit") ?? DEFAULT_BATCH);
    const limit = Math.max(1, Math.min(MAX_BATCH, isFinite(limitParam) ? limitParam : DEFAULT_BATCH));

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!embeddingsEnabled()) {
      return new Response(JSON.stringify({ error: "Embeddings not configured (set AI_EMBED_MODEL)" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Dead-letter policy: skip rows we've already tried 5+ times. Those are
    // either bad input (e.g. correction got truncated to nothing useful) or
    // a persistent gateway problem — keeping them in the queue would waste
    // budget on every cron tick.
    const { data: rows, error } = await supabase
      .from("plan_feedback")
      .select("id, correction, hypothesis_excerpt, embedding_attempts")
      .is("embedding", null)
      .not("correction", "is", null)
      .lt("embedding_attempts", 5)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ ok: true, processed: 0, remaining: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let ok = 0, failed = 0;
    for (const row of rows) {
      // Always bump attempts so dead rows stop coming back even if the
      // embed call throws unexpectedly mid-loop.
      await supabase
        .from("plan_feedback")
        // deno-lint-ignore no-explicit-any
        .update({ embedding_attempts: ((row as any).embedding_attempts ?? 0) + 1 } as any)
        .eq("id", row.id);

      const text = [row.correction, row.hypothesis_excerpt].filter(Boolean).join("\n\n");
      const vec = await embedText(text);
      if (!vec) { failed++; continue; }
      const { error: updErr } = await supabase
        .from("plan_feedback")
        // deno-lint-ignore no-explicit-any
        .update({ embedding: vec as any, embedded_at: new Date().toISOString() } as any)
        .eq("id", row.id);
      if (updErr) { failed++; continue; }
      ok++;
    }

    // Quick remaining count so the caller knows whether to loop.
    const { count: remaining } = await supabase
      .from("plan_feedback")
      .select("id", { count: "exact", head: true })
      .is("embedding", null)
      .not("correction", "is", null);

    return new Response(JSON.stringify({
      ok: true, processed: ok, failed, remaining: remaining ?? null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("backfill-feedback-embeddings error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
