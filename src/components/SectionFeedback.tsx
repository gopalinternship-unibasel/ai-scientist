// Per-section feedback control. Lets a scientist rate a specific section
// (1–5 stars) and submit a structured correction. Submissions feed the
// cross-run learning loop: future plans for similar experiments retrieve
// these corrections as few-shot guidance for the planner.
import { useState } from "react";
import { MessageSquarePlus, Star, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { getOwnerToken } from "@/lib/owner";

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

export const SectionFeedback = ({
  runId, section, domain, hypothesis, ownerUserId, compact = true,
}: Props) => {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [correction, setCorrection] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const reset = () => {
    setRating(null);
    setCorrection("");
    setSubmitted(false);
  };

  const submit = async () => {
    if (rating == null && !correction.trim()) {
      toast.error("Add a rating or a correction");
      return;
    }
    setSubmitting(true);
    try {
      const ownerToken = getOwnerToken();
      const payload: Record<string, unknown> = {
        run_id: runId,
        section,
        rating,
        correction: correction.trim() || null,
        domain: domain ?? null,
        hypothesis_excerpt: (hypothesis ?? "").slice(0, 500) || null,
        owner_token: ownerToken,
        owner_user_id: ownerUserId ?? null,
      };
      const { error } = await supabase
        .from("plan_feedback")
        // deno-lint-ignore no-explicit-any
        .insert(payload as any);
      if (error) throw error;
      setSubmitted(true);
      toast.success("Feedback recorded — future plans will learn from this.");
      setTimeout(() => { setOpen(false); reset(); }, 1200);
    } catch (e) {
      console.error("feedback insert failed", e);
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
              <div className="text-sm font-medium capitalize">{section} feedback</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Rate this section and/or describe what should change. Future plans for similar experiments will use this.
              </p>
            </div>

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
                Submit
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
};
