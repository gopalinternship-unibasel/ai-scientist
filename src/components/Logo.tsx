import { Beaker } from "lucide-react";

export const Logo = ({ className = "" }: { className?: string }) => (
  <div className={`flex items-center gap-2.5 ${className}`}>
    <div className="relative flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-soft">
      <Beaker className="h-4 w-4" strokeWidth={2.25} />
      <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent" />
    </div>
    <div className="leading-tight">
      <div className="font-serif text-[17px] font-semibold tracking-tight text-foreground">
        The AI Scientist
      </div>
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Hypothesis → Experiment
      </div>
    </div>
  </div>
);
