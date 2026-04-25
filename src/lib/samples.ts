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

export type ExperimentPlan = {
  title: string;
  domain: string;
  summary: string;
  hypothesis_restated: string;
  success_criteria: string[];
  protocol: { step: number; title: string; description: string; duration: string; source?: string }[];
  materials: {
    name: string;
    supplier: string;
    catalog_number?: string;
    quantity: string;
    unit_cost_usd: number;
    total_cost_usd: number;
    notes?: string;
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
  risks: { risk: string; mitigation: string }[];
  team: { role: string; fte: number }[];
};

export type LiteratureQC = {
  signal: "not_found" | "similar" | "exact_match";
  rationale: string;
  references: {
    title: string;
    year?: number | null;
    authors?: string[];
    venue?: string | null;
    citationCount?: number | null;
    url?: string;
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
