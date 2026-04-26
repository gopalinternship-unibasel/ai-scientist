// Per-section feedback control. Lets a scientist rate a specific section
// (1–5 stars) and submit a structured correction. Submissions feed the
// cross-run learning loop: future plans for similar experiments retrieve
// these corrections as few-shot guidance for the planner.
//
// Owners can also edit or delete their previous feedback on this section
// (RLS-enforced server-side via owner_token / owner_user_id).
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquarePlus, Star, Check, Loader2, Pencil, Trash2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { getOwnerToken } from "@/lib/owner";
import { normalizeDomain, validateCorrection } from "@/lib/domainNormalize";
import { replayWithLesson } from "@/lib/replayWithLesson";

export type FeedbackSection =
  | "protocol" | "materials" | "budget" | "timeline"
  | "validation" | "safety" | "overall";

interface Props {
  runId: string;
  section: FeedbackSection;
  domain?: string | null;
  hypothesis?: string;
  ownerUserId?: string | null;
  /** When true, render as a compact icon button — used inline in section headers. */
  compact?: boolean;
}

interface ExistingFeedback {
  id: string;
  rating: number | null;
  correction: string | null;
}

export const SectionFeedback = ({
  runId, section, domain, hypothesis, ownerUserId, compact = true,
}: Props) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [correction, setCorrection] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [replaying, setReplaying] = useState(false);
  // Editing mode for an existing feedback row owned by this user.
  const [existing, setExisting] = useState<ExistingFeedback | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const startReplay = (text: string) => {
    if (replaying) return;
    setReplaying(true);
    replayWithLesson({
      parentRunId: runId,
      hypothesis: hypothesis ?? "",
      section,
      correction: text,
      onCreated: (newId) => {
        setOpen(false);
        toast.success("Re-running with this lesson…");
        navigate(`/runs/${newId}`);
      },
      onSettled: () => setReplaying(false),
    });
  };

  const reset = () => {
    setRating(null);
    setCorrection("");
    setSubmitted(false);
    setEditingId(null);
  };

  // When opened, look up the owner's most recent feedback on this section so
  // they can edit or delete it instead of being forced to add yet another row.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const ownerToken = getOwnerToken();
      const q = supabase
        .from("plan_feedback")
        .select("id, rating, correction")
        .eq("run_id", runId)
        .eq("section", section)
        .order("created_at", { ascending: false })
        .limit(1);
      // RLS already restricts to owner; the explicit filter is a small belt-
      // and-braces optimisation.
      const filtered = ownerUserId
        ? q.eq("owner_user_id", ownerUserId)
        : q.eq("owner_token", ownerToken);
      const { data, error } = await filtered;
      if (cancelled || error) return;
      setExisting(data?.[0] ?? null);
    })();
    return () => { cancelled = true; };
  }, [open, runId, section, ownerUserId]);

  const startEdit = () => {
    if (!existing) return;
    setEditingId(existing.id);
    setRating(existing.rating);
    setCorrection(existing.correction ?? "");
  };

  const remove = async () => {
    if (!existing) return;
    if (!confirm("Delete this feedback? It will no longer be used to guide future plans.")) return;
    const { error } = await supabase
      .from("plan_feedback")
      .delete()
      .eq("id", existing.id);
    if (error) {
      toast.error("Could not delete feedback");
      return;
    }
    toast.success("Feedback removed");
    setExisting(null);
    reset();
  };

  const submit = async () => {
    const trimmed = correction.trim();
    if (rating == null && !trimmed) {
      toast.error("Add a rating or a correction");
      return;
    }
    if (trimmed) {
      const reason = validateCorrection(trimmed);
      if (reason) { toast.error(reason); return; }
    }
    setSubmitting(true);
    try {
      const ownerToken = getOwnerToken();
      const canonicalDomain = normalizeDomain(domain, hypothesis);

      if (editingId) {
        // EDIT path — re-embed since the correction text may have changed.
        const { error } = await supabase
          .from("plan_feedback")
          .update({
            rating,
            correction: trimmed || null,
            // Clearing embedding triggers a fresh embed pass below; otherwise
            // the row would still match against the old text.
            embedding: null,
          })
          .eq("id", editingId);
        if (error) throw error;
        if (trimmed) {
          supabase.functions.invoke("embed-feedback", {
            body: { feedback_id: editingId },
          }).catch((e) => console.warn("embed-feedback invoke failed", e));
        }
      } else {
        // CREATE path
        const payload: Record<string, unknown> = {
          run_id: runId,
          section,
          rating,
          correction: trimmed || null,
          domain: canonicalDomain,
          hypothesis_excerpt: (hypothesis ?? "").slice(0, 500) || null,
          owner_token: ownerToken,
          owner_user_id: ownerUserId ?? null,
        };
        const { data: inserted, error } = await supabase
          .from("plan_feedback")
          // deno-lint-ignore no-explicit-any
          .insert(payload as any)
          .select("id")
          .single();
        if (error) throw error;
        if (inserted?.id) {
          supabase.functions.invoke("embed-feedback", {
            body: { feedback_id: inserted.id },
          }).catch((e) => console.warn("embed-feedback invoke failed", e));
        }
      }

      setSubmitted(true);
      toast.success(editingId
        ? "Feedback updated."
        : "Feedback recorded — future plans will learn from this.");
      setTimeout(() => { setOpen(false); reset(); }, 1200);
    } catch (e) {
      console.error("feedback save failed", e);
      toast.error("Could not save feedback");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size={compact ? "icon" : "sm"}
          className={compact
            ? "h-7 w-7 text-muted-foreground hover:text-foreground"
            : "gap-1.5 text-muted-foreground hover:text-foreground"}
          title={`Rate or correct this ${section} section`}
          aria-label={`Rate or correct this ${section} section`}
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          {!compact && <span className="text-xs">Feedback</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-4">
        {submitted ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Check className="h-4 w-4 text-primary" />
            Thanks — your correction is in the loop.
          </div>
        ) : (
          <>
            <div className="mb-3">
              <div className="text-sm font-medium capitalize">
                {editingId ? `Edit ${section} feedback` : `${section} feedback`}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Rate this section and/or describe what should change. Future plans for similar experiments will use this.
              </p>
            </div>

            {/* Existing-feedback banner: shown only when not already editing
                AND the owner has a previous row on this section. Gives them
                an explicit edit/delete affordance instead of silently
                creating duplicates. */}
            {existing && !editingId && (
              <div className="mb-3 rounded-md border border-border bg-muted/50 p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-medium text-muted-foreground">
                      Your previous feedback
                    </div>
                    {existing.rating != null && (
                      <div className="mt-0.5 flex items-center gap-0.5">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <Star
                            key={n}
                            className={`h-3 w-3 ${
                              n <= (existing.rating ?? 0)
                                ? "fill-primary text-primary"
                                : "text-muted-foreground/40"
                            }`}
                          />
                        ))}
                      </div>
                    )}
                    {existing.correction && (
                      <p className="mt-1 line-clamp-3 text-xs text-foreground/80">
                        {existing.correction}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={startEdit}
                      title="Edit"
                      aria-label="Edit feedback"
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive hover:text-destructive"
                      onClick={remove}
                      title="Delete"
                      aria-label="Delete feedback"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div className="mb-3 flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  className="rounded p-1 transition-colors hover:bg-muted"
                  aria-label={`Rate ${n} of 5`}
                >
                  <Star
                    className={`h-4 w-4 ${
                      rating != null && n <= rating
                        ? "fill-primary text-primary"
                        : "text-muted-foreground"
                    }`}
                  />
                </button>
              ))}
              {rating != null && (
                <button
                  type="button"
                  onClick={() => setRating(null)}
                  className="ml-1 text-[10px] text-muted-foreground underline-offset-2 hover:underline"
                >
                  clear
                </button>
              )}
            </div>

            <Textarea
              value={correction}
              onChange={(e) => setCorrection(e.target.value)}
              placeholder={
                section === "materials"
                  ? "e.g. Sigma R5010 is discontinued — use R3500 instead."
                  : section === "timeline"
                  ? "e.g. HeLa expansion needs 10 days, not 7."
                  : section === "budget"
                  ? "e.g. FBS price is closer to $650/500mL in 2024."
                  : "What's wrong, missing, or could be better?"
              }
              maxLength={2000}
              rows={4}
              className="text-sm"
            />

            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={submit} disabled={submitting}>
                {submitting && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                {editingId ? "Save changes" : "Submit"}
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
};
