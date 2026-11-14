// Tracks in-flight runs across the session so users get pinged when a run
// they navigated away from finishes. Subscribes to realtime UPDATEs on the
// runs table and fires a sonner toast on terminal status transitions.
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { appPathname } from "@/lib/appUrl";

const STORAGE_KEY = "ai-scientist:tracking-runs";

interface TrackedRun {
  id: string;
  hypothesis: string;
}

function readTracked(): Record<string, TrackedRun> {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writeTracked(map: Record<string, TrackedRun>) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch { /* noop */ }
}

/** Mark a run as in-flight so we toast when it completes elsewhere. */
export function trackRun(run: TrackedRun) {
  const map = readTracked();
  map[run.id] = run;
  writeTracked(map);
}

/** Stop tracking a run (e.g. user is currently looking at it). */
export function untrackRun(id: string) {
  const map = readTracked();
  delete map[id];
  writeTracked(map);
}

/**
 * Mounts once at the app root. Subscribes to realtime UPDATEs and shows a
 * toast when any tracked run reaches a terminal status. Clicking the toast
 * navigates to the run detail page.
 */
export function useBackgroundRunNotifier() {
  const navigate = useNavigate();

  useEffect(() => {
    const channel = supabase
      .channel("runs:background")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "runs" },
        (payload) => {
          const row = payload.new as { id?: string; status?: string; error?: string | null };
          if (!row?.id || !row.status) return;
          if (row.status !== "done" && row.status !== "failed") return;

          const map = readTracked();
          const tracked = map[row.id];
          if (!tracked) return;

          // Don't toast if the user is already on the run page.
          if (appPathname() === `/runs/${row.id}`) {
            untrackRun(row.id);
            return;
          }

          const label = tracked.hypothesis.length > 80
            ? tracked.hypothesis.slice(0, 77) + "…"
            : tracked.hypothesis;

          if (row.status === "done") {
            toast.success("Experiment plan ready", {
              description: label,
              action: { label: "View", onClick: () => navigate(`/runs/${row.id}`) },
              duration: 10_000,
            });
          } else {
            toast.error("Experiment failed", {
              description: row.error ?? label,
              action: { label: "View", onClick: () => navigate(`/runs/${row.id}`) },
              duration: 10_000,
            });
          }
          untrackRun(row.id);
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [navigate]);
}
