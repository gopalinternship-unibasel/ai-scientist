export const SAMPLE_HYPOTHESES = [
  {
    category: "Diagnostics",
    plain: "Can we build a cheap, fast blood test for inflammation that works without lab equipment?",
    hypothesis:
      "A paper-based electrochemical biosensor functionalized with anti-CRP antibodies will detect C-reactive protein in whole blood at concentrations below 0.5 mg/L within 10 minutes, matching laboratory ELISA sensitivity without requiring sample preprocessing.",
  },
  {
    category: "Gut Health",
    plain: "Does a specific probiotic measurably strengthen the gut lining in mice?",
    hypothesis:
      "Supplementing C57BL/6 mice with Lactobacillus rhamnosus GG for 4 weeks will reduce intestinal permeability by at least 30% compared to controls, measured by FITC-dextran assay, due to upregulation of tight junction proteins claudin-1 and occludin.",
  },
  {
    category: "Cell Biology",
    plain: "Can we keep more cells alive when freezing them by swapping one preservative for another?",
    hypothesis:
      "Replacing sucrose with trehalose as a cryoprotectant in the freezing medium will increase post-thaw viability of HeLa cells by at least 15 percentage points compared to the standard DMSO protocol, due to trehalose's superior membrane stabilization at low temperatures.",
  },
  {
    category: "Climate",
    plain: "Can a specific microbe convert CO₂ into a useful chemical compound more efficiently than current methods?",
    hypothesis:
      "Introducing Sporomusa ovata into a bioelectrochemical system at a cathode potential of −400mV vs SHE will fix CO2 into acetate at a rate of at least 150 mmol/L/day, outperforming current biocatalytic carbon capture benchmarks by at least 20%.",
  },
] as const;

/** One finding of the server's deterministic plan guards (planGuards.ts). */
export interface PlanCheckIssue {
  kind: string;
  severity: "high" | "medium";
  detail: string;
}

export type ExperimentPlan = {
  /**
   * Written by run-experiment after generation: what the deterministic
   * guards fixed (sources, budget total) and flagged. Absent on plans saved
   * before 9 Nov 2026 and on the hand-written samples.
   */
  verification?: {
    issues: PlanCheckIssue[];
    budget?: { stated_total: number | null; line_item_sum: number; corrected: boolean } | null;
    sources?: { resolved: number; kept: number; removed: number; links_removed: number };
  };
  title: string;
  domain: string;
  summary: string;
  hypothesis_restated: string;
  success_criteria: string[];
  protocol: { step: number; title: string; description: string; duration: string; source?: string; applied_lessons?: string[] }[];
  materials: {
    name: string;
    supplier: string;
    catalog_number?: string;
    quantity: string;
    unit_cost_usd: number;
    total_cost_usd: number;
    notes?: string;
    applied_lessons?: string[];
  }[];
  budget: {
    currency: "USD";
    line_items: { category: string; amount_usd: number; note?: string }[];
    total_usd: number;
  };
  timeline: {
    phase: string;
    duration: string;
    deliverables: string[];
    dependencies?: string[];
  }[];
  validation: {
    approach: string;
    primary_metric: string;
    controls: string[];
    statistical_plan?: string;
  };
  /**
   * NEW (Batch B): structured statistical design so reviewers can sanity-check
   * power before the experiment runs.
   */
  statistical_design?: {
    n_per_group: number;
    groups: string[];
    primary_test: string;          // e.g. "two-sample t-test", "one-way ANOVA"
    effect_size: string;           // e.g. "Cohen's d = 0.8"
    alpha: number;
    power: number;                 // 0-1
    randomization: string;         // e.g. "block randomization, blocks of 4"
    blinding: string;              // e.g. "single-blind", "double-blind", "open-label"
    notes?: string;
  };
  /**
   * NEW (Batch B): safety / regulatory section. Always present; flags map to
   * the deterministic pre-screen done server-side.
   */
  safety?: {
    biosafety_level: "BSL-1" | "BSL-2" | "BSL-3" | "BSL-4" | "Not applicable";
    irb_required: boolean;
    iacuc_required: boolean;
    ibc_required: boolean;
    controlled_substances: boolean;
    hazards: string[];             // chemical / radiological / biological hazards
    ppe: string[];                 // required PPE per step
    waste_handling: string;
    emergency_procedure: string;
  };
  risks: { risk: string; mitigation: string; applied_lessons?: string[] }[];
  team: { role: string; fte: number }[];
};

export type LiteratureQC = {
  signal: "not_found" | "similar" | "exact_match";
  rationale: string;
  /** NEW (Batch B): which sources actually returned results for this query. */
  sources_used?: { s2: boolean; openalex: boolean; pubmed: boolean };
  /** NEW (Batch B): semantic-novelty signal computed independently of keyword overlap. */
  semantic_overlap?: "low" | "medium" | "high";
  references: {
    title: string;
    year?: number | null;
    authors?: string[];
    venue?: string | null;
    citationCount?: number | null;
    url?: string;
    /** NEW (Batch B): which source surfaced this paper. */
    source?: "s2" | "openalex" | "pubmed";
  }[];
};

export type PlanCritique = {
  overall_score: number;
  strengths: string[];
  concerns: {
    severity: "low" | "medium" | "high";
    area: string;
    issue: string;
    suggestion: string;
  }[];
  missing_controls: string[];
  statistical_notes: string;
  ethical_notes?: string;
};
