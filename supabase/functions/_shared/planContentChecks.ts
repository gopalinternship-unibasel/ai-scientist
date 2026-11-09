// Content checks on a generated plan that need no model: doses that drift
// from the hypothesis, protocol steps that are only material lists, and
// catalog numbers that belong to another product. planGuards.ts turns their
// findings into plan.verification issues.
//
// Background (QA round 2, 9 Nov 2026, default local model qwen2.5:3b, runs
// 020ae70a / b4665175 / 6d59fa73):
//  - v3 of the metformin plan changed the hypothesis' 10 uM metformin to
//    "Add 10 mM metformin" (1000x) and nothing flagged it;
//  - all five protocol steps of v2 were material lists ("Metformin (100 mL,
//    10 mM) and DMEM (500 mL) with FBS (500 mL)");
//  - catalog numbers were copied from the planner prompt's examples
//    (Metformin T9531 = D-(+)-trehalose dihydrate, HepG2 CRL-3216 = HEK293T)
//    and were caught only in the reviewer critique.
// Import-free apart from the local catalog dictionary.

import { findCatalogIssues } from "./catalogCheck.ts";

// --- doses ------------------------------------------------------------------

type Dimension = "molar" | "mass_per_volume" | "mass_per_kg" | "percent";

export interface Dose {
  /** Lower-cased first word of the substance ("metformin"). */
  substance: string;
  /** As written ("10 uM"). */
  text: string;
  /** Value in the dimension's base unit (M, g/L, mg/kg, %). */
  value: number;
  dim: Dimension;
}

const UNIT_FACTORS: Record<string, { dim: Dimension; f: number }> = {
  pm: { dim: "molar", f: 1e-12 },
  nm: { dim: "molar", f: 1e-9 },
  um: { dim: "molar", f: 1e-6 },
  mm: { dim: "molar", f: 1e-3 },
  m: { dim: "molar", f: 1 },
  "ng/ml": { dim: "mass_per_volume", f: 1e-6 },
  "ug/ml": { dim: "mass_per_volume", f: 1e-3 },
  "mg/ml": { dim: "mass_per_volume", f: 1 },
  "g/l": { dim: "mass_per_volume", f: 1 },
  "mg/l": { dim: "mass_per_volume", f: 1e-3 },
  "ug/l": { dim: "mass_per_volume", f: 1e-6 },
  "mg/kg": { dim: "mass_per_kg", f: 1 },
  "ug/kg": { dim: "mass_per_kg", f: 1e-3 },
  "%": { dim: "percent", f: 1 },
};

// Number + concentration unit. Case matters for molar units in plain text
// (mM vs M), so the unit is matched case-insensitively and checked below.
const DOSE_RE = /(\d+(?:\.\d+)?)\s*(pM|nM|[µμu]M|mM|M|ng\/mL|[µμu]g\/mL|mg\/mL|g\/L|mg\/L|[µμu]g\/L|mg\/kg|[µμu]g\/kg|%)(?![A-Za-z])/g;

const NOT_SUBSTANCE = new Set([
  "of", "the", "a", "an", "and", "or", "to", "in", "for", "with", "at", "by", "final", "stock", "working",
  "concentration", "concentrations", "solution", "solutions", "dose", "doses", "each", "per", "cells",
  "cell", "medium", "media", "serum", "fbs", "glucose", "o2", "co2", "humidity", "confluence", "confluent",
  "ethanol", "dmso", "v/v", "w/v", "increase", "reduction", "decrease", "higher", "lower", "least",
  "compared", "than", "more", "less", "over", "under", "below", "above", "within", "after", "before",
]);

function unitKey(raw: string): string {
  return raw.replace(/[µμ]/g, "u").toLowerCase();
}

function parseDose(num: string, unit: string, substance: string): Dose | null {
  const key = unitKey(unit);
  // "M" alone is molar only when written as a capital M.
  if (key === "m" && unit !== "M") return null;
  const u = UNIT_FACTORS[key];
  if (!u) return null;
  const v = Number(num);
  if (!Number.isFinite(v) || v <= 0) return null;
  return { substance, text: `${num} ${unit.replace(/[µμ]/g, "u")}`, value: v * u.f, dim: u.dim };
}

function substanceWord(s: string): string | null {
  const w = s.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9+-]+$/g, "");
  if (w.length < 3 || NOT_SUBSTANCE.has(w) || /^\d/.test(w)) return null;
  return w;
}

