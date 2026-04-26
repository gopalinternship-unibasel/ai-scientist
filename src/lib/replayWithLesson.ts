// Counterfactual replay — branch a new version of a run that incorporates
// a specific feedback correction as a refinement instruction.
//
// We re-use the existing refinement plumbing: the correction becomes the
// refinement_instruction on a child run, which the planner already knows
// how to honour. The diff between the original and new version is then
// visible via the existing VersionSwitcher.
import { toast } from "sonner";
import { startRunStream } from "@/lib/runStream";
import { getOwnerToken } from "@/lib/owner";
import { trackRun } from "@/hooks/useBackgroundRunNotifier";

export interface ReplayParams {
  parentRunId: string;
  hypothesis: string;
  section: string;
  correction: string;
  /** Called with the new run's id once the server has persisted it. */
  onCreated: (newRunId: string) => void;
  /** Called on completion or failure — caller flips a loading flag. */
  onSettled?: () => void;
  signal?: AbortSignal;
}

export async function replayWithLesson(p: ReplayParams) {
  const correction = p.correction.trim();
  if (!correction) {
    toast.error("This feedback has no text to apply.");
    p.onSettled?.();
    return;
  }
  // Compose a refinement instruction that frames the lesson concretely.
  const instruction = `Apply this user-supplied correction to the ${p.section.toUpperCase()} section, keeping the rest of the plan consistent: "${correction.slice(0, 400)}"`;

  let createdId: string | null = null;
  try {
    await startRunStream({
      hypothesis: p.hypothesis,
      ownerToken: getOwnerToken(),
      parentRunId: p.parentRunId,
      refinementInstruction: instruction,
      signal: p.signal,
      onEvent: (e) => {
        if (e.type === "run") {
          createdId = e.id;
          trackRun({ id: e.id, hypothesis: p.hypothesis });
          p.onCreated(e.id);
        } else if (e.type === "error") {
          toast.error(e.message);
          p.onSettled?.();
        }
      },
    });
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      console.error("replayWithLesson failed", err);
      toast.error("Could not start replay.");
      p.onSettled?.();
    }
  }
  if (!createdId) p.onSettled?.();
}
