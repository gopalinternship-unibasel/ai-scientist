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
 * The default `supabase` client is fine for authenticated user contexts.
 */
export function createScopedClient(opts?: { shareToken?: string | null }) {
  const headers: Record<string, string> = {
    "x-owner-token": getOwnerToken(),
  };
  if (opts?.shareToken) headers["x-share-token"] = opts.shareToken;

  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers },
  });
}

export { supabase };
