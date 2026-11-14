// backfill-feedback-embeddings — one-shot (or periodically called) batch
// embedding job for plan_feedback rows where embedding is NULL.
//
// Safe to call repeatedly. Returns counts. Limit is bounded per call to keep
// latency predictable; the caller can loop.
//
// Auth: service role (scheduled jobs, the operator) or a moderator/admin.
// It used to have none, so anyone with the public anon key could make it
// spend embedding-model time (QA, 9 Nov 2026).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.104.1";
import { corsHeaders } from "../_shared/cors.ts";
import { serviceKey } from "../_shared/supabaseKeys.ts";
import { embedText, embeddingsEnabled } from "../_shared/embeddings.ts";
import { identifyCaller } from "../_shared/callerAuth.ts";

const DEFAULT_BATCH = 25;
const MAX_BATCH = 100;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const caller = await identifyCaller(req);
    if (!caller.isModerator) {
      return new Response(JSON.stringify({ error: caller.kind === "anon" ? "auth required" : "forbidden" }), {
        status: caller.kind === "anon" ? 401 : 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const url = new URL(req.url);
    const limitParam = Number(url.searchParams.get("limit") ?? DEFAULT_BATCH);
    const limit = Math.max(1, Math.min(MAX_BATCH, isFinite(limitParam) ? limitParam : DEFAULT_BATCH));

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = serviceKey();
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
        .update({ embedding_attempts: (row.embedding_attempts ?? 0) + 1 })
        .eq("id", row.id);

      const text = [row.correction, row.hypothesis_excerpt].filter(Boolean).join("\n\n");
      const vec = await embedText(text);
      if (!vec) { failed++; continue; }
      const { error: updErr } = await supabase
        .from("plan_feedback")
        .update({ embedding: vec, embedded_at: new Date().toISOString() })
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
