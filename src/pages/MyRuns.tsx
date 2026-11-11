import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, FlaskConical, Plus, Clock, CheckCircle2, AlertCircle, Search } from "lucide-react";
import { Logo } from "@/components/Logo";
import { UserMenu } from "@/components/UserMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

interface RunRow {
  id: string;
  hypothesis: string;
  status: "pending" | "qc" | "plan" | "done" | "failed";
  created_at: string;
}

const PAGE_SIZE = 50;

const MyRuns = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "done" | "failed" | "in_flight">("all");
  // Runs are loaded a page at a time. Until QA round 4 the list stopped at
  // the newest 50 with no way to reach older ones.
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [total, setTotal] = useState<number | null>(null);

  const filtered = useMemo(() => {
    if (!runs) return null;
    const q = query.trim().toLowerCase();
    return runs.filter((r) => {
      if (statusFilter === "done" && r.status !== "done") return false;
      if (statusFilter === "failed" && r.status !== "failed") return false;
      if (statusFilter === "in_flight" && !["pending", "qc", "plan"].includes(r.status)) return false;
      if (q && !r.hypothesis.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [runs, query, statusFilter]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate("/auth", { replace: true }); return; }

    let active = true;
    const load = async () => {
      const { data, count } = await supabase
        .from("runs")
        .select("id,hypothesis,status,created_at", { count: "exact" })
        .eq("owner_user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (active) {
        setRuns((data ?? []) as RunRow[]);
        setTotal(typeof count === "number" ? count : null);
      }
    };
    load();

    // Realtime: refresh the list whenever any of this user's runs change.
    const channel = supabase
      .channel(`my-runs:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "runs", filter: `owner_user_id=eq.${user.id}` },
        () => { if (active) load(); },
      )
      .subscribe();

    return () => { active = false; supabase.removeChannel(channel); };
  }, [user, authLoading, navigate, limit]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-rule bg-background/85 backdrop-blur">
        <div className="container flex h-16 items-center justify-between gap-2">
          <Logo />
          <div className="flex shrink-0 items-center gap-2">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-2" aria-label="New experiment">
                <ArrowLeft className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New experiment</span>
              </Button>
            </Link>
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="container max-w-4xl py-8 md:py-12">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              Library
            </div>
            <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight text-foreground">
              My experiments
            </h1>
          </div>
          <Link to="/">
            <Button size="sm" className="gap-2">
              <Plus className="h-3.5 w-3.5" /> New
            </Button>
          </Link>
        </div>

        {runs && runs.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search hypotheses…"
                className="pl-9"
              />
            </div>
            <div className="flex gap-1 rounded-md border border-rule bg-paper p-1">
              {(["all", "done", "in_flight", "failed"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className={`rounded px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                    statusFilter === s
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s === "in_flight" ? "Running" : s}
                </button>
              ))}
            </div>
          </div>
        )}

        {runs === null && (
          <div className="paper-surface rounded-lg p-8 text-center text-sm text-muted-foreground">
            Loading…
          </div>
        )}

        {runs && runs.length === 0 && (
          <div className="paper-surface rounded-lg p-12 text-center">
            <FlaskConical className="mx-auto h-8 w-8 text-muted-foreground" />
            <h2 className="mt-4 font-serif text-xl text-foreground">No experiments yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Generate your first plan to see it here.
            </p>
            <Link to="/" className="mt-5 inline-block">
              <Button size="sm" className="gap-2">
                <Plus className="h-3.5 w-3.5" /> Start an experiment
              </Button>
            </Link>
          </div>
        )}

        {filtered && filtered.length === 0 && runs && runs.length > 0 && (
          <div className="paper-surface rounded-lg p-8 text-center text-sm text-muted-foreground">
            No experiments match your filters.
          </div>
        )}

        {filtered && filtered.length > 0 && (
          <ul className="paper-surface divide-y divide-rule rounded-lg">
            {filtered.map((r) => (
              <li key={r.id}>
                <Link
                  to={`/runs/${r.id}`}
                  className="flex items-start gap-4 p-5 transition-colors hover:bg-paper-lined"
                >
                  <StatusBadge status={r.status} />
                  <div className="min-w-0 flex-1">
                    <p className="font-serif text-[15px] leading-snug text-foreground line-clamp-2">
                      {r.hypothesis}
                    </p>
                    <div className="mt-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                      {new Date(r.created_at).toLocaleString()}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {runs && total !== null && total > runs.length && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground" data-testid="runs-more">
            <span>Showing the newest {runs.length} of {total} experiments. Search and filters apply to the ones shown.</span>
            <Button variant="outline" size="sm" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
              Show {Math.min(PAGE_SIZE, total - runs.length)} more
            </Button>
          </div>
        )}
      </main>
    </div>
  );
};

const StatusBadge = ({ status }: { status: RunRow["status"] }) => {
  if (status === "done")
    return <CheckCircle2 className="mt-1 h-4 w-4 flex-shrink-0 text-success" />;
  if (status === "failed")
    return <AlertCircle className="mt-1 h-4 w-4 flex-shrink-0 text-destructive" />;
  return <Clock className="mt-1 h-4 w-4 flex-shrink-0 animate-pulse text-accent" />;
};

export default MyRuns;
