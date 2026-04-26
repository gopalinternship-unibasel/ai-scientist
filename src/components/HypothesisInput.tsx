import { useMemo, useState } from "react";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import { SAMPLE_HYPOTHESES } from "@/lib/samples";
import { Button } from "@/components/ui/button";
import { checkHypothesis } from "@/lib/hypothesisValidation";

interface Props {
  onSubmit: (hypothesis: string) => void;
  loading: boolean;
}

export const HypothesisInput = ({ onSubmit, loading }: Props) => {
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);

  const check = useMemo(() => checkHypothesis(value), [value]);

  const submit = (text?: string) => {
    const v = (text ?? value).trim();
    const c = checkHypothesis(v);
    setTouched(true);
    if (!c.ok || loading) return;
    setValue(v);
    onSubmit(v);
  };

  return (
    <section className="paper-surface relative overflow-hidden rounded-lg p-6 md:p-10">
      {/* corner stamp */}
      <div className="absolute right-6 top-6 hidden md:block">
        <span className="stamp border-foreground/15 bg-paper text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          Stage 01 · Hypothesis
        </span>
      </div>

      <div className="max-w-2xl">
        <h2 className="font-serif text-2xl font-semibold text-foreground md:text-3xl">
          What experiment do you want to run?
        </h2>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          State a precise hypothesis: an intervention, a measurable outcome, a threshold.
          We'll check the literature, then draft a complete, lab-ready plan.
        </p>
      </div>

      <div className="mt-6 rounded-md border border-foreground/15 bg-card focus-within:ring-2 focus-within:ring-ring/30">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          placeholder="e.g. Replacing sucrose with trehalose as a cryoprotectant will increase post-thaw HeLa viability by ≥15%…"
          rows={5}
          className="w-full resize-none bg-transparent p-4 font-serif text-[16px] leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
        />
        <div className="flex items-center justify-between border-t border-rule px-4 py-2.5">
          <span className="font-mono text-[11px] text-muted-foreground">
            ⌘ + Enter to generate
          </span>
          <Button
            onClick={() => submit()}
            disabled={!check.ok || loading}
            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating
              </>
            ) : (
              <>
                Generate plan
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </div>

      {touched && !check.ok && check.reason && (
        <p className="mt-3 text-[12px] text-foreground/70">{check.reason}</p>
      )}

      <div className="mt-7">
        <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          <Sparkles className="h-3 w-3" />
          Try a sample hypothesis
        </div>
        <div className="grid gap-2.5 md:grid-cols-2">
          {SAMPLE_HYPOTHESES.map((s) => (
            <button
              key={s.category}
              type="button"
              disabled={loading}
              onClick={() => submit(s.hypothesis)}
              className="group rounded-md border border-rule bg-paper p-3.5 text-left transition-all hover:border-foreground/30 hover:shadow-soft disabled:opacity-50"
            >
              <div className="mb-1.5 flex items-center justify-between">
                <span className="stamp border-foreground/15 bg-card text-foreground/70">
                  {s.category}
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
              </div>
              <p className="font-serif text-[14px] leading-snug text-foreground/85">
                {s.plain}
              </p>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};


