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

describe("ExperimentPlanView version comparison", () => {
  it("names the version a refinement is compared with, and marks changed sections", () => {
    const refined: ExperimentPlan = {
      ...plan,
      budget: { currency: "USD", line_items: [{ category: "Reagents", amount_usd: 90 }], total_usd: 90 },
    };
    render(
      <MemoryRouter>
        <ExperimentPlanView plan={refined} previousPlan={plan} previousVersion={1} hypothesis="h" version={4} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Comparing to v1/i)).toBeTruthy();
    // Only the budget changed (the section may render more than once, e.g.
    // for print), so every "Modified" badge belongs to the Budget section.
    const badges = screen.getAllByText(/Modified/i);
    expect(badges.length).toBeGreaterThan(0);
    for (const b of badges) expect(b.closest("section,div")?.textContent).toMatch(/Budget/);
  });
});

// QA round 1 (9 Nov 2026): run b1cd3e59 had 0 retrieved papers yet showed
// three model-made URLs as step sources, and its total ($10,233) was not the
// sum of its line items ($12,133). Plans saved before the server-side guards
// existed must be shown corrected too.
describe("ExperimentPlanView integrity checks", () => {
  const legacy: ExperimentPlan = {
    ...plan,
    protocol: [
      { step: 1, title: "Seed", description: "Seed cells.", duration: "1 day", source: "https://www.biorxiv.org/content/10.1101/2020.01.09.925616v1" },
      { step: 2, title: "Treat", description: "Add NR.", duration: "1 day", source: "see [1]" },
    ],
    budget: {
      currency: "USD",
      line_items: [
        { category: "Reagents", amount_usd: 1013 }, { category: "Equipment", amount_usd: 120 },
        { category: "Labour", amount_usd: 10000 }, { category: "Overhead", amount_usd: 1000 },
      ],
      total_usd: 10233,
    },
  };
  const refs = [{ title: "Nicotinamide riboside is uniquely and orally bioavailable", year: 2016, url: "https://doi.org/10.1038/ncomms12948" }];

  it("hides sources that are not retrieved references and labels the real one", () => {
    render(<MemoryRouter><ExperimentPlanView plan={legacy} references={refs} hypothesis="h" /></MemoryRouter>);
    // The plan body can render more than once (as in the version test above).
    const sources = [...new Set(screen.getAllByTestId("step-source").map((e) => e.textContent))];
    expect(sources).toEqual(["↳ [1] Nicotinamide riboside is uniquely and orally bioavailable (2016)"]);
    expect(document.body.textContent).not.toContain("biorxiv");
  });

  it("shows the sum of the line items as the total and names the model's figure", () => {
    render(<MemoryRouter><ExperimentPlanView plan={legacy} references={[]} hypothesis="h" /></MemoryRouter>);
    expect(screen.getAllByTestId("budget-total")[0].textContent).toBe("$12,133");
    expect(screen.getAllByTestId("budget-model-total")[0].textContent).toMatch(/\$10,233/);
    const checks = screen.getAllByTestId("plan-checks")[0].textContent ?? "";
    expect(checks).toMatch(/\$10,233/);
    expect(checks).toMatch(/2 protocol source\(s\)/);
  });

  it("lists the server's findings for a checked plan", () => {
    const checked: ExperimentPlan = {
      ...plan,
      verification: { issues: [{ kind: "refinement_budget_not_met", severity: "high", detail: "The refinement asked for a budget of at most $3,000; this plan totals $16,235." }] },
    };
    render(<MemoryRouter><ExperimentPlanView plan={checked} hypothesis="h" /></MemoryRouter>);
    expect(screen.getAllByTestId("plan-checks")[0].textContent).toContain("at most $3,000");
  });

  it("shows no checks card for a consistent plan", () => {
    renderView();
    expect(screen.queryByTestId("plan-checks")).toBeNull();
  });
});
