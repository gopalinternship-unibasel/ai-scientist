import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { RotateCcw, Github } from "lucide-react";
import { Logo } from "@/components/Logo";
import { HypothesisInput } from "@/components/HypothesisInput";
import { LiteratureQCCard } from "@/components/LiteratureQCCard";
import { ExperimentPlanView } from "@/components/ExperimentPlanView";
import { GenerationProgress } from "@/components/GenerationProgress";
import type { ExperimentPlan, LiteratureQC } from "@/lib/samples";
import { Button } from "@/components/ui/button";

type Stage = "input" | "qc" | "plan" | "done";

const Index = () => {
  const [stage, setStage] = useState<Stage>("input");
  const [hypothesis, setHypothesis] = useState("");
  const [qc, setQc] = useState<LiteratureQC | null>(null);
  const [plan, setPlan] = useState<ExperimentPlan | null>(null);

  const reset = () => {
    setStage("input");
    setHypothesis("");
    setQc(null);
    setPlan(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSubmit = async (h: string) => {
    setHypothesis(h);
    setStage("qc");
    setQc(null);
    setPlan(null);

    // 1. Literature QC
    const { data: qcData, error: qcErr } = await supabase.functions.invoke("literature-qc", {
      body: { hypothesis: h },
    });
    if (qcErr || !qcData || qcData.error) {
      toast.error(qcData?.error || qcErr?.message || "Literature QC failed");
      setStage("input");
      return;
    }
    const qcResult = qcData as LiteratureQC;
    setQc(qcResult);

    // 2. Generate plan
    setStage("plan");
    const { data: planData, error: planErr } = await supabase.functions.invoke("generate-plan", {
      body: { hypothesis: h, references: qcResult.references },
    });
    if (planErr || !planData || planData.error) {
      const msg = planData?.error || planErr?.message || "Plan generation failed";
      if (msg.toLowerCase().includes("rate")) {
        toast.error("Rate limit reached. Please wait a moment and retry.");
      } else if (msg.toLowerCase().includes("credit")) {
        toast.error("AI credits exhausted. Add credits in Workspace settings.");
      } else {
        toast.error(msg);
      }
      setStage("input");
      return;
    }
    setPlan(planData.plan as ExperimentPlan);
    setStage("done");
  };

  const loading = stage === "qc" || stage === "plan";

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b border-rule bg-background/85 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <Logo />
          <div className="hidden items-center gap-2 md:flex">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Powered by Lovable AI · Semantic Scholar
            </span>
          </div>
          <div className="flex items-center gap-2">
            {stage !== "input" && (
              <Button variant="ghost" size="sm" onClick={reset} className="gap-2">
                <RotateCcw className="h-3.5 w-3.5" />
                New experiment
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="container max-w-4xl py-8 md:py-12">
        {/* Hero / intro */}
        {stage === "input" && (
          <section className="mb-10 max-w-3xl animate-fade-in">
            <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              <span className="h-px w-6 bg-rule" />
              From hypothesis to runnable experiment plan
            </div>
            <h1 className="font-serif text-4xl font-semibold leading-[1.05] tracking-tight text-foreground md:text-5xl">
              The lab work that{" "}
              <span className="relative inline-block">
                slows science
                <span className="absolute -bottom-1 left-0 right-0 h-[6px] bg-accent/30 -z-10" />
              </span>
              , done in minutes.
            </h1>
            <p className="mt-5 max-w-2xl font-serif text-lg leading-relaxed text-foreground/75">
              State a scientific hypothesis. We check whether it's been done, then draft a complete
              operational plan — protocol, materials, budget, timeline, validation — that a real lab
              could pick up Monday and start running by Friday.
            </p>
          </section>
        )}

        {/* Stage indicator (when in flow) */}
        {stage !== "input" && (
          <div className="mb-6 flex items-center gap-3 text-sm">
            <StageDot active label="Hypothesis" />
            <Connector />
            <StageDot active label="Literature QC" />
            <Connector />
            <StageDot active={stage === "done"} label="Experiment Plan" />
          </div>
        )}

        {/* Hypothesis echo */}
        {stage !== "input" && hypothesis && (
          <div className="mb-6 rounded-md border-l-2 border-accent bg-paper p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Hypothesis
            </div>
            <p className="mt-1 font-serif italic text-foreground/90">{hypothesis}</p>
          </div>
        )}

        <div className="space-y-6">
          {stage === "input" && <HypothesisInput onSubmit={handleSubmit} loading={loading} />}
          {qc && <LiteratureQCCard qc={qc} />}
          {stage === "plan" && !plan && <GenerationProgress stage="plan" />}
          {stage === "qc" && !qc && <GenerationProgress stage="qc" />}
          {plan && <ExperimentPlanView plan={plan} />}
        </div>

        {stage === "done" && (
          <div className="mt-10 flex justify-center">
            <Button variant="outline" onClick={reset} className="gap-2">
              <RotateCcw className="h-4 w-4" />
              Plan another experiment
            </Button>
          </div>
        )}
      </main>

      <footer className="mt-16 border-t border-rule">
        <div className="container flex flex-col items-center justify-between gap-3 py-6 text-xs text-muted-foreground md:flex-row">
          <div className="font-mono uppercase tracking-[0.18em]">
            The AI Scientist · A Fulcrum × Hack-Nation challenge
          </div>
          <div className="flex items-center gap-4">
            <a href="https://protocols.io" target="_blank" rel="noreferrer" className="ink-link">
              protocols.io
            </a>
            <a href="https://semanticscholar.org" target="_blank" rel="noreferrer" className="ink-link">
              Semantic Scholar
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};

const StageDot = ({ active, label }: { active: boolean; label: string }) => (
  <div className="flex items-center gap-2">
    <span
      className={`h-2 w-2 rounded-full transition-colors ${
        active ? "bg-accent" : "bg-rule"
      }`}
    />
    <span
      className={`font-mono text-[10px] uppercase tracking-[0.18em] ${
        active ? "text-foreground" : "text-muted-foreground"
      }`}
    >
      {label}
    </span>
  </div>
);

const Connector = () => <span className="h-px w-8 bg-rule" />;

export default Index;
