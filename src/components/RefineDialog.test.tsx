import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import type { RunStreamEvent } from "@/lib/runStream";
import { RefineDialog } from "./RefineDialog";

// The server emits `run` (and, for refinements, `qc`) and then closes the
// stream: the plan arrives later on the run page. The dialog must hand off on
// `run` instead of waiting for `plan`/`done` events that never come.
const startRunStream = vi.fn();
vi.mock("@/lib/runStream", () => ({
  startRunStream: (args: unknown) => startRunStream(args),
}));
vi.mock("@/hooks/useBackgroundRunNotifier", () => ({ trackRun: vi.fn() }));
vi.mock("@/lib/owner", () => ({ getOwnerToken: () => "owner-token" }));

const RunStub = () => <div>run page {useParams().id}</div>;

describe("RefineDialog", () => {
  beforeEach(() => startRunStream.mockReset());

  it("navigates to the new version as soon as the server creates it", async () => {
    startRunStream.mockImplementation(async ({ onEvent }: { onEvent: (e: RunStreamEvent) => void }) => {
      onEvent({ type: "run", id: "11111111-2222-4333-8444-555555555555", cached: false });
      onEvent({ type: "qc", qc: { signal: "similar", rationale: "r", references: [] } as never });
      // stream ends here, exactly like the edge function
    });
    const onOpenChange = vi.fn();
    render(
      <MemoryRouter initialEntries={["/runs/parent"]}>
        <Routes>
          <Route
            path="/runs/parent"
            element={<RefineDialog open onOpenChange={onOpenChange} parentRunId="parent" hypothesis="h" />}
          />
          <Route path="/runs/:id" element={<RunStub />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText(/instruction/i), { target: { value: "Keep total budget under $5,000." } });
    fireEvent.click(screen.getByRole("button", { name: /refine plan/i }));
    await waitFor(() => expect(screen.getByText(/run page 11111111-2222-4333-8444-555555555555/)).toBeInTheDocument());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(startRunStream).toHaveBeenCalledWith(expect.objectContaining({
      parentRunId: "parent",
      refinementInstruction: "Keep total budget under $5,000.",
    }));
  });
});
