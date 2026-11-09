// Modal that lets a user submit a natural-language refinement against an existing
// plan (e.g. "keep budget under $5k"). Starts a new versioned run and navigates
// to it as soon as the server has created it; RunPage then shows the progress.
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { startRunStream } from "@/lib/runStream";
import { getOwnerToken } from "@/lib/owner";
import { trackRun } from "@/hooks/useBackgroundRunNotifier";

const QUICK_REFINEMENTS = [
  "Keep total budget under $5,000.",
  "Use a mouse model instead.",
  "Reduce timeline to under 4 weeks.",
  "Add stronger negative controls and an additional replicate group.",
  "Substitute equipment for items available in a typical academic lab (no specialised cores).",
  "Increase statistical power — target 95% power at α=0.05.",
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentRunId: string;
  hypothesis: string;
}

export const RefineDialog = ({ open, onOpenChange, parentRunId, hypothesis }: Props) => {
  const navigate = useNavigate();
  const [instruction, setInstruction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const submit = async () => {
    const trimmed = instruction.trim();
    if (trimmed.length < 5) {
      toast.error("Add a refinement instruction first.");
      return;
    }
    setSubmitting(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await startRunStream({
        hypothesis,
        ownerToken: getOwnerToken(),
        parentRunId,
        refinementInstruction: trimmed,
        signal: controller.signal,
        onEvent: (e) => {
          switch (e.type) {
            case "run":
              // The server persists the new version and keeps generating in
              // the background; the stream closes right after this event (the
              // plan arrives later via realtime/polling on RunPage). So hand
              // off to the new version's page now — waiting for `plan`/`done`
              // on this stream would leave the dialog spinning forever.
              trackRun({ id: e.id, hypothesis });
              setSubmitting(false);
              onOpenChange(false);
              navigate(`/runs/${e.id}`);
              break;
            case "error":
              toast.error(e.message);
              setSubmitting(false);
              break;
          }
        },
      });
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        toast.error("Could not start refinement.");
        setSubmitting(false);
      }
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && submitting) abortRef.current?.abort();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif">
            <Sparkles className="h-4 w-4 text-accent" /> Refine this plan
          </DialogTitle>
          <DialogDescription>
            Tell the AI what to change. It will generate a new version with the rest of the plan
            re-checked for consistency.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Quick refinements
            </div>
            <div className="flex flex-wrap gap-2">
              {QUICK_REFINEMENTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={submitting}
                  onClick={() => setInstruction((cur) => (cur ? `${cur} ${q}` : q))}
                  className="rounded-full border border-rule bg-paper px-3 py-1 text-xs text-foreground/80 transition-colors hover:bg-secondary disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label
              htmlFor="refine-instruction"
              className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground"
            >
              Instruction
            </label>
            <Textarea
              id="refine-instruction"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value.slice(0, 500))}
              disabled={submitting}
              placeholder="e.g. swap to a zebrafish model, keep budget under $3k, add a positive control…"
              className="mt-1 min-h-[100px] font-serif"
            />
            <div className="mt-1 text-right font-mono text-[10px] text-muted-foreground">
              {instruction.length}/500
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting} className="gap-2">
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating…
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" /> Refine plan
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
