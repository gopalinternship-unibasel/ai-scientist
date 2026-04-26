import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams, Link, useNavigate } from "react-router-dom";
import { ArrowLeft, RotateCcw, Sparkles, Share2, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { createScopedClient } from "@/lib/supabaseScoped";
import { Logo } from "@/components/Logo";
import { UserMenu } from "@/components/UserMenu";
import { LiteratureQCCard } from "@/components/LiteratureQCCard";
import { ExperimentPlanView } from "@/components/ExperimentPlanView";
import { SolicitationBanner } from "@/components/SolicitationBanner";
import { GenerationProgress } from "@/components/GenerationProgress";
import { PlanCritiqueCard } from "@/components/PlanCritiqueCard";
import { RefineDialog } from "@/components/RefineDialog";
import { VersionSwitcher, type VersionEntry } from "@/components/VersionSwitcher";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { untrackRun, trackRun } from "@/hooks/useBackgroundRunNotifier";
import { startRunStream } from "@/lib/runStream";
import { getOwnerToken } from "@/lib/owner";
import { parseRunError, hintForKind, isRetryable } from "@/lib/runErrors";
import type { ExperimentPlan, LiteratureQC, PlanCritique } from "@/lib/samples";

type Status = "pending" | "qc" | "plan" | "done" | "failed";

interface AppliedFeedback {
  id: string;
  section: string;
  rating: number | null;
  correction: string;
  similarity: number;
}

interface Run {
  id: string;
  hypothesis: string;
  status: Status;
  qc: LiteratureQC | null;
  plan: ExperimentPlan | null;
  critique: PlanCritique | null;
  error: string | null;
  created_at: string;
  parent_run_id: string | null;
  version: number;
  refinement_instruction: string | null;
  share_token: string | null;
  owner_user_id: string | null;
  updated_at: string;
  applied_feedback: AppliedFeedback[] | null;
  solicit_section: string | null;
  solicit_reason: string | null;
}

const RUN_COLUMNS =
  "id,hypothesis,status,qc,plan,critique,error,created_at,parent_run_id,version,refinement_instruction,share_token,owner_user_id,updated_at,applied_feedback,solicit_section,solicit_reason";

// Stall threshold: warn the user if no progress for 90s on an in-flight run.
const STALL_THRESHOLD_MS = 150_000;

const RunPage = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const shareToken = searchParams.get("t");
  const [run, setRun] = useState<Run | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [refineOpen, setRefineOpen] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const retryAbortRef = useRef<AbortController | null>(null);

  // Pick a client whose RLS context can read this run:
  // - signed-in user → default supabase client (their JWT is enough)
  // - anonymous owner or share link → scoped client with x-owner-token / x-share-token
  const client = useMemo(() => {
    if (user) return supabase;
    return createScopedClient({ shareToken });
  }, [user, shareToken]);

  useEffect(() => {
    if (!id) return;
    let active = true;

    untrackRun(id);

    const load = async () => {
      const { data, error } = await client
        .from("runs")
        // deno-lint-ignore no-explicit-any
        .select(RUN_COLUMNS as any)
        .eq("id", id)
        .maybeSingle();
      if (!active) return;
      if (error || !data) { setNotFound(true); return; }
      const r = data as unknown as Run;
      setRun(r);

      // Load all versions in this refinement chain (root + descendants).
      const rootId = r.parent_run_id ?? r.id;
      const { data: chain } = await client
        .from("runs")
        // deno-lint-ignore no-explicit-any
        .select("id,version,refinement_instruction,created_at,status,parent_run_id,plan" as any)
        .or(`id.eq.${rootId},parent_run_id.eq.${rootId}`)
        .order("version", { ascending: true });
      if (active && chain) setVersions(chain as unknown as VersionEntry[]);
    };
    load();

    // Realtime: subscribe via the default client so the user's auth context
    // applies to the realtime.messages RLS policies. Anonymous viewers fall
    // back to polling on a short interval.
    const useRealtime = !!user || !!shareToken === false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    if (useRealtime) {
      channel = supabase
        .channel(`run:${id}`)
        .on("postgres_changes",
          { event: "UPDATE", schema: "public", table: "runs", filter: `id=eq.${id}` },
          (payload) => { if (active) setRun(payload.new as unknown as Run); })
        .subscribe();
    } else {
      // Share-link viewers: poll every 5s while in-flight.
      pollTimer = setInterval(load, 5000);
    }

    return () => {
      active = false;
      if (channel) supabase.removeChannel(channel);
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [id, client, user, shareToken]);

  // Stall detection: if status is in-flight and updated_at hasn't moved in 90s,
  // surface a warning so the user can retry instead of staring at a spinner.
  useEffect(() => {
    if (!run) return;
    const inFlight = run.status === "pending" || run.status === "qc" || run.status === "plan";
    if (!inFlight) { setStalled(false); return; }
    const tick = () => {
      const last = new Date(run.updated_at).getTime();
      setStalled(Date.now() - last > STALL_THRESHOLD_MS);
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => clearInterval(t);
  }, [run]);

  const onShare = async () => {
    if (!run) return;
    let token = run.share_token;
    if (!token) {
      // Mint a share token (only the owner can do this via RLS UPDATE policy).
      token = crypto.randomUUID().replace(/-/g, "");
      const { error } = await supabase
        .from("runs")
        // deno-lint-ignore no-explicit-any
        .update({ share_token: token } as any)
        .eq("id", run.id);
      if (error) {
        toast.error("Could not create share link.");
        return;
      }
      setRun({ ...run, share_token: token });
    }
    const url = `${window.location.origin}/runs/${run.id}?t=${token}`;
    await navigator.clipboard.writeText(url);
    setShareCopied(true);
    toast.success("Share link copied to clipboard.");
    setTimeout(() => setShareCopied(false), 2000);
  };

  // Retry a failed run: re-submit the same hypothesis (and refinement instruction
  // if this was a refinement) as a fresh run. Cheaper than asking the user to
  // retype, and preserves intent.
  const onRetry = async () => {
    if (!run || retrying) return;
    setRetrying(true);
    const controller = new AbortController();
    retryAbortRef.current = controller;
    try {
      await startRunStream({
        hypothesis: run.hypothesis,
        ownerToken: getOwnerToken(),
        signal: controller.signal,
        parentRunId: run.parent_run_id ?? undefined,
        refinementInstruction: run.refinement_instruction ?? undefined,
        onEvent: (e) => {
          if (e.type === "run") {
            trackRun({ id: e.id, hypothesis: run.hypothesis });
            navigate(`/runs/${e.id}`);
          } else if (e.type === "error") {
            toast.error(e.message);
            setRetrying(false);
          }
        },
      });
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        toast.error("Retry failed. Please try again.");
        setRetrying(false);
      }
    }
  };

  if (notFound) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container max-w-2xl py-20 text-center">
          <h1 className="font-serif text-2xl">Run not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This experiment may be private or the link may be invalid.
          </p>
          <Link to="/" className="ink-link mt-4 inline-block">← Back to home</Link>
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container max-w-2xl py-20 text-center text-muted-foreground">
          Loading run…
        </div>
      </div>
    );
  }

  const inFlight = run.status === "pending" || run.status === "qc" || run.status === "plan";
  const canRefine = run.status === "done" && !!run.plan;
  const isOwner = !!user && run.owner_user_id === user.id;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-rule bg-background/85 backdrop-blur no-print">
        <div className="container flex h-16 items-center justify-between">
          <Logo />
          <div className="flex items-center gap-2">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="h-3.5 w-3.5" />
                New experiment
              </Button>
            </Link>
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="container max-w-4xl py-8 md:py-12">
        <div className="mb-6 rounded-md border-l-2 border-accent bg-paper p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Hypothesis
                {run.version > 1 && (
                  <span className="rounded-sm bg-accent/15 px-1.5 py-0.5 text-accent">
                    v{run.version}
                  </span>
                )}
              </div>
              <p className="mt-1 font-serif italic text-foreground/90">{run.hypothesis}</p>
              {run.refinement_instruction && (
                <div className="mt-2 flex items-start gap-1.5 text-xs text-foreground/70">
                  <Sparkles className="mt-0.5 h-3 w-3 flex-shrink-0 text-accent" />
                  <span>
                    <span className="font-mono uppercase tracking-wider text-muted-foreground">
                      Refinement:
                    </span>{" "}
                    {run.refinement_instruction}
                  </span>
                </div>
              )}
            </div>
            <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2 no-print">
              {isOwner && run.status === "done" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={onShare}
                >
                  {shareCopied ? (
                    <Check className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <Share2 className="h-3.5 w-3.5" />
                  )}
                  {shareCopied ? "Copied" : "Share"}
                </Button>
              )}
              {canRefine && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setRefineOpen(true)}
                >
                  <Sparkles className="h-3.5 w-3.5" /> Refine
                </Button>
              )}
            </div>
          </div>
        </div>

        {versions.length > 1 && (
          <div className="mb-6 no-print">
            <VersionSwitcher versions={versions} currentId={run.id} />
          </div>
        )}

        {run.status === "failed" && (() => {
          const parsed = parseRunError(run.error);
          const canRetry = isOwner && isRetryable(parsed.kind);
          return (
            <div className="paper-surface rounded-lg p-6 mb-6">
              <div className="flex items-center gap-2">
                <h2 className="font-serif text-lg text-destructive">Run failed</h2>
                <span className="rounded-sm bg-destructive/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-destructive">
                  {parsed.kind.toLowerCase().replace("_", " ")}
                </span>
              </div>
              <p className="mt-2 text-sm text-foreground/80">{parsed.message}</p>
              <p className="mt-1 text-xs text-muted-foreground">{hintForKind(parsed.kind)}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {canRetry && (
                  <Button size="sm" className="gap-2" onClick={onRetry} disabled={retrying}>
                    {retrying ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" />
                    )}
                    {retrying ? "Retrying…" : "Retry"}
                  </Button>
                )}
                <Link to="/">
                  <Button variant="outline" size="sm" className="gap-2">
                    New experiment
                  </Button>
                </Link>
              </div>
            </div>
          );
        })()}

        {inFlight && stalled && (
          <div className="mb-6 rounded-md border border-warning/40 bg-warning/10 p-4 no-print">
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-warning">
              Generation stalled
            </h2>
            <p className="mt-1 text-sm text-foreground/80">
              No progress for over 90 seconds. The model may have hung. You can wait a bit
              longer or start over.
            </p>
            <Link to="/" className="mt-3 inline-block">
              <Button variant="outline" size="sm" className="gap-2">
                <RotateCcw className="h-3.5 w-3.5" /> Start a new run
              </Button>
            </Link>
          </div>
        )}

        {(() => {
          // Find the previous version's plan for diff badges in ExperimentPlanView.
          const prevVersion = versions
            .filter((v) => v.version < run.version && v.id !== run.id)
            .sort((a, b) => b.version - a.version)[0];
          const previousPlan = (prevVersion as unknown as { plan?: ExperimentPlan } | undefined)?.plan ?? null;
          const refinementCtx = run.refinement_instruction && run.version > 1
            ? { fromVersion: run.version - 1, toVersion: run.version, instruction: run.refinement_instruction }
            : null;
          return (
            <div className="space-y-6">
              {run.qc && (
                <ErrorBoundary label="the literature review">
                  <LiteratureQCCard qc={run.qc} />
                </ErrorBoundary>
              )}
              {inFlight && !run.qc && <GenerationProgress stage="qc" refinement={refinementCtx} />}
              {inFlight && run.qc && !run.plan && <GenerationProgress stage="plan" refinement={refinementCtx} />}
              {run.plan && run.solicit_section && run.solicit_reason && isOwner && (
                <SolicitationBanner
                  runId={run.id}
                  ownerUserId={run.owner_user_id}
                  hypothesis={run.hypothesis}
                  domain={run.plan.domain}
                  section={run.solicit_section}
                  reason={run.solicit_reason}
                />
              )}
              {run.plan && (
                <ErrorBoundary label="the experiment plan">
                  <ExperimentPlanView
                    plan={run.plan}
                    previousPlan={previousPlan}
                    hypothesis={run.hypothesis}
                    version={run.version}
                    runId={run.id}
                    ownerUserId={run.owner_user_id}
                    appliedFeedback={run.applied_feedback ?? null}
                  />
                </ErrorBoundary>
              )}
              {run.critique && (
                <ErrorBoundary label="the peer review">
                  <PlanCritiqueCard critique={run.critique} />
                </ErrorBoundary>
              )}
            </div>
          );
        })()}
      </main>

      {canRefine && (
        <RefineDialog
          open={refineOpen}
          onOpenChange={setRefineOpen}
          parentRunId={run.id}
          hypothesis={run.hypothesis}
        />
      )}
    </div>
  );
};

export default RunPage;
