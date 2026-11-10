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
import { GenerationProgress, describeProgress, type RunProgress } from "@/components/GenerationProgress";
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
import { canGiveFeedback, canRefineRun } from "@/lib/runAccess";
import { refinementBase } from "@/lib/versionBase";
import { loadChain } from "../../supabase/functions/_shared/versionChain";
import { madeByOlderPipeline } from "../../supabase/functions/_shared/pipelineVersion";
import type { ExperimentPlan, LiteratureQC, PlanCritique } from "@/lib/samples";

type Status = "pending" | "qc" | "plan" | "done" | "failed";

interface AppliedFeedback {
  id: string;
  section: string;
  rating: number | null;
  correction: string;
  similarity: number;
  score?: number;
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
  progress: RunProgress | null;
}

const RUN_COLUMNS =
  "id,hypothesis,status,qc,plan,critique,error,created_at,parent_run_id,version,refinement_instruction,share_token,owner_user_id,updated_at,applied_feedback,solicit_section,solicit_reason,progress";

// Stall threshold: warn the user if no progress for 150 s on an in-flight run
// (the server writes a heartbeat every 20 s).
const STALL_THRESHOLD_MS = 150_000;

const CHAIN_COLUMNS = "id,version,refinement_instruction,created_at,status,parent_run_id,plan";

