import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ExperimentPlan } from "@/lib/samples";
import { ExperimentPlanView } from "./ExperimentPlanView";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/exportPdf", () => ({ exportPlanToPdf: vi.fn() }));

// Smallest complete plan the view renders.
const plan: ExperimentPlan = {
  title: "Trehalose vs DMSO cryopreservation of HeLa cells",
  domain: "cell-biology",
  summary: "Compare post-thaw viability.",
  hypothesis_restated: "Trehalose raises post-thaw viability by 15 points.",
  success_criteria: ["Viability difference of at least 15 points"],
  protocol: [{ step: 1, title: "Freeze", description: "Freeze cells at -1 C/min [1].", duration: "1 day" }],
  materials: [{ name: "D-(+)-Trehalose dihydrate", supplier: "Sigma-Aldrich", catalog_number: "T9531", quantity: "25 g", unit_cost_usd: 120, total_cost_usd: 120 }],
  budget: { currency: "USD", line_items: [{ category: "Reagents", amount_usd: 120 }], total_usd: 120 },
  timeline: [{ phase: "Freeze and thaw", duration: "2 weeks", deliverables: ["Viability data"] }],
  validation: { approach: "Trypan blue counts", primary_metric: "Viability (%)", controls: ["10% DMSO"] },
  risks: [{ risk: "Contamination", mitigation: "Aseptic technique" }],
  team: [{ role: "Research associate", fte: 0.5 }],
};

const renderView = (onShare?: () => void) => render(
  <MemoryRouter>
    <ExperimentPlanView plan={plan} hypothesis="h" version={1} onShare={onShare} />
  </MemoryRouter>,
);

describe("ExperimentPlanView share button", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  beforeEach(() => {
    Object.values(toast).forEach((f) => f.mockReset());
    writeText.mockClear();
    Object.assign(navigator, { clipboard: { writeText } });
  });
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("uses the owner's share-link handler when RunPage provides one", () => {
    const onShare = vi.fn();
    renderView(onShare);
    fireEvent.click(screen.getByRole("button", { name: /share/i }));
    expect(onShare).toHaveBeenCalledOnce();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("refuses to copy a private link that others could not open", () => {
    window.history.replaceState(null, "", "/runs/abc");
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /share/i }));
    expect(writeText).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/sign in/i));
  });

  it("copies the current link when it already carries a share token", async () => {
    window.history.replaceState(null, "", "/runs/abc?t=tok123");
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /share/i }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/runs/abc?t=tok123")));
  });
});