/**
 * Concentrations in a text with the substance they belong to: the word right
 * after the number ("10 uM metformin", "0.5 mM of palmitate"), or the word
 * before it when the concentration is attached to it ("metformin (10 uM)",
 * "metformin at 10 uM", "Metformin (100 mL, 10 mM)"). Percentages need a
 * following substance ("by at least 30%" is an effect size). With
 * `skipStock`, concentrations next to the word "stock" are left out.
 */
function attachedDoses(text: string, skipStock: boolean): Dose[] {
  const out: Dose[] = [];
  for (const m of (text ?? "").matchAll(DOSE_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (skipStock && /stock/i.test(text.slice(Math.max(0, start - 20), end + 30))) continue;
    const after = text.slice(end).match(/^\s+(?:of\s+)?([A-Za-z][\w+-]*)/);
    const head = text.slice(0, start);
    const beforeWords = m[2] === "%" ? [] : [
      head.match(/([A-Za-z][\w+-]*)\s*(?:\(|at\s+|,\s*)$/)?.[1],
      head.match(/([A-Za-z][\w+-]*)\s*\([^()]*$/)?.[1],
    ];
    const subj = (after && substanceWord(after[1]))
      || beforeWords.map((w) => (w ? substanceWord(w) : null)).find((w) => w) || null;
    if (!subj) continue;
    const d = parseDose(m[1], m[2], subj);
    if (d) out.push(d);
  }
  return out;
}

/** Doses the hypothesis states ("10 uM metformin", "0.5 mM palmitate"). */
export function hypothesisDoses(hypothesis: string): Dose[] {
  const out: Dose[] = [];
  for (const d of attachedDoses(hypothesis, false)) {
    if (!out.some((o) => o.substance === d.substance && o.dim === d.dim && Math.abs(o.value - d.value) < 1e-15)) out.push(d);
  }
  return out;
}

export interface DoseIssue {
  substance: string;
  hypothesis: string;
  plan: string[];
}

/**
 * Doses in the protocol that contradict the hypothesis: the protocol gives
 * the substance concentrations of the same kind (molar, mass per volume,
 * ...) and none of them is within 1.5x of the hypothesis' dose. Stock
 * concentrations are ignored (a 10 mM stock diluted to 10 uM is fine), and
 * so are the materials (they list stock solutions).
 */
export function doseIssues(hypothesis: string, steps: { title?: string; description?: string }[] | undefined): DoseIssue[] {
  const doses = hypothesisDoses(hypothesis);
  if (doses.length === 0 || !Array.isArray(steps)) return [];
  const planDoses = steps.flatMap((s) => attachedDoses(`${s?.title ?? ""}. ${s?.description ?? ""}`, true));
  const issues: DoseIssue[] = [];
  for (const d of doses) {
    const seen = planDoses.filter((v) => v.substance === d.substance && v.dim === d.dim);
    if (seen.length === 0) continue;
    const matches = seen.some((v) => v.value / d.value <= 1.5 && d.value / v.value <= 1.5);
    if (!matches) {
      issues.push({ substance: d.substance, hypothesis: d.text, plan: [...new Set(seen.map((v) => v.text))] });
    }
  }
  return issues;
}

// --- protocol steps -----------------------------------------------------------

// Verbs a protocol step is written with (base forms; -s/-ed/-ing also count).
const ACTION_VERBS = new Set([
  "add", "incubate", "seed", "plate", "treat", "wash", "rinse", "stain", "fix", "permeabilize", "block",
  "culture", "grow", "maintain", "passage", "split", "thaw", "freeze", "harvest", "collect", "centrifuge",
  "spin", "pellet", "resuspend", "dilute", "dissolve", "prepare", "mix", "vortex", "transfer", "aspirate",
  "remove", "replace", "discard", "measure", "quantify", "quantitate", "read", "record", "image",
  "photograph", "scan", "count", "analyze", "analyse", "calculate", "compute", "normalize", "normalise",
  "compare", "extract", "lyse", "homogenize", "isolate", "purify", "elute", "load", "run", "perform",
  "apply", "expose", "starve", "challenge", "stimulate", "supplement", "inject", "administer", "dose",
  "feed", "sacrifice", "euthanize", "dissect", "weigh", "label", "transfect", "transduce", "infect",
  "sort", "select", "screen", "assay", "test", "validate", "verify", "check", "monitor", "observe",
  "assess", "determine", "evaluate", "detect", "visualize", "develop", "probe", "hybridize", "amplify",
  "sequence", "clone", "ligate", "digest", "coat", "dry", "heat", "cool", "store", "aliquot", "filter",
  "sterilize", "autoclave", "sonicate", "shake", "agitate", "equilibrate", "calibrate", "titrate",
  "adjust", "set", "use", "keep", "leave", "allow", "repeat", "conduct", "carry", "follow", "obtain",
  "order", "receive", "expand", "differentiate", "induce", "knock", "deliver", "pipette", "dispense",
  "fill", "seal", "cover", "invert", "place", "put", "pour", "cut", "grind", "synthesize", "fabricate",
  "deposit", "anneal", "cycle", "charge", "discharge", "assemble", "characterize", "report", "plot",
  "fit", "model", "estimate", "randomize", "randomise", "blind", "split", "pool", "combine", "inoculate",
  "spread", "streak", "pick", "subculture", "trypsinize", "detach", "neutralize", "quench", "stop",
  "start", "begin", "continue", "change", "refresh", "image", "acquire", "export", "document",
]);

function hasActionVerb(text: string): boolean {
  for (const raw of (text ?? "").toLowerCase().split(/[^a-z]+/)) {
    if (!raw) continue;
    if (ACTION_VERBS.has(raw)) return true;
    const stems = [raw.replace(/s$/, ""), raw.replace(/es$/, ""), raw.replace(/ed$/, ""), raw.replace(/d$/, ""),
      raw.replace(/ing$/, ""), raw.replace(/ing$/, "e"), raw.replace(/ied$/, "y"), raw.replace(/ies$/, "y"),
      raw.replace(/([a-z])\1ed$/, "$1"), raw.replace(/([a-z])\1ing$/, "$1")];
    if (stems.some((s) => s.length >= 3 && ACTION_VERBS.has(s))) return true;
  }
  return false;
}

export interface StepListIssue {
  /** 1-based step numbers whose description says nothing to do. */
  steps: number[];
  total: number;
  example: string;
}

/**
 * Protocol steps that are only material lists: the description has no
 * action verb. Flagged when that is true of at least half of the steps
 * (and at least two).
 */
export function materialListSteps(steps: { title?: string; description?: string }[] | undefined): StepListIssue | null {
  if (!Array.isArray(steps) || steps.length === 0) return null;
  const bad: number[] = [];
  steps.forEach((s, i) => {
    const d = (s?.description ?? "").trim();
    if (!d || !hasActionVerb(d)) bad.push(i + 1);
  });
  if (bad.length < 2 || bad.length * 2 < steps.length) return null;
  const ex = (steps[bad[0] - 1]?.description ?? "").trim();
  return { steps: bad, total: steps.length, example: ex.length > 90 ? `${ex.slice(0, 87)}...` : ex };
}

// --- catalog numbers ------------------------------------------------------------

export interface MaterialWithCatalog {
  name?: string;
  supplier?: string;
  catalog_number?: string;
  notes?: string;
  [key: string]: unknown;
}

export interface LiveSkuFinding {
  material_index: number;
  catalog_number: string;
  supplier_hint?: string;
}

export interface CatalogRemoval {
  name: string;
  catalog_number: string;
  why: string;
}

/**
 * Remove catalog numbers that are known to be wrong: the local dictionary
 * says the number is another product, the number does not have the
 * supplier's format, or the supplier's live catalog (Sigma-Aldrich through
 * PubChem, run before this) lists it under an unrelated name. The material
 * keeps its name and price; its notes say what was removed. A wrong number
 * is worse than none: someone would order it.
 */
export function removeWrongCatalogNumbers<M extends MaterialWithCatalog>(
  materials: M[] | undefined,
  live: LiveSkuFinding[] = [],
): { materials: M[]; removed: CatalogRemoval[] } {
  if (!Array.isArray(materials)) return { materials: [], removed: [] };
  const why = new Map<number, string>();
  for (const i of findCatalogIssues(materials)) {
    why.set(i.material_index, i.reason === "format_mismatch"
      ? `not in ${materials[i.material_index]?.supplier ?? "the supplier"}'s catalog-number format`
      : `it is ${i.canonical_name}`);
  }
  for (const s of live) {
    if (!why.has(s.material_index)) {
      why.set(s.material_index, s.supplier_hint ? s.supplier_hint.replace(/\.$/, "") : "the supplier lists it as another product");
    }
  }
  const removed: CatalogRemoval[] = [];
  const out = materials.map((m, i) => {
    const reason = why.get(i);
    const cat = (m?.catalog_number ?? "").toString().trim();
    if (!reason || !cat) return m;
    removed.push({ name: m?.name ?? `material ${i + 1}`, catalog_number: cat, why: reason });
    const copy = { ...m };
    delete copy.catalog_number;
    copy.notes = `${m?.notes ? `${m.notes} ` : ""}(Catalog number ${cat} removed by the automated check: ${reason}.)`;
    return copy;
  });
  return { materials: out, removed };
}
