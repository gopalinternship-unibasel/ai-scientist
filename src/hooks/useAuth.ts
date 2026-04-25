import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getOwnerToken } from "@/lib/owner";

/**
 * Auth state with anonymous-run claim:
 * On sign-in we associate any runs the user created anonymously (matched by
 * the browser-stored owner_token) with their new auth.uid() so they show up
 * under "My experiments".
 */
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Set up the auth listener FIRST to avoid missing events fired during getSession().
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setUser(s?.user ?? null);

      if (event === "SIGNED_IN" && s?.user) {
        // Defer DB call so we don't block the auth state update.
        setTimeout(() => claimAnonymousRuns(), 0);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return { session, user, loading, signOut };
}

async function claimAnonymousRuns() {
  try {
    const token = getOwnerToken();
    // deno-lint-ignore no-explicit-any
    const { data, error } = await (supabase.rpc as any)("claim_anonymous_runs", {
      _owner_token: token,
    });
    if (error) {
      console.warn("claim_anonymous_runs failed:", error.message);
      return;
    }
    const count = typeof data === "number" ? data : 0;
    if (count > 0) {
      toast.success(
        count === 1
          ? "Linked 1 previous experiment to your account."
          : `Linked ${count} previous experiments to your account.`,
      );
    }
  } catch (e) {
    console.warn("claim_anonymous_runs error", e);
  }
}
