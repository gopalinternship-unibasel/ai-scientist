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
import { Loader2, EyeOff, Eye, ArrowLeft, Sparkles, Gauge, Power, AlertTriangle, Save, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { UpliftPanel } from "@/components/admin/UpliftPanel";

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
    return <BootstrapAdminPanel onPromoted={() => setIsMod(true)} />;
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
            <TabsTrigger value="uplift">Uplift</TabsTrigger>
            <TabsTrigger value="rules">House rules</TabsTrigger>
            <TabsTrigger value="loop">Loop ops</TabsTrigger>
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

          <TabsContent value="uplift" className="space-y-4 pt-4">
            <UpliftPanel />
          </TabsContent>

          <TabsContent value="rules" className="space-y-4 pt-4">
            <HouseRulesPanel />
          </TabsContent>

          <TabsContent value="loop" className="space-y-4 pt-4">
            <LoopOpsPanel />
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

// Loop ops: trigger distillation + eval harness, view recent eval batches.
interface EvalSummaryRow {
  batch_id: string; ts: string;
  avg_with: number; avg_without: number;
  n_with: number; n_without: number;
}
const LoopOpsPanel = () => {
  const [distilling, setDistilling] = useState(false);
  const [evaling, setEvaling] = useState(false);
  const [summary, setSummary] = useState<EvalSummaryRow[] | null>(null);

  const loadSummary = async () => {
    const { data, error } = await supabase.rpc("eval_summary", { _limit: 8 });
    if (error) { console.warn("eval_summary failed", error); return; }
    setSummary((data as unknown as EvalSummaryRow[]) ?? []);
  };
  useEffect(() => { loadSummary(); }, []);

  const distill = async () => {
    setDistilling(true);
    try {
      const { data, error } = await supabase.functions.invoke("distill-house-rules", { body: {} });
      if (error) throw error;
      const created = (data?.results ?? []).reduce((s: number, r: { created: number }) => s + r.created, 0);
      toast.success(`Distilled ${created} house rules across ${data?.results?.length ?? 0} domains.`);
    } catch (e) {
      console.error(e);
      toast.error("Distillation failed.");
    } finally { setDistilling(false); }
  };

  const runEval = async () => {
    setEvaling(true);
    try {
      const { data, error } = await supabase.functions.invoke("eval-harness", { body: { pilot_size: 4 } });
      if (error) throw error;
      toast.success(`Eval batch complete: ${data?.evaluated ?? 0} hypotheses scored.`);
      await loadSummary();
    } catch (e) {
      console.error(e);
      toast.error("Eval harness failed.");
    } finally { setEvaling(false); }
  };

  return (
    <>
      <EvalAlertBanner summary={summary} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent" /> House rules
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Distill recent corrections into stable per-domain rules. Replaces the previous active batch.
            </p>
            <Button onClick={distill} disabled={distilling} size="sm" className="gap-1.5">
              {distilling && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Run distillation
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Gauge className="h-4 w-4 text-primary" /> Eval harness
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Score the frozen hypothesis suite with vs without the feedback retriever. Pilot mode: 4 hypotheses.
            </p>
            <Button onClick={runEval} disabled={evaling} size="sm" className="gap-1.5">
              {evaling && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Run pilot eval (4 hypotheses)
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Recent eval batches</CardTitle></CardHeader>
        <CardContent>
          {summary === null ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : summary.length === 0 ? (
            <div className="text-sm text-muted-foreground">No eval runs yet.</div>
          ) : (
            <ul className="divide-y divide-border">
              {summary.map((b) => {
                const delta = (b.avg_with ?? 0) - (b.avg_without ?? 0);
                return (
                  <li key={b.batch_id} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">
                      {new Date(b.ts).toLocaleString()}
                    </span>
                    <span className="font-mono text-xs">
                      with {b.avg_with?.toFixed(2) ?? "—"} / without {b.avg_without?.toFixed(2) ?? "—"}
                      <span className={`ml-2 font-semibold ${delta > 0 ? "text-success" : delta < 0 ? "text-destructive" : ""}`}>
                        Δ {delta >= 0 ? "+" : ""}{delta.toFixed(2)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Eval CI gate: surface a prominent banner when the most recent eval batch's
// `with_feedback - without_feedback` delta is negative, or has dropped >0.5
// vs the prior baseline. This is what closes the loop on the loop — every
// prompt change gets graded automatically once the daily cron runs.
const ALERT_DROP_THRESHOLD = 0.5;
const EvalAlertBanner = ({ summary }: { summary: EvalSummaryRow[] | null }) => {
  if (!summary || summary.length === 0) return null;
  const [latest, prior] = summary; // newest-first by RPC contract
  const latestDelta = (latest.avg_with ?? 0) - (latest.avg_without ?? 0);
  const priorDelta = prior ? (prior.avg_with ?? 0) - (prior.avg_without ?? 0) : null;
  const regressed = priorDelta !== null && priorDelta - latestDelta > ALERT_DROP_THRESHOLD;
  const negative = latestDelta < 0;
  if (!regressed && !negative) return null;

  return (
    <Card className="border-destructive/50 bg-destructive/5">
      <CardContent className="flex items-start gap-3 py-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-destructive">
            {negative
              ? "Feedback retriever is HURTING plan quality"
              : "Eval delta dropped sharply"}
          </div>
          <p className="mt-1 text-sm text-foreground/80">
            Latest batch ({new Date(latest.ts).toLocaleString()}):
            with-feedback Δ {latestDelta >= 0 ? "+" : ""}{latestDelta.toFixed(2)}
            {priorDelta !== null && (
              <> · prior batch Δ {priorDelta >= 0 ? "+" : ""}{priorDelta.toFixed(2)}</>
            )}.
            {" "}Investigate recent prompt / retrieval changes before the next deploy.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// House-rules admin: list all rules per domain, toggle active, edit text.
// RLS allows moderators to UPDATE any row in domain_rules.
interface HouseRule {
  id: string; domain: string; rule: string;
  source_count: number; confidence: number; active: boolean; updated_at: string;
}
const HouseRulesPanel = () => {
  const [rules, setRules] = useState<HouseRule[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("domain_rules")
      .select("id,domain,rule,source_count,confidence,active,updated_at")
      .order("domain", { ascending: true })
      .order("active", { ascending: false })
      .order("confidence", { ascending: false });
    if (error) { toast.error("Could not load house rules."); return; }
    setRules((data ?? []) as HouseRule[]);
  };
  useEffect(() => { load(); }, []);

  const toggleActive = async (r: HouseRule) => {
    const next = !r.active;
    const { error } = await supabase
      .from("domain_rules")
      .update({ active: next })
      .eq("id", r.id);
    if (error) { toast.error("Could not update rule."); return; }
    setRules((prev) => (prev ?? []).map((x) => x.id === r.id ? { ...x, active: next } : x));
    toast.success(next ? "Rule activated" : "Rule deactivated");
  };

  const startEdit = (r: HouseRule) => { setEditingId(r.id); setDraftText(r.rule); };
  const cancelEdit = () => { setEditingId(null); setDraftText(""); };
  const saveEdit = async (r: HouseRule) => {
    const trimmed = draftText.trim();
    if (trimmed.length < 10) { toast.error("Rule must be at least 10 characters."); return; }
    if (trimmed.length > 280) { toast.error("Rule must be ≤ 280 characters."); return; }
    setSaving(true);
    const { error } = await supabase
      .from("domain_rules")
      .update({ rule: trimmed })
      .eq("id", r.id);
    setSaving(false);
    if (error) { toast.error("Could not save."); return; }
    setRules((prev) => (prev ?? []).map((x) => x.id === r.id ? { ...x, rule: trimmed } : x));
    cancelEdit();
    toast.success("Rule updated");
  };

  if (rules === null) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }
  if (rules.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No distilled rules yet. Run distillation in the Loop ops tab once you have feedback in a domain.
        </CardContent>
      </Card>
    );
  }

  // Group by domain for display.
  const byDomain = new Map<string, HouseRule[]>();
  for (const r of rules) {
    const arr = byDomain.get(r.domain) ?? [];
    arr.push(r);
    byDomain.set(r.domain, arr);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Distilled per-domain conventions injected into every plan prompt for the matching domain.
        Toggle off anything that's gone stale; edit text to refine. Inactive rules are kept for audit.
      </p>
      {Array.from(byDomain.entries()).map(([domain, items]) => (
        <Card key={domain}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base capitalize">{domain.replace(/-/g, " ")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {items.map((r) => (
              <div
                key={r.id}
                className={`rounded-md border p-3 ${r.active ? "border-border bg-paper" : "border-dashed border-border opacity-60"}`}
              >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <Badge variant={r.active ? "default" : "outline"} className="font-mono text-[9px]">
                      {r.active ? "active" : "inactive"}
                    </Badge>
                    <span>n={r.source_count} · conf {Number(r.confidence).toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {editingId !== r.id && (
                      <Button variant="ghost" size="sm" onClick={() => startEdit(r)} className="h-7 px-2 text-xs">
                        Edit
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleActive(r)}
                      className="h-7 gap-1 px-2 text-xs"
                    >
                      <Power className="h-3 w-3" />
                      {r.active ? "Disable" : "Enable"}
                    </Button>
                  </div>
                </div>
                {editingId === r.id ? (
                  <div className="space-y-2">
                    <Textarea
                      value={draftText}
                      onChange={(e) => setDraftText(e.target.value)}
                      rows={3}
                      maxLength={280}
                      className="text-sm"
                    />
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={saving} className="gap-1">
                        <X className="h-3 w-3" /> Cancel
                      </Button>
                      <Button size="sm" onClick={() => saveEdit(r)} disabled={saving} className="gap-1">
                        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap break-words text-sm text-foreground/90">{r.rule}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

// Shown to signed-in users without the moderator/admin role. Offers a one-
// time "claim first admin" path: the bootstrap_first_admin RPC will only
// succeed if zero admins exist yet, so this is safe to expose broadly.
const BootstrapAdminPanel = ({ onPromoted }: { onPromoted: () => void }) => {
  const [busy, setBusy] = useState(false);
  const claim = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("bootstrap_first_admin");
      if (error) throw error;
      if (data === true) {
        toast.success("You are now the first admin.");
        onPromoted();
      } else {
        toast.error("An admin already exists. Ask them to grant you a role.");
      }
    } catch (e) {
      console.error("bootstrap_first_admin failed", e);
      toast.error("Could not claim admin role.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">Access required</h1>
      <p className="text-sm text-muted-foreground">
        The moderation dashboard is only available to moderators and admins. If
        no admin exists yet, you can claim the role for this workspace below.
      </p>
      <div className="flex flex-col items-center gap-2 pt-2">
        <Button onClick={claim} disabled={busy} className="gap-1.5">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Claim first admin
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Only works once, while no admin exists. After that, ask an existing
          admin to grant you a role.
        </p>
      </div>
      <Button asChild variant="outline" className="mt-2">
        <Link to="/"><ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back home</Link>
      </Button>
    </div>
  );
};

export default Admin;
