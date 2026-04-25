import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, RotateCcw, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";
import { UserMenu } from "@/components/UserMenu";
import { LiteratureQCCard } from "@/components/LiteratureQCCard";
import { ExperimentPlanView } from "@/components/ExperimentPlanView";
import { GenerationProgress } from "@/components/GenerationProgress";
import { PlanCritiqueCard } from "@/components/PlanCritiqueCard";
import { RefineDialog } from "@/components/RefineDialog";
import { VersionSwitcher, type VersionEntry } from "@/components/VersionSwitcher";
import { Button } from "@/components/ui/button";
import type { ExperimentPlan, LiteratureQC, PlanCritique } from "@/lib/samples";

type Status = "pending" | "qc" | "plan" | "done" | "failed";

interface Run {
  id: string;
  hypothesis: string;
  status: Status;
  qc: LiteratureQC | null;
  plan: ExperimentPlan | null;
  critique: PlanCritique | null;
  error: string | null;
  created_at: string;
  parent_run_id: string | null;
  version: number;
  refinement_instruction: string | null;
}

const RUN_COLUMNS =
  "id,hypothesis,status,qc,plan,critique,error,created_at,parent_run_id,version,refinement_instruction";

const RunPage = () => {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<Run | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [refineOpen, setRefineOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    let active = true;

    const load = async () => {
      // The new columns aren't yet in the generated TS types; cast through unknown.
      const { data, error } = await supabase
        .from("runs")
        // deno-lint-ignore no-explicit-any
        .select(RUN_COLUMNS as any)
        .eq("id", id)
        .maybeSingle();
      if (!active) return;
      if (error || !data) { setNotFound(true); return; }
      const r = data as unknown as Run;
      setRun(r);

      // Load all versions in this refinement chain (root + descendants).
      const rootId = r.parent_run_id ?? r.id;
      const { data: chain } = await supabase
        .from("runs")
        // deno-lint-ignore no-explicit-any
        .select("id,version,refinement_instruction,created_at,status,parent_run_id" as any)
        .or(`id.eq.${rootId},parent_run_id.eq.${rootId}`)
        .order("version", { ascending: true });
      if (active && chain) setVersions(chain as unknown as VersionEntry[]);
    };
    load();

    const channel = supabase
      .channel(`run:${id}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "runs", filter: `id=eq.${id}` },
        (payload) => { if (active) setRun(payload.new as unknown as Run); })
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
  const canRefine = run.status === "done" && !!run.plan;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-rule bg-background/85 backdrop-blur no-print">
        <div className="container flex h-16 items-center justify-between">
          <Logo />
          <div className="flex items-center gap-2">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="h-3.5 w-3.5" />
                New experiment
              </Button>
            </Link>
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="container max-w-4xl py-8 md:py-12">
        <div className="mb-6 rounded-md border-l-2 border-accent bg-paper p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Hypothesis
                {run.version > 1 && (
                  <span className="rounded-sm bg-accent/15 px-1.5 py-0.5 text-accent">
                    v{run.version}
                  </span>
                )}
              </div>
              <p className="mt-1 font-serif italic text-foreground/90">{run.hypothesis}</p>
              {run.refinement_instruction && (
                <div className="mt-2 flex items-start gap-1.5 text-xs text-foreground/70">
                  <Sparkles className="mt-0.5 h-3 w-3 flex-shrink-0 text-accent" />
                  <span>
                    <span className="font-mono uppercase tracking-wider text-muted-foreground">
                      Refinement:
                    </span>{" "}
                    {run.refinement_instruction}
                  </span>
                </div>
              )}
            </div>
            {canRefine && (
              <Button
                variant="outline"
                size="sm"
                className="no-print gap-1.5 flex-shrink-0"
                onClick={() => setRefineOpen(true)}
              >
                <Sparkles className="h-3.5 w-3.5" /> Refine
              </Button>
            )}
          </div>
        </div>

        {versions.length > 1 && (
          <div className="mb-6 no-print">
            <VersionSwitcher versions={versions} currentId={run.id} />
          </div>
        )}

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
          {run.critique && <PlanCritiqueCard critique={run.critique} />}
        </div>
      </main>

      {canRefine && (
        <RefineDialog
          open={refineOpen}
          onOpenChange={setRefineOpen}
          parentRunId={run.id}
          hypothesis={run.hypothesis}
        />
      )}
    </div>
  );
};

export default RunPage;
