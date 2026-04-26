// /admin — Moderator dashboard. Shows aggregate health metrics for the
// learning loop and a queue of recent feedback rows that can be hidden.
//
// Access is gated TWICE:
//   1) Server-side: feedback_loop_stats() and recent_feedback_for_moderation()
//      both raise / return nothing unless the caller has role 'moderator' or
//      'admin' (see has_role).
//   2) Client-side: we check the same role on mount and redirect non-mods to /.
// The client check is cosmetic; the server check is the actual security
// boundary.
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Loader2, EyeOff, Eye, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

interface SectionStat { count: number; avg_rating: number | null }
interface Stats {
  feedback: {
    total: number; embedded: number; pending: number; hidden_count: number;
    avg_rating: number | null; dedup_hits: number;
  };
  by_section: Record<string, SectionStat> | null;
  by_domain: Record<string, number> | null;
  runs: { total_done: number; with_lessons: number };
  impact: {
    avg_with: number | null; avg_without: number | null;
    n_with: number; n_without: number;
  };
}

interface ModRow {
  id: string; run_id: string; section: string; rating: number | null;
  correction: string | null; domain: string | null; hidden: boolean;
  dup_count: number; created_at: string;
}

const Admin = () => {
  const { user, loading: authLoading } = useAuth();
  const [isMod, setIsMod] = useState<boolean | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [rows, setRows] = useState<ModRow[]>([]);
  const [loadingStats, setLoadingStats] = useState(false);

  // Role check (client-side; server enforces the same)
  useEffect(() => {
    if (authLoading) return;
    if (!user) { setIsMod(false); return; }
    (async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      if (error) { setIsMod(false); return; }
      const has = (data ?? []).some((r) => r.role === "moderator" || r.role === "admin");
      setIsMod(has);
    })();
  }, [user, authLoading]);

  const loadStats = async () => {
    setLoadingStats(true);
    try {
      const [{ data: s, error: e1 }, { data: r, error: e2 }] = await Promise.all([
        supabase.rpc("feedback_loop_stats"),
        supabase.rpc("recent_feedback_for_moderation", { _limit: 100 }),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      setStats(s as unknown as Stats);
      setRows((r as unknown as ModRow[]) ?? []);
    } catch (e) {
      console.error("admin load failed", e);
      toast.error("Could not load dashboard");
    } finally {
      setLoadingStats(false);
    }
  };

  useEffect(() => { if (isMod) loadStats(); }, [isMod]);

  const toggleHidden = async (row: ModRow) => {
    const next = !row.hidden;
    const { error } = await supabase
      .from("plan_feedback")
      .update({ hidden: next })
      .eq("id", row.id);
    if (error) {
      toast.error("Could not update");
      return;
    }
    setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, hidden: next } : r));
    toast.success(next ? "Hidden from retrieval" : "Restored");
  };

  const sectionEntries = useMemo(() => {
    if (!stats?.by_section) return [];
    return Object.entries(stats.by_section).sort(([, a], [, b]) => (b.count - a.count));
  }, [stats]);

  const domainEntries = useMemo(() => {
    if (!stats?.by_domain) return [];
    return Object.entries(stats.by_domain).sort(([, a], [, b]) => b - a);
  }, [stats]);

  if (authLoading || isMod === null) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (!user) return <Navigate to="/auth" replace />;
  if (!isMod) {
    return (
      <div className="mx-auto max-w-2xl p-8 text-center">
        <h1 className="text-2xl font-semibold">Access required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The moderation dashboard is only available to users with the moderator or admin role.
        </p>
        <Button asChild variant="outline" className="mt-6">
          <Link to="/"><ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back home</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="inline-flex items-center gap-2"><Logo /></Link>
          <Badge variant="outline" className="font-mono text-[10px]">Moderator</Badge>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <div>
          <h1 className="text-2xl font-semibold">Learning loop dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Health of the cross-run feedback corpus.
          </p>
        </div>

        <Tabs defaultValue="stats">
          <TabsList>
            <TabsTrigger value="stats">Stats</TabsTrigger>
            <TabsTrigger value="moderate">Moderate ({rows.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="stats" className="space-y-6 pt-4">
            {loadingStats || !stats ? (
              <div className="flex justify-center py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : (
              <>
                {/* Headline impact metric — does the loop actually work? */}
                <Card className="border-primary/30">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Impact: does applied feedback lift ratings?</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <div className="text-xs uppercase tracking-wider text-muted-foreground">With lessons applied</div>
                        <div className="mt-1 text-3xl font-semibold tabular-nums">
                          {stats.impact.avg_with?.toFixed(2) ?? "—"}
                          <span className="ml-1 text-base font-normal text-muted-foreground">/ 5</span>
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">n = {stats.impact.n_with}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wider text-muted-foreground">Without lessons</div>
                        <div className="mt-1 text-3xl font-semibold tabular-nums">
                          {stats.impact.avg_without?.toFixed(2) ?? "—"}
                          <span className="ml-1 text-base font-normal text-muted-foreground">/ 5</span>
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">n = {stats.impact.n_without}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Stat label="Total feedback" value={stats.feedback.total} />
                  <Stat
                    label="Embedded"
                    value={`${stats.feedback.embedded} / ${stats.feedback.total}`}
                    sub={stats.feedback.pending > 0 ? `${stats.feedback.pending} pending` : "all caught up"}
                  />
                  <Stat label="Hidden" value={stats.feedback.hidden_count} />
                  <Stat label="Dedup hits" value={stats.feedback.dedup_hits} sub="repeat corrections merged" />
                  <Stat label="Avg rating" value={stats.feedback.avg_rating?.toFixed(2) ?? "—"} />
                  <Stat label="Runs done" value={stats.runs.total_done} />
                  <Stat
                    label="Runs with lessons"
                    value={stats.runs.with_lessons}
                    sub={stats.runs.total_done > 0 ? `${Math.round(100 * stats.runs.with_lessons / stats.runs.total_done)}%` : ""}
                  />
                  <Stat
                    label="Embedding coverage"
                    value={stats.feedback.total > 0
                      ? `${Math.round(100 * stats.feedback.embedded / stats.feedback.total)}%`
                      : "—"}
                  />
                </div>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <Card>
                    <CardHeader className="pb-3"><CardTitle className="text-base">By section</CardTitle></CardHeader>
                    <CardContent>
                      {sectionEntries.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No data yet.</div>
                      ) : (
                        <ul className="divide-y divide-border">
                          {sectionEntries.map(([s, info]) => (
                            <li key={s} className="flex items-center justify-between py-2 text-sm">
                              <span className="capitalize">{s}</span>
                              <span className="font-mono text-xs text-muted-foreground">
                                {info.count} · ★ {info.avg_rating?.toFixed(2) ?? "—"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3"><CardTitle className="text-base">By domain</CardTitle></CardHeader>
                    <CardContent>
                      {domainEntries.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No data yet.</div>
                      ) : (
                        <ul className="divide-y divide-border">
                          {domainEntries.map(([d, n]) => (
                            <li key={d} className="flex items-center justify-between py-2 text-sm">
                              <span>{d}</span>
                              <span className="font-mono text-xs text-muted-foreground">{n}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="moderate" className="space-y-3 pt-4">
            {rows.length === 0 ? (
              <div className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">
                No feedback to review.
              </div>
            ) : rows.map((row) => (
              <Card key={row.id} className={row.hidden ? "opacity-60" : ""}>
                <CardContent className="flex items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <Badge variant="outline" className="capitalize">{row.section}</Badge>
                      {row.domain && <Badge variant="outline">{row.domain}</Badge>}
                      {row.rating != null && <span>★ {row.rating}</span>}
                      {row.dup_count > 1 && <span>×{row.dup_count} reports</span>}
                      <span>{new Date(row.created_at).toLocaleString()}</span>
                      <Link to={`/runs/${row.run_id}`} className="underline hover:text-foreground">view run</Link>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap break-words text-sm">
                      {row.correction ?? <span className="italic text-muted-foreground">(rating only — no text)</span>}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleHidden(row)}
                    className="shrink-0 gap-1.5"
                  >
                    {row.hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    {row.hidden ? "Restore" : "Hide"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

interface StatProps { label: string; value: string | number; sub?: string }
const Stat = ({ label, value, sub }: StatProps) => (
  <Card>
    <CardContent className="py-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </CardContent>
  </Card>
);

export default Admin;