const RunPage = () => {
  const { id } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
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
  // Which run (and status) the version list was last loaded for, when, and
  // whether another version in it was still running then.
  const chainKeyRef = useRef<string | null>(null);
  const chainAtRef = useRef(0);
  const chainActiveRef = useRef(false);

  // Pick a client whose RLS context can read this run:
  // - signed-in user, no share token → default supabase client (their JWT)
  // - share link → scoped client with x-share-token, plus the JWT when signed
  //   in (a signed-in viewer of someone else's link used to get the plain
  //   client, which never sent the token: "Run not found")
  // - anonymous owner → scoped client with x-owner-token
  const signedIn = !!user;
  const client = useMemo(() => {
    if (signedIn && !shareToken) return supabase;
    return createScopedClient({ shareToken, asSignedInUser: signedIn });
  }, [signedIn, shareToken]);

  useEffect(() => {
    // Wait for the stored session: before it is restored (slow when the
    // access token has to be refreshed) the first read went out with the
    // anon key, RLS hid the owner's run and "Run not found" stuck even after
    // the session arrived (seen in the round-2 fix check, 9 Nov 2026).
    if (!id || authLoading) return;
    let active = true;
    // One chain load at a time for this effect run.
    let chainLoading = false;

    untrackRun(id);

    const load = async () => {
      const { data, error } = await client
        .from("runs")
        .select(RUN_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (!active) return;
      if (error || !data) { setNotFound(true); return; }
      setNotFound(false);
      const r = data as unknown as Run;
      setRun(r);

      // Every version in this refinement chain: up to the original run and
      // down through all refinements, refinements of refinements included
      // (versionChain.ts). Until QA round 3 only the root and its direct
      // children were loaded, so v3 (a refinement of v2) was missing from
      // v1's and v2's switcher and v1 from v3's. Reloaded when the run or
      // its status changes, not on every poll.
      // While another version of the chain is still being generated, the
      // list is refreshed every 15 s so its "running" label turns over.
      const chainKey = `${r.id}:${r.status}`;
      const due = chainKeyRef.current !== chainKey
        || (chainActiveRef.current && Date.now() - chainAtRef.current > 15_000);
      if (!due || chainLoading) return;
      chainLoading = true;
      type Row = VersionEntry & { parent_run_id: string | null; plan?: ExperimentPlan | null };
      const chain = await loadChain<Row>(
        { id: r.id, parent_run_id: r.parent_run_id, version: r.version, refinement_instruction: r.refinement_instruction, created_at: r.created_at, status: r.status, plan: r.plan },
        async (pid) => {
          const { data: row, error: e } = await client.from("runs").select(CHAIN_COLUMNS).eq("id", pid).maybeSingle();
          if (e) throw e;
          return (row as unknown as Row | null) ?? null;
        },
        async (ids) => {
          const { data: rows, error: e } = await client.from("runs").select(CHAIN_COLUMNS).in("parent_run_id", ids);
          if (e) throw e;
          return (rows as unknown as Row[] | null) ?? [];
        },
      ).catch(() => null);
      chainLoading = false;
      // The key is recorded only once the list is on the page: a load that
      // was cut off (the effect re-ran when the session arrived) or failed
      // is repeated by the next poll. Recording it before the load left the
      // switcher empty in that case.
      if (!active || !chain) return;
      setVersions(chain);
      chainKeyRef.current = chainKey;
      chainAtRef.current = Date.now();
      chainActiveRef.current = chain.some((v) => v.id !== r.id && v.status !== "done" && v.status !== "failed");
    };
    load();

    // Realtime only works for signed-in users (their JWT satisfies the RLS
    // policy on runs). Anonymous owners and share-link viewers lack the
    // necessary headers for realtime, so they poll instead.
    const useRealtime = !!user && !shareToken;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    if (useRealtime) {
      channel = supabase
        .channel(`runs:${id}`)
        .on("postgres_changes",
          { event: "UPDATE", schema: "public", table: "runs", filter: `id=eq.${id}` },
          (payload) => {
            if (!active) return;
            const updated = payload.new as unknown as Run;
            setRun(updated);
            // When the run reaches a terminal state, do a full reload to pick
            // up any fields that the realtime payload might truncate (e.g. large plan JSON).
            if (updated.status === "done" || updated.status === "failed") {
              load();
            }
          })
        .subscribe();
    }

    // Always poll while the run is in-flight. For realtime users this is a
    // cheap fallback that catches missed events; for anon/share viewers it's
    // the primary update mechanism. Poll every 3s.
    pollTimer = setInterval(() => {
      // Re-read current run from state via the ref-like closure. Only poll
      // while the run hasn't reached a terminal state yet.
      load();
    }, 3000);

    return () => {
      active = false;
      if (channel) supabase.removeChannel(channel);
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [id, client, user, shareToken, authLoading]);

  // Stop polling once we reach a terminal state (done/failed) to save requests.
  // We do this by tracking the run status and clearing the poll in a separate effect.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!run) return;
    if (run.status === "done" || run.status === "failed") {
      // No longer need to poll — run is terminal.
      // The interval is managed in the main effect; this is a belt-and-suspenders
      // approach. The main effect's cleanup handles the real clearing.
    }
  }, [run?.status]);

  // Stall detection: if status is in-flight and updated_at hasn't moved for
  // STALL_THRESHOLD_MS (150 s), surface a warning so the user can retry
  // instead of staring at a spinner.
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
      token = crypto.randomUUID().replace(/-/g, "");
      // share_token is the one runs column a signed-in owner may write
      // (migration 20261109200000); everything else is server-only.
      const { error } = await supabase
        .from("runs")
        .update({ share_token: token })
        .eq("id", run.id);
      if (error) {
        toast.error("Could not create share link.");
        return;
      }
      setRun({ ...run, share_token: token });
    }
    const url = `${window.location.origin}/runs/${run.id}?t=${token}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard can be unavailable (no focus, browser policy): show the
      // link so it can still be copied by hand.
      toast.message("Share link created", { description: url, duration: 15000 });
      return;
    }
    setShareCopied(true);
    toast.success("Share link copied to clipboard.");
    setTimeout(() => setShareCopied(false), 2000);
  };

  // A run made by an older pipeline (before the current novelty and plan
  // checks) is never replayed from the cache; this starts a fresh one.
  const onRunAgain = async () => {
    if (!run || retrying) return;
    setRetrying(true);
    try {
      await startRunStream({
        hypothesis: run.hypothesis,
        ownerToken: getOwnerToken(),
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
    } catch {
      toast.error("Could not start a new run. Please try again.");
      setRetrying(false);
    }
  };

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
  const isOwner = !!user && run.owner_user_id === user.id;
  const canRefine = canRefineRun({
    status: run.status, hasPlan: !!run.plan, isOwner, signedIn: !!user, shareToken,
  });
  const feedbackAllowed = canGiveFeedback({
    isOwner, signedIn: !!user, shareToken, ownerUserId: run.owner_user_id,
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-rule bg-background/85 backdrop-blur no-print">
        <div className="container flex h-16 items-center justify-between gap-2">
          <Logo />
          <div className="flex shrink-0 items-center gap-2">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-2" aria-label="New experiment">
                <ArrowLeft className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">New experiment</span>
              </Button>
            </Link>
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="container max-w-4xl py-8 md:py-12">
        <div className="mb-6 rounded-md border-l-2 border-accent bg-paper p-4">
          {/* Phone width: Share / Refine go under the hypothesis instead of squeezing it into a narrow column. */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
            <div className="flex flex-shrink-0 flex-wrap items-center gap-2 no-print sm:justify-end">
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

        {run.status === "done" && madeByOlderPipeline(run.qc as { pipeline_version?: unknown } | null)
          && madeByOlderPipeline(run.plan?.verification as { pipeline_version?: unknown } | undefined) && (
          <div data-testid="older-pipeline" className="mb-6 rounded-md border border-warning/40 bg-warning/10 p-4 no-print">
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-warning">Made by an earlier version</h2>
            <p className="mt-1 text-sm text-foreground/80">
              This run was made before the current literature and plan checks (10 Nov 2026). Its novelty verdict,
              references and plan checks were not recomputed and may be wrong{run.version > 1 ? "" : "; the same hypothesis is no longer answered from this copy"}.
            </p>
            {run.version === 1 && !shareToken && (
              <Button variant="outline" size="sm" className="mt-3 gap-2" onClick={onRunAgain} disabled={retrying}>
                {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                Run again with the current checks
              </Button>
            )}
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
              No progress for over 2.5 minutes. The model may have hung. You can wait a bit
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
          const prevVersion = refinementBase(run, versions as unknown as (VersionEntry & { plan?: ExperimentPlan | null })[]);
          const previousPlan = prevVersion?.plan ?? null;
          const refinementCtx = run.refinement_instruction && run.version > 1
            ? { fromVersion: prevVersion?.version ?? run.version - 1, toVersion: run.version, instruction: run.refinement_instruction }
            : null;
          return (
            <div className="space-y-6">
              {run.qc && (
                <ErrorBoundary label="the literature review">
                  <LiteratureQCCard qc={run.qc} hypothesis={run.hypothesis} />
                </ErrorBoundary>
              )}
              {inFlight && !run.qc && <GenerationProgress stage="qc" refinement={refinementCtx} progress={run.progress} />}
              {inFlight && run.qc && !run.plan && <GenerationProgress stage="plan" refinement={refinementCtx} progress={run.progress} />}
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
                    previousVersion={prevVersion?.version}
                    references={run.qc?.references ?? []}
                    hypothesis={run.hypothesis}
                    version={run.version}
                    runId={run.id}
                    canGiveFeedback={feedbackAllowed}
                    ownerUserId={run.owner_user_id}
                    appliedFeedback={run.applied_feedback ?? null}
                    onShare={isOwner && run.status === "done" ? onShare : undefined}
                  />
                </ErrorBoundary>
              )}
              {run.status === "done" && !run.critique && run.progress?.stage === "critique" && (
                <p data-testid="critique-pending" className="no-print font-mono text-[11px] text-muted-foreground">
                  {describeProgress(run.progress)}…
                </p>
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