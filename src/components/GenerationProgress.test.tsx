import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GenerationProgress, describeProgress } from "./GenerationProgress";

describe("describeProgress", () => {
  it("is empty without a stage or once the run is complete", () => {
    expect(describeProgress(null)).toBeNull();
    expect(describeProgress({ stage: "complete" })).toBeNull();
  });

  it("describes the pre-plan stages", () => {
    expect(describeProgress({ stage: "gate" })).toMatch(/testable hypothesis/);
    expect(describeProgress({ stage: "literature" })).toMatch(/Semantic Scholar, OpenAlex and PubMed/);
    expect(describeProgress({ stage: "novelty", candidates: 8 })).toMatch(/\(8 candidates\)/);
  });

  it("reports streamed characters and the sections started so far", () => {
    const text = describeProgress({ stage: "planning", chars: 12345, sections: ["title", "hypothesis_restated", "success_criteria"] });
    expect(text).toContain("12,345 characters");
    expect(text).toContain("title, hypothesis, success criteria");
  });
});

describe("GenerationProgress", () => {
  it("renders the live progress line when the run reports one", () => {
    render(<GenerationProgress stage="plan" progress={{ stage: "planning", chars: 800, sections: ["title"], model: "qwen2.5:3b" }} />);
    expect(screen.getByTestId("live-progress")).toHaveTextContent("800 characters so far");
    expect(screen.getByTestId("live-progress")).toHaveTextContent("model qwen2.5:3b");
  });

  it("omits the live line when there is no progress yet", () => {
    render(<GenerationProgress stage="qc" />);
    expect(screen.queryByTestId("live-progress")).toBeNull();
  });
});
