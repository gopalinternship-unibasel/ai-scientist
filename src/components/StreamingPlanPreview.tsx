import { Loader2, Sparkles } from "lucide-react";
import type { ExperimentPlan } from "@/lib/samples";

// Renders whatever sections of the plan have streamed in so far.
export const StreamingPlanPreview = ({ partial }: { partial: Partial<ExperimentPlan> | null }) => {
  return (
    <section className="paper-surface rounded-lg p-6 md:p-8">
      <div className="mb-5 flex items-center gap-3">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Generating experiment plan
        </span>
        <Sparkles className="ml-auto h-3.5 w-3.5 text-accent" />
      </div>

      {!partial && (
        <div className="space-y-2.5">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-3 animate-pulse rounded bg-muted"
              style={{ width: `${100 - i * 12}%` }}
            />
          ))}
        </div>
      )}

      {partial?.title && (
        <h3 className="font-serif text-2xl font-semibold leading-tight text-foreground">
          {partial.title}
        </h3>
      )}
      {partial?.summary && (
        <p className="mt-2 text-sm leading-relaxed text-foreground/80">{partial.summary}</p>
      )}

      {partial?.success_criteria && partial.success_criteria.length > 0 && (
        <Block label="Success criteria">
          <ul className="space-y-1.5">
            {partial.success_criteria.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-foreground/85">
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent" />
                {c}
              </li>
            ))}
          </ul>
        </Block>
      )}

      {partial?.protocol && partial.protocol.length > 0 && (
        <Block label={`Protocol · ${partial.protocol.length} steps drafted`}>
          <ol className="space-y-2">
            {partial.protocol.slice(0, 5).map((s, i) => (
              <li key={i} className="text-sm text-foreground/85">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {String(s.step ?? i + 1).padStart(2, "0")}.
                </span>{" "}
                <span className="font-medium">{s.title}</span>
              </li>
            ))}
          </ol>
        </Block>
      )}

      {partial?.materials && partial.materials.length > 0 && (
        <Block label={`${partial.materials.length} reagents sourced`}>
          <div className="flex flex-wrap gap-1.5">
            {partial.materials.slice(0, 8).map((m, i) => (
              <span key={i} className="rounded bg-paper-lined px-2 py-0.5 text-xs text-foreground/80">
                {m.name}
              </span>
            ))}
          </div>
        </Block>
      )}

      {partial?.budget?.total_usd != null && (
        <Block label="Budget">
          <div className="font-mono text-sm">
            Total drafted: <span className="font-semibold">${Math.round(partial.budget.total_usd).toLocaleString()}</span>
          </div>
        </Block>
      )}
    </section>
  );
};

const Block = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="mt-5 border-t border-rule pt-4">
    <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
      {label}
    </div>
    {children}
  </div>
);
