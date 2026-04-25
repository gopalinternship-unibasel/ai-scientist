import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface RateLimitInfo {
  limit: number;
  used: number;
  remaining: number;
  authenticated: boolean;
}

const URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/run-experiment`;

/**
 * Lightweight quota probe. Hits the GET endpoint of `run-experiment` which
 * returns the current per-identifier usage *without* consuming a slot.
 */
export function useRateLimit(refreshKey: unknown = 0) {
  const [info, setInfo] = useState<RateLimitInfo | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const bearer = session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const resp = await fetch(URL, {
        method: "GET",
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${bearer}`,
        },
      });
      if (!resp.ok) { setInfo(null); return; }
      const j = (await resp.json()) as RateLimitInfo;
      setInfo(j);
    } catch {
      setInfo(null);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh, refreshKey]);

  return { info, refresh };
}
