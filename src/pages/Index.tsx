import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Logo } from "@/components/Logo";
import { UserMenu } from "@/components/UserMenu";
import { HypothesisInput } from "@/components/HypothesisInput";
import { GenerationProgress } from "@/components/GenerationProgress";
import { RateLimitBadge } from "@/components/RateLimitBadge";
import { startRunStream } from "@/lib/runStream";
import { getOwnerToken } from "@/lib/owner";
import { trackRun } from "@/hooks/useBackgroundRunNotifier";

const Index = () => {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleSubmit = async (h: string) => {
    setSubmitting(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await startRunStream({
        hypothesis: h,
        ownerToken: getOwnerToken(),
        signal: controller.signal,
        onEvent: (e) => {
          switch (e.type) {
            case "run":
              if (e.cached) toast.success("Found a cached plan for this hypothesis ✦");
              // Track this run so the user gets pinged if they navigate away
              // before it finishes (the actual stream keeps running on the server).
              trackRun({ id: e.id, hypothesis: h });
              // Resume on reconnect: hand off to RunPage immediately. The run
              // continues server-side regardless of whether this tab stays open.
              navigate(`/runs/${e.id}`);
              break;
            case "error": {
              const isRateLimit = /limited to|per hour|sign in/i.test(e.message);
              if (isRateLimit) {
                toast.error(e.message, {
                  action: { label: "Sign in", onClick: () => navigate("/auth") },
                  duration: 8000,
                });
              } else if (e.kind === "VALIDATION") {
                // Show the actionable suggestion alongside the error so the
                // user knows how to fix a vague / non-scientific / infeasible
                // hypothesis instead of staring at a bare rejection.
                toast.error(e.message, {
                  description: e.suggestion,
                  duration: 12000,
                });
              } else {
                toast.error(e.message, { description: e.suggestion });
              }
              setSubmitting(false);
              break;
            }
            // qc / progress / plan / done are handled by RunPage via realtime now.
          }
        },
      });
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        console.error(err);
        toast.error("Connection failed. Please retry.");
        setSubmitting(false);
      }
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-rule bg-background/85 backdrop-blur">
        <div className="container flex h-16 items-center justify-between gap-3">
          <Logo />
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <RateLimitBadge refreshKey={submitting} className="hidden sm:inline-flex" />
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="container max-w-4xl py-8 md:py-12">
        {/* Phone width: the quota badge sits here instead of in the header. */}
        <div className="mb-4 sm:hidden">
          <RateLimitBadge refreshKey={submitting} />
        </div>
        {!submitting && (
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
              operational plan covering protocol, materials, budget, timeline, and validation that a
              real lab could pick up Monday and start running by Friday.
            </p>
          </section>
        )}

        <div className="space-y-6">
          {!submitting ? (
            <HypothesisInput onSubmit={handleSubmit} loading={submitting} />
          ) : (
            <GenerationProgress
              stage="qc"
              onStop={() => {
                abortRef.current?.abort();
                setSubmitting(false);
                toast.message("Generation stopped.");
              }}
            />
          )}
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

export default Index;
