import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { LiteratureQCCard } from "./LiteratureQCCard";
import { readableRationale } from "@/lib/rationale";

describe("LiteratureQCCard rationale", () => {
  it("does not show 'Candidate N' from rationales saved before the server scrub (run b1cd3e59)", () => {
    const old = "Candidate 0 studies NAD metabolism in protein aggregation, Candidate 1 focuses on neuronal differentiation.";
    expect(readableRationale(old)).toBe("one of the retrieved papers studies NAD metabolism in protein aggregation, one of the retrieved papers focuses on neuronal differentiation.");
    const { container } = render(<LiteratureQCCard qc={{ signal: "not_found", rationale: old, references: [] }} />);
    expect(container.textContent).not.toMatch(/Candidate \d/);
  });

  it("leaves ordinary rationales alone", () => {
    expect(readableRationale("The thyroid cancer guideline covers the same intervention.")).toBe("The thyroid cancer guideline covers the same intervention.");
  });
});
