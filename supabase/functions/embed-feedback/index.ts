// embed-feedback — called by the client after a plan_feedback row is inserted.
// Reads the new row, embeds the correction text, writes the vector back.
//
// Doing this server-side keeps the embedding model + Lovable API key off the
// browser and ensures every feedback row ends up in the same vector space as
// what the planner queries against.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import { embedText } from "../_shared/embeddings.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { feedback_id } = await req.json();
    if (!feedback_id || typeof feedback_id !== "string") {
      return new Response(JSON.stringify({ error: "feedback_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI key not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: row, error: selErr } = await supabase
      .from("plan_feedback")
      .select("id, correction, hypothesis_excerpt, embedding")
      .eq("id", feedback_id)
      .maybeSingle();
    if (selErr || !row) {
      return new Response(JSON.stringify({ error: "feedback not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (row.embedding) {
      // Already embedded — idempotent no-op.
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Embed the combined correction + hypothesis context so retrieval matches
    // both "what's the lesson" and "what kind of experiment was it".
    const text = [row.correction, row.hypothesis_excerpt].filter(Boolean).join("\n\n");
    const vec = await embedText(text, LOVABLE_API_KEY);
    if (!vec) {
      return new Response(JSON.stringify({ ok: false, error: "embedding failed" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { error: updErr } = await supabase
      .from("plan_feedback")
      // deno-lint-ignore no-explicit-any
      .update({ embedding: vec as any })
      .eq("id", feedback_id);
    if (updErr) {
      return new Response(JSON.stringify({ ok: false, error: updErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("embed-feedback error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
