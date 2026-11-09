// Re-export the auto-generated client and provide a helper that injects the
// browser's anonymous owner_token + (optional) share_token into every request.
// The DB RLS policies on `runs` read these from request headers to authorize
// anonymous owners and shared-link viewers.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { getOwnerToken } from "./owner";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/**
 * A second supabase client that automatically attaches the browser's
 * `x-owner-token` (and optional `x-share-token`) header on every request.
 *
 * Use this for reading `runs` rows from anonymous or shared-link contexts.
 * The default `supabase` client is fine for a signed-in user's own rows.
 *
 * `asSignedInUser`: also send the signed-in user's JWT (taken from the main
 * client's session on every request, so refreshed tokens are picked up).
 * A signed-in user who opens someone else's share link needs both: the
 * share-token policy on `runs` reads the header, and the JWT keeps the
 * user's own access. Before this, signed-in viewers got the plain client,
 * the x-share-token header was never sent and the page said "Run not found"
 * (QA round 2, 9 Nov 2026).
 */
export function createScopedClient(opts?: { shareToken?: string | null; asSignedInUser?: boolean }) {
  const headers: Record<string, string> = {
    "x-owner-token": getOwnerToken(),
  };
  if (opts?.shareToken) headers["x-share-token"] = opts.shareToken;

  if (opts?.asSignedInUser) {
    return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      // With accessToken the client has no auth module of its own (no second
      // GoTrue instance); null falls back to the anon key.
      accessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
      global: { headers },
    });
  }
  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers },
  });
}

export { supabase };
