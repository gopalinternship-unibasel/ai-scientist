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

interface Props {
  stage: "qc" | "plan";
  /** Optional: render a Stop button that aborts the in-flight stream. */
  onStop?: () => void;
  /** Optional: refinement context to display while regenerating. */
  refinement?: { fromVersion: number; toVersion: number; instruction: string } | null;
}

export const GenerationProgress = ({ stage, onStop, refinement }: Props) => {
  const visible = stage === "qc" ? lines.slice(0, 2) : lines;
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
