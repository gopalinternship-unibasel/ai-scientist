import { ShieldCheck, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { PlanCritique } from "@/lib/samples";

const sevColor: Record<PlanCritique["concerns"][number]["severity"], string> = {
  low: "border-success/40 bg-success/5 text-success",
  medium: "border-warning/40 bg-warning/10 text-warning",
  high: "border-destructive/40 bg-destructive/10 text-destructive",
};

export const PlanCritiqueCard = ({ critique }: { critique: PlanCritique }) => {
  return (
    <section className="paper-surface rounded-lg p-6 md:p-8 animate-fade-in">
      <header className="mb-5 flex items-center gap-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-sm bg-primary text-primary-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Reviewer notes
        </span>
        <h2 className="font-serif text-xl font-semibold text-foreground">Peer review pass</h2>
        <span className="ml-auto rounded-md border border-rule bg-paper px-3 py-1 font-mono text-xs">
          Score {critique.overall_score}/10
        </span>
      </header>

      {critique.strengths.length > 0 && (
        <div className="mb-5">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Strengths
          </div>
          <ul className="space-y-1.5">
            {critique.strengths.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-foreground/85">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-success" />
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {critique.concerns.length > 0 && (
        <div className="mb-5">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Concerns
          </div>
          <ul className="space-y-3">
            {critique.concerns.map((c, i) => (
              <li key={i} className={`rounded-md border-l-2 p-3 ${sevColor[c.severity]}`}>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span className="font-mono text-[10px] uppercase tracking-wider">
                    {c.severity} · {c.area}
                  </span>
                </div>
                <div className="mt-1 text-sm font-medium text-foreground">{c.issue}</div>
                <div className="mt-1 text-sm text-foreground/75">→ {c.suggestion}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {critique.missing_controls.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Missing controls
          </div>
          <div className="flex flex-wrap gap-2">
            {critique.missing_controls.map((c, i) => (
              <span key={i} className="stamp border-warning/40 bg-warning/10 text-warning">
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

      {critique.statistical_notes && (
        <div className="mb-4 rounded-md border border-rule p-3">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Statistical notes
          </div>
          <p className="text-sm text-foreground/85">{critique.statistical_notes}</p>
        </div>
      )}

      {critique.ethical_notes && (
        <div className="rounded-md border border-rule p-3">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Ethical notes
          </div>
          <p className="text-sm text-foreground/85">{critique.ethical_notes}</p>
        </div>
      )}
    </section>
  );
};
