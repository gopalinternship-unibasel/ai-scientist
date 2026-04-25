import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Github } from "lucide-react";
import { Logo } from "@/components/Logo";
import { HypothesisInput } from "@/components/HypothesisInput";
import { LiteratureQCCard } from "@/components/LiteratureQCCard";
import { GenerationProgress } from "@/components/GenerationProgress";
import type { LiteratureQC } from "@/lib/samples";
import { startRunStream } from "@/lib/runStream";
import { getOwnerToken } from "@/lib/owner";

type Stage = "input" | "qc" | "plan";

const Index = () => {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>("input");
  const [hypothesis, setHypothesis] = useState("");
  const [qc, setQc] = useState<LiteratureQC | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleSubmit = async (h: string) => {
    setHypothesis(h);
    setStage("qc");
    setQc(null);

    const controller = new AbortController();
    abortRef.current = controller;
    let runId: string | null = null;

    try {
      await startRunStream({
        hypothesis: h,
        ownerToken: getOwnerToken(),
        signal: controller.signal,
        onEvent: (e) => {
          switch (e.type) {
            case "run":
              runId = e.id;
              break;
            case "qc":
              setQc(e.qc);
              setStage("plan");
              break;
            case "plan":
            case "done":
              if (runId) navigate(`/runs/${runId}`);
              break;
            case "error":
              toast.error(e.message);
              setStage("input");
              break;
          }
        },
      });
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        console.error(err);
        toast.error("Connection failed. Please retry.");
        setStage("input");
      }
    }
  };

  const loading = stage === "qc" || stage === "plan";

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-rule bg-background/85 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <Logo />
          <div className="hidden items-center gap-2 md:flex">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Powered by Lovable AI · Semantic Scholar
            </span>
          </div>
          <div />
        </div>
      </header>

      <main className="container max-w-4xl py-8 md:py-12">
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

        {stage !== "input" && (
          <div className="mb-6 flex items-center gap-3 text-sm">
            <StageDot active label="Hypothesis" />
            <Connector />
            <StageDot active label="Literature QC" />
            <Connector />
            <StageDot active={false} label="Experiment Plan" />
          </div>
        )}

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
          {stage === "qc" && !qc && <GenerationProgress stage="qc" />}
          {stage === "plan" && qc && <GenerationProgress stage="plan" />}
        </div>
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
    <span className={`h-2 w-2 rounded-full transition-colors ${active ? "bg-accent" : "bg-rule"}`} />
    <span className={`font-mono text-[10px] uppercase tracking-[0.18em] ${active ? "text-foreground" : "text-muted-foreground"}`}>
      {label}
    </span>
  </div>
);

const Connector = () => <span className="h-px w-8 bg-rule" />;

export default Index;
