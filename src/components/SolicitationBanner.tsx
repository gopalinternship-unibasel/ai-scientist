// SolicitationBanner — surfaces an active feedback request from the planner
// when its deterministic pre-checks couldn't fully verify part of the plan
// (e.g. a SKU it couldn't confirm against the supplier's live catalog).
//
// We only show it to the run's owner, and only on a completed run. Dismissing
// is per-run via sessionStorage so it doesn't nag the user across reloads.
import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionFeedback, type FeedbackSection } from "./SectionFeedback";

interface Props {
  runId: string;
  ownerUserId: string | null;
  hypothesis: string;
  domain?: string | null;
  section: string;
  reason: string;
}

const VALID_SECTIONS: ReadonlyArray<FeedbackSection> = [
  "protocol", "materials", "budget", "timeline", "validation", "safety", "overall",
];

export const SolicitationBanner = ({
  runId, ownerUserId, hypothesis, domain, section, reason,
}: Props) => {
  const dismissKey = `solicit-dismissed-${runId}`;
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem(dismissKey) === "1";
  });

  if (dismissed) return null;
  // Only render when the section maps to a real feedback target.
  const fbSection = VALID_SECTIONS.includes(section as FeedbackSection)
    ? (section as FeedbackSection)
    : null;
  if (!fbSection) return null;

  const dismiss = () => {
    try { window.sessionStorage.setItem(dismissKey, "1"); } catch { /* ignore */ }
    setDismissed(true);
  };

  return (
    <div className="no-print flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 sm:p-4">
      <div className="mt-0.5 shrink-0 rounded-md bg-primary/10 p-1.5 text-primary">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">
          Help us improve future plans
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{reason}</p>
        <div className="mt-2 flex items-center gap-2">
          <SectionFeedback
            runId={runId}
            section={fbSection}
            domain={domain}
            hypothesis={hypothesis}
            ownerUserId={ownerUserId}
            compact={false}
          />
          <Button variant="ghost" size="sm" onClick={dismiss} className="text-xs">
            Not now
          </Button>
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={dismiss}
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
};
