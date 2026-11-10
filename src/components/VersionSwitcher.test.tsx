import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { VersionSwitcher, type VersionEntry } from "./VersionSwitcher";

// QA round 3: v3 was a refinement of v2, and v1 was then refined again (v4).
const versions: VersionEntry[] = [
  { id: "a", version: 1, refinement_instruction: null, created_at: "2026-11-10T01:00:00Z", status: "done", parent_run_id: null },
  { id: "b", version: 2, refinement_instruction: "Keep the total budget under $3,000.", created_at: "2026-11-10T02:00:00Z", status: "done", parent_run_id: "a" },
  { id: "c", version: 3, refinement_instruction: "Shorten the overall timeline to 2 weeks.", created_at: "2026-11-10T03:00:00Z", status: "done", parent_run_id: "b" },
  { id: "d", version: 4, refinement_instruction: "Use 96-well plates.", created_at: "2026-11-10T04:00:00Z", status: "failed", parent_run_id: "a" },
];

describe("VersionSwitcher", () => {
  it("shows every version of the chain, refinements of refinements included", () => {
    render(<MemoryRouter><VersionSwitcher versions={versions} currentId="c" /></MemoryRouter>);
    expect(screen.getByText(/Versions \(4\)/)).toBeTruthy();
    for (const v of ["v1", "v2", "v3", "v4"]) expect(screen.getByText(v)).toBeTruthy();
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });
  it("says which version a branch was refined from", () => {
    render(<MemoryRouter><VersionSwitcher versions={versions} currentId="a" /></MemoryRouter>);
    expect(screen.getByText("from v1")).toBeTruthy();
    expect(screen.queryByText("from v2"), "v3 follows v2 directly").toBeNull();
    expect(screen.getByText("failed")).toBeTruthy();
  });
});
