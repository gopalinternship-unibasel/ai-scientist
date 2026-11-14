// embed-feedback — called by the client after a plan_feedback row is inserted.
// Reads the new row, embeds the correction text, writes the vector back.
//
// Doing this server-side keeps the embedding model + provider API key off the
// browser and ensures every feedback row ends up in the same vector space as
// what the planner queries against.
//
// Auth (the function is deployed with verify_jwt = false so anonymous owners
// can call it): the caller must own the row — the signed-in user in
// owner_user_id, or, for a row no account owns, the browser's anonymous
// owner token sent as `owner_token` in the body — or be a moderator/admin or
// the service role. Anyone else gets 403 (QA, 9 Nov 2026: an anonymous
// caller could trigger embedding work on another user's feedback).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.104.1";
import { corsHeaders } from "../_shared/cors.ts";
import { serviceKey } from "../_shared/supabaseKeys.ts";
import { embedText, embeddingsEnabled } from "../_shared/embeddings.ts";
import { constantTimeEqual, identifyCaller } from "../_shared/callerAuth.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

interface FeedbackRow {
  id: string;
  section: string;
  domain: string | null;
  correction: string | null;
  hypothesis_excerpt: string | null;
  embedding: unknown;
  embedding_attempts: number | null;
  owner_user_id: string | null;
  owner_token: string | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  let body: { feedback_id?: unknown; owner_token?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Request body must be a JSON object." }, 400);
  }
  try {
    const { feedback_id } = body ?? {};
    if (!feedback_id || typeof feedback_id !== "string" || !/^[0-9a-f-]{36}$/i.test(feedback_id)) {
      return json({ error: "feedback_id required" }, 400);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = serviceKey();
    const caller = await identifyCaller(req);
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data, error: selErr } = await supabase
      .from("plan_feedback")
      .select("id, section, domain, correction, hypothesis_excerpt, embedding, embedding_attempts, owner_user_id, owner_token")
      .eq("id", feedback_id)
      .maybeSingle();
    const row = data as FeedbackRow | null;

    const ownerToken = typeof body.owner_token === "string" ? body.owner_token : "";
    const allowed = !!row && (
      caller.isModerator
      || (caller.userId !== null && row.owner_user_id === caller.userId)
      || (row.owner_user_id === null && !!row.owner_token && !!ownerToken && constantTimeEqual(ownerToken, row.owner_token))
    );
    if (!allowed) {
      // Same answer for "not yours" and "does not exist" (no id oracle),
      // except for privileged callers.
      if (caller.isModerator && (selErr || !row)) return json({ error: "feedback not found" }, 404);
      return json({ error: "forbidden" }, 403);
    }
    if (!embeddingsEnabled()) {
      return json({ error: "Embeddings not configured (set AI_EMBED_MODEL)" }, 503);
    }
    if (row.embedding) {
      // Already embedded — idempotent no-op.
      return json({ ok: true, skipped: true });
    }
    // Always bump attempts first, even if embedding succeeds — gives us a
    // permanent audit trail of how many tries it took. Pairs with the daily
    // cron that re-tries any rows still pending.
    await supabase
      .from("plan_feedback")
      .update({ embedding_attempts: (row.embedding_attempts ?? 0) + 1 })
      .eq("id", feedback_id);

    // Embed the combined correction + hypothesis context so retrieval matches
    // both "what's the lesson" and "what kind of experiment was it".
    const text = [row.correction, row.hypothesis_excerpt].filter(Boolean).join("\n\n");
    const vec = await embedText(text);
    if (!vec) {
      // Permanent failure (after embedText's internal 3 retries). The row
      // stays embedding=null and the daily cron will pick it up.
      return json({ ok: false, error: "embedding failed" }, 502);
    }
    // PostgREST hands the JSON array to pgvector as "[x, y, ...]".
    const { error: updErr } = await supabase
      .from("plan_feedback")
      .update({ embedding: vec, embedded_at: new Date().toISOString() })
      .eq("id", feedback_id);
    if (updErr) {
      return json({ ok: false, error: updErr.message }, 500);
    }

    // Dedup pass: now that the row has an embedding, look for an existing
    // near-identical correction in the same section/domain. If we find one,
    // bump its dup_count and delete this row — keeps the corpus clean and
    // turns repeat reports into a consensus signal at retrieval time.
    try {
      const { data: dupId } = await supabase.rpc("find_duplicate_feedback", {
        _id: row.id,
        _section: row.section,
        _domain: row.domain,
        _embedding: vec,
        _threshold: 0.92,
      });
      if (dupId && typeof dupId === "string") {
        // dup_count is a consensus signal (it raises the row's retrieval
        // score), so the same person repeating a correction does not count:
        // the repeat is dropped without bumping its earlier row.
        const { data: dup } = await supabase
          .from("plan_feedback")
          .select("owner_user_id, owner_token")
          .eq("id", dupId)
          .maybeSingle();
        const sameOwner = !!dup && (
          (row.owner_user_id !== null && dup.owner_user_id === row.owner_user_id)
          || (row.owner_user_id === null && !!row.owner_token && dup.owner_token === row.owner_token)
        );
        if (!sameOwner) await supabase.rpc("bump_feedback_dup", { _id: dupId });
        await supabase.from("plan_feedback").delete().eq("id", row.id);
        return json({ ok: true, deduped_into: dupId, counted: !sameOwner });
      }
    } catch (e) {
      console.warn("dedup check failed (non-fatal):", e);
    }

    return json({ ok: true });
  } catch (e) {
    console.error("embed-feedback error", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
