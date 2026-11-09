import { Loader2, Sparkles, Square } from "lucide-react";
import { Button } from "@/components/ui/button";

const lines = [
  "Searching Semantic Scholar, OpenAlex, PubMed…",
  "Assessing novelty signal…",
  "Drafting protocol from published methods…",
  "Sourcing reagents and catalog numbers…",
  "Estimating budget and timeline…",
  "Compiling validation plan…",
];

/** Live progress the edge function writes to `runs.progress` while it works. */
export interface RunProgress {
  stage?: "gate" | "literature" | "novelty" | "planning" | "critique" | "complete" | string;
  at?: string;
  chars?: number;
  sections?: string[];
  model?: string;
  candidates?: number;
}

const STAGE_LABEL: Record<string, string> = {
  gate: "Checking that this is a testable hypothesis",
  literature: "Searching Semantic Scholar, OpenAlex and PubMed",
  novelty: "Classifying novelty against the retrieved papers",
  planning: "Streaming the experiment plan from the model",
  critique: "Independent reviewer critique in progress",
};

const SECTION_LABEL: Record<string, string> = {
  hypothesis_restated: "hypothesis", success_criteria: "success criteria",
  statistical_design: "statistics",
};

/** One-line description of the live progress, or null when there is none. */
export function describeProgress(p: RunProgress | null | undefined): string | null {
  if (!p?.stage || p.stage === "complete") return null;
  const label = STAGE_LABEL[p.stage] ?? p.stage;
  if (p.stage === "planning" && (p.chars ?? 0) > 0) {
    const done = (p.sections ?? []).map((k) => SECTION_LABEL[k] ?? k.replace(/_/g, " "));
    return `${label}: ${p.chars!.toLocaleString("en-US")} characters so far${done.length ? ` · sections started: ${done.join(", ")}` : ""}`;
  }
  if (p.stage === "novelty" && p.candidates != null) return `${label} (${p.candidates} candidates)`;
  return label;
}

interface Props {
  stage: "qc" | "plan";
  /** Optional: live progress from runs.progress. */
  progress?: RunProgress | null;
  /** Optional: render a Stop button that aborts the in-flight stream. */
  onStop?: () => void;
  /** Optional: refinement context to display while regenerating. */
  refinement?: { fromVersion: number; toVersion: number; instruction: string } | null;
}

export const GenerationProgress = ({ stage, onStop, refinement, progress }: Props) => {
  const visible = stage === "qc" ? lines.slice(0, 2) : lines;
  const live = describeProgress(progress);
  return (
    <section className="paper-surface rounded-lg p-6 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            {stage === "qc" ? "Running literature QC" : "Generating experiment plan"}
          </span>
        </div>
        {onStop && (
          <Button variant="outline" size="sm" onClick={onStop} className="gap-1.5">
            <Square className="h-3 w-3 fill-current" /> Stop
          </Button>
        )}
      </div>

      {refinement && (
        <div className="mt-4 rounded-md border-l-2 border-accent bg-paper p-3.5">
          <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
            <Sparkles className="h-3 w-3" />
            Refining v{refinement.fromVersion} → v{refinement.toVersion}
          </div>
          <p className="font-serif text-[14px] italic leading-snug text-foreground/85">
            "{refinement.instruction}"
          </p>
        </div>
      )}

      {live && (
        <p
          data-testid="live-progress"
          aria-live="polite"
          className="mt-4 rounded-md border border-rule bg-paper px-3 py-2 font-mono text-[11px] text-foreground/80"
        >
          {live}
          {progress?.model ? ` · model ${progress.model}` : ""}
        </p>
      )}

      <ul className="mt-5 space-y-2">
        {visible.map((l, i) => (
          <li
            key={l}
            className="flex items-center gap-3 text-sm text-foreground/80 animate-fade-in"
            style={{ animationDelay: `${i * 120}ms` }}
          >
            <span className="font-mono text-[11px] text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
            <span className="font-serif italic">{l}</span>
          </li>
        ))}
      </ul>
    </section>
  );
};
