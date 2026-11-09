// /my-feedback — the user's full correction history across all runs.
//
// Surfaces the edit/delete affordance that previously was only reachable by
// re-opening each individual run. Owners (auth or anonymous) see only their
// own rows thanks to RLS.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, Loader2, Pencil, Trash2, Check, X, Star, MessageSquareText,
  ExternalLink, Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { createScopedClient } from "@/lib/supabaseScoped";
import { useAuth } from "@/hooks/useAuth";
import { Logo } from "@/components/Logo";
import { UserMenu } from "@/components/UserMenu";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { getOwnerToken } from "@/lib/owner";
import { validateCorrection } from "@/lib/domainNormalize";
import { replayWithLesson } from "@/lib/replayWithLesson";
import { useNavigate } from "react-router-dom";

interface FeedbackRow {
  id: string;
  run_id: string;
  section: string;
  rating: number | null;
  correction: string | null;
  domain: string | null;
  created_at: string;
  hidden: boolean;
  // joined
  hypothesis?: string | null;
}

const MyFeedback = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<FeedbackRow[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editRating, setEditRating] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [replayingId, setReplayingId] = useState<string | null>(null);

  // Signed-in users are matched by auth.uid(); anonymous owners by the
  // x-owner-token request header, which only the scoped client sends (the
  // plain client made every anonymous read/edit/delete fail RLS).
  const db = useMemo(() => (user ? supabase : createScopedClient()), [user]);

  const load = async () => {
    // RLS already restricts to owner; the explicit filter is a small
    // belt-and-braces optimisation.
    const ownerToken = getOwnerToken();
    let q = db
      .from("plan_feedback")
      .select("id, run_id, section, rating, correction, domain, created_at, hidden, runs(hypothesis)")
      .order("created_at", { ascending: false })
      .limit(200);
    q = user
      ? q.eq("owner_user_id", user.id)
      : q.eq("owner_token", ownerToken);
    const { data, error } = await q;
    if (error) {
      console.error("load my-feedback failed", error);
      toast.error("Could not load your feedback.");
      setRows([]);
      return;
    }
    setRows(
      (data ?? []).map((r) => {
        const joined = (r as { runs?: { hypothesis?: string } | null }).runs;
        return { ...r, hypothesis: joined?.hypothesis ?? null } as FeedbackRow;
      }),
    );
  };

  useEffect(() => {
    if (authLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id]);

  const startEdit = (row: FeedbackRow) => {
    setEditingId(row.id);
    setEditText(row.correction ?? "");
    setEditRating(row.rating);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditText("");
    setEditRating(null);
  };
  const saveEdit = async (row: FeedbackRow) => {
    const trimmed = editText.trim();
    if (editRating == null && !trimmed) {
      toast.error("Add a rating or some text.");
      return;
    }
    if (trimmed) {
      const reason = validateCorrection(trimmed);
      if (reason) { toast.error(reason); return; }
    }
    setSaving(true);
    try {
      const { error } = await db
        .from("plan_feedback")
        .update({
          rating: editRating,
          correction: trimmed || null,
          // Force a re-embed since the text changed.
          embedding: null,
        })
        .eq("id", row.id);
      if (error) throw error;
      if (trimmed) {
        // embed-feedback checks ownership: the JWT, or the anonymous owner token.
        supabase.functions.invoke("embed-feedback", {
          body: user ? { feedback_id: row.id } : { feedback_id: row.id, owner_token: getOwnerToken() },
        })
          .catch((e) => console.warn("embed-feedback invoke failed", e));
      }
      toast.success("Updated.");
      setRows((prev) =>
        prev?.map((r) =>
          r.id === row.id ? { ...r, rating: editRating, correction: trimmed || null } : r,
        ) ?? null,
      );
      cancelEdit();
    } catch (e) {
      console.error(e);
      toast.error("Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: FeedbackRow) => {
    if (!confirm("Delete this feedback? It will no longer be used to guide future plans.")) return;
    const { error } = await db.from("plan_feedback").delete().eq("id", row.id);
    if (error) {
      toast.error("Could not delete.");
      return;
    }
    setRows((prev) => prev?.filter((r) => r.id !== row.id) ?? null);
    toast.success("Deleted.");
  };

  const startReplay = (row: FeedbackRow) => {
    if (!row.correction || !row.hypothesis) {
      toast.error("Need both a hypothesis and correction text to replay.");
      return;
    }
    setReplayingId(row.id);
    replayWithLesson({
      parentRunId: row.run_id,
      hypothesis: row.hypothesis,
      section: row.section,
      correction: row.correction,
      onCreated: (newId) => {
        toast.success("Re-running with this lesson…");
        navigate(`/runs/${newId}`);
      },
      onSettled: () => setReplayingId(null),
    });
  };

  // Group by run for readability.
  const grouped = useMemo(() => {
    if (!rows) return null;
    const byRun = new Map<string, FeedbackRow[]>();
    for (const r of rows) {
      const arr = byRun.get(r.run_id) ?? [];
      arr.push(r);
      byRun.set(r.run_id, arr);
    }
    return Array.from(byRun.entries()).sort(
      ([, a], [, b]) =>
        new Date(b[0].created_at).getTime() - new Date(a[0].created_at).getTime(),
    );
  }, [rows]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-rule bg-background/85 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <Logo />
          <div className="flex items-center gap-2">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="h-3.5 w-3.5" /> Home
              </Button>
            </Link>
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="container max-w-4xl py-8 md:py-12">
        <div className="mb-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            Library
          </div>
          <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight text-foreground">
            My feedback
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Every correction you've left. These actively shape future plans for similar experiments — edit or delete any time.
          </p>
        </div>

        {rows === null && (
          <div className="paper-surface rounded-lg p-8 text-center text-muted-foreground">
            <Loader2 className="mx-auto h-5 w-5 animate-spin" />
          </div>
        )}

        {rows && rows.length === 0 && (
          <div className="paper-surface rounded-lg p-12 text-center">
            <MessageSquareText className="mx-auto h-8 w-8 text-muted-foreground" />
            <h2 className="mt-4 font-serif text-xl text-foreground">No feedback yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Open any plan and use the small feedback button next to a section to leave your first correction.
            </p>
          </div>
        )}

        {grouped && grouped.length > 0 && (
          <div className="space-y-6">
            {grouped.map(([runId, items]) => (
              <section key={runId} className="paper-surface rounded-lg p-5">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Run · {new Date(items[0].created_at).toLocaleDateString()}
                    </div>
                    <p className="mt-1 line-clamp-2 font-serif text-[15px] text-foreground">
                      {items[0].hypothesis ?? <span className="italic text-muted-foreground">(hypothesis unavailable)</span>}
                    </p>
                  </div>
                  <Link to={`/runs/${runId}`}>
                    <Button variant="ghost" size="sm" className="gap-1.5 shrink-0">
                      <ExternalLink className="h-3 w-3" /> View
                    </Button>
                  </Link>
                </div>

                <ul className="divide-y divide-rule">
                  {items.map((row) => (
                    <li key={row.id} className="py-3">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <Badge variant="outline" className="capitalize">{row.section}</Badge>
                        {row.domain && <Badge variant="outline">{row.domain}</Badge>}
                        {row.rating != null && (
                          <span className="inline-flex items-center gap-0.5">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <Star
                                key={n}
                                className={`h-3 w-3 ${
                                  n <= row.rating!
                                    ? "fill-primary text-primary"
                                    : "text-muted-foreground/40"
                                }`}
                              />
                            ))}
                          </span>
                        )}
                        {row.hidden && (
                          <Badge variant="destructive" className="text-[9px]">hidden by mod</Badge>
                        )}
                        <span className="ml-auto">{new Date(row.created_at).toLocaleString()}</span>
                      </div>

                      {editingId === row.id ? (
                        <div className="mt-2 space-y-2">
                          <div className="flex items-center gap-1">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <button
                                key={n}
                                type="button"
                                onClick={() => setEditRating(n)}
                                className="rounded p-0.5 transition-colors hover:bg-muted"
                                aria-label={`Rate ${n} of 5`}
                              >
                                <Star
                                  className={`h-4 w-4 ${
                                    editRating != null && n <= editRating
                                      ? "fill-primary text-primary"
                                      : "text-muted-foreground"
                                  }`}
                                />
                              </button>
                            ))}
                            {editRating != null && (
                              <button
                                type="button"
                                onClick={() => setEditRating(null)}
                                className="ml-1 text-[10px] text-muted-foreground underline-offset-2 hover:underline"
                              >
                                clear
                              </button>
                            )}
                          </div>
                          <Textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            rows={3}
                            maxLength={2000}
                            className="text-sm"
                          />
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={cancelEdit} className="gap-1">
                              <X className="h-3 w-3" /> Cancel
                            </Button>
                            <Button size="sm" onClick={() => saveEdit(row)} disabled={saving} className="gap-1">
                              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                              Save
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {row.correction ? (
                            <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-foreground/90">
                              {row.correction}
                            </p>
                          ) : (
                            <p className="mt-1.5 text-sm italic text-muted-foreground">
                              (rating only — no text)
                            </p>
                          )}
                          <div className="mt-2 flex justify-end gap-1">
                            {row.correction && row.hypothesis && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1 text-accent hover:text-accent"
                                onClick={() => startReplay(row)}
                                disabled={replayingId === row.id}
                              >
                                {replayingId === row.id
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : <Sparkles className="h-3 w-3" />}
                                Re-run
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1"
                              onClick={() => startEdit(row)}
                            >
                              <Pencil className="h-3 w-3" /> Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 text-destructive hover:text-destructive"
                              onClick={() => remove(row)}
                            >
                              <Trash2 className="h-3 w-3" /> Delete
                            </Button>
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default MyFeedback;
