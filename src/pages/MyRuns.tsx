import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, FlaskConical, Plus, Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { Logo } from "@/components/Logo";
import { UserMenu } from "@/components/UserMenu";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

interface RunRow {
  id: string;
  hypothesis: string;
  status: "pending" | "qc" | "plan" | "done" | "failed";
  created_at: string;
}

const MyRuns = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [runs, setRuns] = useState<RunRow[] | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate("/auth", { replace: true }); return; }

    let active = true;
    (async () => {
      const { data } = await supabase
        .from("runs")
        .select("id,hypothesis,status,created_at")
        .eq("owner_user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (active) setRuns((data ?? []) as RunRow[]);
    })();
    return () => { active = false; };
  }, [user, authLoading, navigate]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-rule bg-background/85 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <Logo />
          <div className="flex items-center gap-2">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="h-3.5 w-3.5" /> New experiment
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

        {runs && runs.length > 0 && (
          <ul className="paper-surface divide-y divide-rule rounded-lg">
            {runs.map((r) => (
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
