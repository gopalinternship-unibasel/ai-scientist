import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";
import { LiteratureQCCard } from "@/components/LiteratureQCCard";
import { ExperimentPlanView } from "@/components/ExperimentPlanView";
import { GenerationProgress } from "@/components/GenerationProgress";
import { Button } from "@/components/ui/button";
import type { ExperimentPlan, LiteratureQC } from "@/lib/samples";

type Status = "pending" | "qc" | "plan" | "done" | "failed";

interface Run {
  id: string;
  hypothesis: string;
  status: Status;
  qc: LiteratureQC | null;
  plan: ExperimentPlan | null;
  error: string | null;
  created_at: string;
}

const RunPage = () => {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<Run | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    let active = true;

    const load = async () => {
      const { data, error } = await supabase
        .from("runs")
        .select("id,hypothesis,status,qc,plan,error,created_at")
        .eq("id", id)
        .maybeSingle();
      if (!active) return;
      if (error || !data) { setNotFound(true); return; }
      setRun(data as unknown as Run);
    };
    load();

    // Realtime updates while a run is still in flight
    const channel = supabase
      .channel(`run:${id}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "runs", filter: `id=eq.${id}` },
        (payload) => {
          if (active) setRun(payload.new as unknown as Run);
        })
      .subscribe();

    return () => { active = false; supabase.removeChannel(channel); };
  }, [id]);

  if (notFound) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container max-w-2xl py-20 text-center">
          <h1 className="font-serif text-2xl">Run not found</h1>
          <Link to="/" className="ink-link mt-4 inline-block">← Back to home</Link>
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container max-w-2xl py-20 text-center text-muted-foreground">
          Loading run…
        </div>
      </div>
    );
  }

  const inFlight = run.status === "pending" || run.status === "qc" || run.status === "plan";

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-rule bg-background/85 backdrop-blur no-print">
        <div className="container flex h-16 items-center justify-between">
          <Logo />
          <Link to="/">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-3.5 w-3.5" />
              New experiment
            </Button>
          </Link>
        </div>
      </header>

      <main className="container max-w-4xl py-8 md:py-12">
        <div className="mb-6 rounded-md border-l-2 border-accent bg-paper p-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Hypothesis
          </div>
          <p className="mt-1 font-serif italic text-foreground/90">{run.hypothesis}</p>
        </div>

        {run.status === "failed" && (
          <div className="paper-surface rounded-lg p-6 mb-6">
            <h2 className="font-serif text-lg text-destructive">Run failed</h2>
            <p className="mt-1 text-sm text-foreground/80">{run.error ?? "Unknown error."}</p>
            <Link to="/" className="mt-3 inline-block">
              <Button variant="outline" size="sm" className="gap-2">
                <RotateCcw className="h-3.5 w-3.5" /> Try again
              </Button>
            </Link>
          </div>
        )}

        <div className="space-y-6">
          {run.qc && <LiteratureQCCard qc={run.qc} />}
          {inFlight && !run.qc && <GenerationProgress stage="qc" />}
          {inFlight && run.qc && !run.plan && <GenerationProgress stage="plan" />}
          {run.plan && <ExperimentPlanView plan={run.plan} />}
        </div>
      </main>
    </div>
  );
};

export default RunPage;
