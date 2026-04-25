import { Loader2 } from "lucide-react";

const lines = [
  "Searching Semantic Scholar…",
  "Assessing novelty signal…",
  "Drafting protocol from published methods…",
  "Sourcing reagents and catalog numbers…",
  "Estimating budget and timeline…",
  "Compiling validation plan…",
];

export const GenerationProgress = ({ stage }: { stage: "qc" | "plan" }) => {
  const visible = stage === "qc" ? lines.slice(0, 2) : lines;
  return (
    <section className="paper-surface rounded-lg p-6 md:p-8">
      <div className="flex items-center gap-3">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          {stage === "qc" ? "Running literature QC" : "Generating experiment plan"}
        </span>
      </div>
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
