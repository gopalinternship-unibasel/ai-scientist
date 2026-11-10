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

import { atccShaped, cellLineIn, dictionaryConfirms, findCatalogIssues, looksLikePlaceholder, plainCellLineIn } from "./catalogCheck.ts";

// --- doses ------------------------------------------------------------------

type Dimension = "molar" | "mass_per_volume" | "mass_per_kg" | "percent";

export interface Dose {
  /** Lower-cased first word of the substance ("metformin"). */
  substance: string;
  /** As written, with the unit in its usual case ("10 uM"). */
  text: string;
  /** Value in the dimension's base unit (M, g/L, mg/kg, %). */
  value: number;
  dim: Dimension;
}

const UNIT_FACTORS: Record<string, { dim: Dimension; f: number; shown: string }> = {
  pm: { dim: "molar", f: 1e-12, shown: "pM" },
  nm: { dim: "molar", f: 1e-9, shown: "nM" },
  um: { dim: "molar", f: 1e-6, shown: "uM" },
  mm: { dim: "molar", f: 1e-3, shown: "mM" },
  m: { dim: "molar", f: 1, shown: "M" },
  "ng/ml": { dim: "mass_per_volume", f: 1e-6, shown: "ng/mL" },
  "ug/ml": { dim: "mass_per_volume", f: 1e-3, shown: "ug/mL" },
  "mg/ml": { dim: "mass_per_volume", f: 1, shown: "mg/mL" },
  "g/l": { dim: "mass_per_volume", f: 1, shown: "g/L" },
  "mg/l": { dim: "mass_per_volume", f: 1e-3, shown: "mg/L" },
  "ug/l": { dim: "mass_per_volume", f: 1e-6, shown: "ug/L" },
  "mg/kg": { dim: "mass_per_kg", f: 1, shown: "mg/kg" },
  "ug/kg": { dim: "mass_per_kg", f: 1e-3, shown: "ug/kg" },
  "%": { dim: "percent", f: 1, shown: "%" },
};

// Micro: "u", the micro sign U+00B5, Greek mu U+03BC and its capital U+039C
// (an upper-cased "μM" is "ΜM").
const MU = "[uµμΜ]";
const CONC_UNIT = `pm|nm|${MU}m|mm|m|ng/ml|${MU}g/ml|mg/ml|g/l|mg/l|${MU}g/l|mg/kg|${MU}g/kg|%`;
// Number + concentration unit, in any case: "10 uM", "10 µM", "10 μM",
// "0.5 MM", "1 ΜM" (QA round 3: the pattern knew only the usual case).
const DOSE_RE = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${CONC_UNIT})(?![\\p{L}\\d])`, "giu");
const VOL_UNIT = `nl|${MU}l|ml|l`;
const VOL_FACTORS: Record<string, number> = { nl: 1e-9, ul: 1e-6, ml: 1e-3, l: 1 };

const NOT_SUBSTANCE = new Set([
  "of", "the", "a", "an", "and", "or", "to", "in", "for", "with", "at", "by", "final", "stock", "working",
  "concentration", "concentrations", "solution", "solutions", "dose", "doses", "each", "per", "cells",
  "cell", "medium", "media", "serum", "fbs", "glucose", "o2", "co2", "humidity", "confluence", "confluent",
  "ethanol", "dmso", "v/v", "w/v", "increase", "reduction", "decrease", "higher", "lower", "least",
  "compared", "than", "more", "less", "over", "under", "below", "above", "within", "after", "before",
  "dilution", "aliquot", "aliquots", "from", "into", "on", "was", "is", "are", "be", "then", "as",
]);
// Salt forms: "2 mM sodium butyrate" is about butyrate.
const COUNTER_ION = new Set(["sodium", "potassium", "chloride", "hydrochloride", "magnesium", "calcium", "salt", "lithium"]);
// Words that end the run of substance words after a dose.
const AFTER_STOP = new Set(["to", "into", "in", "for", "and", "with", "at", "on", "per", "by", "from", "was", "is", "then", "or", "until", "before", "after", "as"]);
// A molar unit is written with a capital M. With a lower-case m the same
// letters are a length or a time ("510 nm", "0.22 um filter", "35 mm dish",
// "2 pm"), which the any-case pattern of QA round 3 first read as doses
// ("0.22 uM palmitate" from "Filter the palmitate solution (0.22 um)"). A
// lower-case unit counts only when a substance follows it directly
// ("10 um metformin") and nothing after it is one of these.
const LOWER_M_UNIT = /^(?:p|n|m|[uµμΜ])m$/u;
const LENGTH_NOUNS = new Set([
  "filter", "filters", "pore", "pores", "membrane", "membranes", "mesh", "dish", "dishes", "plate", "plates",
  "well", "wells", "section", "sections", "slice", "slices", "thick", "thickness", "diameter", "wavelength",
  "excitation", "emission", "absorbance", "laser", "light", "bead", "beads", "particle", "particles",
  "tubing", "needle", "syringe", "coverslip", "coverslips", "glass", "path", "gap", "channel", "channels",
  "layer", "layers", "film", "cuvette", "column", "spacer", "sieve", "strainer", "insert", "inserts", "tube",
  "tubes", "tip", "tips", "grid", "aperture", "nozzle", "fiber", "fibre", "lattice", "lattices", "coating",
  "scaffold", "reader", "using", "use", "long", "wide", "deep", "apart", "daily",
]);

function unitKey(raw: string): string {
  return raw.replace(/[µμΜ]/g, "u").toLowerCase();
}

function norm(s: string): string {
  return (s ?? "").normalize("NFKC").replace(/[µμΜ]/g, "u").toLowerCase();
}

function volText(num: string, unit: string): string {
  const k = unitKey(unit);
  return `${num} ${k === "ul" ? "uL" : k === "ml" ? "mL" : k === "nl" ? "nL" : "L"}`;
}

function parseDose(num: string, unit: string, substance: string): Dose | null {
  const key = unitKey(unit);
  // "M" alone is molar only when written as a capital M ("5 m" is a length).
  if (key === "m" && unit !== "M") return null;
  const u = UNIT_FACTORS[key];
  if (!u) return null;
  const v = Number(num);
  if (!Number.isFinite(v) || v <= 0) return null;
  return { substance, text: `${num} ${u.shown}`, value: v * u.f, dim: u.dim };
}

function cleanWord(s: string): string {
  return norm(s).replace(/^[^a-z0-9]+|[^a-z0-9+]+$/g, "");
}

function substanceWord(s: string): string | null {
  const w = cleanWord(s);
  if (w.length < 3 || NOT_SUBSTANCE.has(w) || COUNTER_ION.has(w) || /^\d/.test(w)) return null;
  return w;
}

/** Up to four words after a dose, stopping at a preposition, a number or a clause end. */
function wordsAfter(rest: string): string[] {
  const out: string[] = [];
  for (const raw of rest.split(/\s+/).filter(Boolean).slice(0, 6)) {
    const w = cleanWord(raw.replace(/[()]/g, ""));
    if (!w) continue;
    if (AFTER_STOP.has(w) || /^\d/.test(w)) break;
    out.push(w);
    if (out.length >= 4 || /[,;.:]$/.test(raw.replace(/\)+$/, ""))) break;
  }
  return out;
}

interface DoseMention extends Dose {
  /** Lower-cased words next to the dose that may name the substance. */
  near: string[];
  /** Whether a substance word is attached to the dose at all. */
  attached: boolean;
  stock: boolean;
  /** For a dose worked out from a dilution: the dilution ("100 uL of 10 mM into 10 mL"). */
  computed?: string;
  /** Where the number starts in the sentence (-1 for a number read from a list). */
  at?: number;
  /** For the upper end of a range ("1-100 uM"): the lower end, in the base unit. */
  rangeLow?: number;
}

/** Split a step into sentences without breaking decimals ("0.5 mM"). */
function sentences(text: string): string[] {
  return (text ?? "").split(/(?<=[.;!?])\s+(?=[A-Z0-9(])/).filter((x) => x.trim());
}

/**
 * Concentrations in one sentence, with the words that may name their
 * substance. `series` also reads the numbers of a list or range that share
 * the unit (protocol text only: in a hypothesis "on day 3, 10 uM metformin"
 * must not become a 3 uM dose to look for).
 */
function doseMentions(sentence: string, opts: { series?: boolean } = {}): DoseMention[] {
  const out: DoseMention[] = [];
  for (const m of sentence.matchAll(DOSE_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    // "Metformin (10 uM) lowers ...": a dose in brackets belongs to the word before them.
    const inBrackets = /^\s*\)/.test(sentence.slice(end));
    const after = inBrackets ? [] : wordsAfter(sentence.slice(end).replace(/^\s*(?:of\s+)?(?:the\s+)?/i, ""));
    const head = sentence.slice(0, start);
    const isPercent = m[2] === "%";
    const before = isPercent ? [] : [
      head.match(/([A-Za-z][\w+-]*)\s*(?:\(|at\s+|,\s*)$/)?.[1],
      head.match(/([A-Za-z][\w+-]*)\s*\([^()]*$/)?.[1],
    ].filter((w): w is string => !!w).map(cleanWord);
    const afterSubj = after.map(substanceWord).find((w) => w) ?? null;
    // Percentages count only with a substance right after them ("by at least 30%" is an effect size).
    if (isPercent && !afterSubj) continue;
    // "510 nm", "0.22 um filter", "35 mm dishes": lengths, unless a substance follows directly.
    if (LOWER_M_UNIT.test(m[2]) && (!afterSubj || after.some((w) => LENGTH_NOUNS.has(w)))) continue;
    const subj = afterSubj ?? before.map(substanceWord).find((w) => w) ?? null;
    const stock = /stock/i.test(sentence.slice(end, end + 30)) || /stock\s*(?:solution)?\s*(?:\(|of\s+|at\s+)?$/i.test(head.slice(-25));
    const d = parseDose(m[1], m[2], subj ?? "");
    if (!d) continue;
    const mention: DoseMention = { ...d, near: [...after, ...before], attached: !!subj, stock, at: start };
    if (opts.series) {
      // "0, 1, 10 and 100 uM metformin" tests every listed concentration, and
      // "1-100 uM" every one in between: the numbers before the unit count too.
      const list = head.match(/((?:\d+(?:\.\d+)?\s*(?:,\s*(?:and\s+|or\s+)?|and\s+|or\s+|\/\s*|-\s*|–\s*|to\s+))+)$/i)?.[1];
      if (list) {
        for (const n of list.matchAll(/\d+(?:\.\d+)?/g)) {
          const extra = parseDose(n[0], m[2], subj ?? "");
          if (extra) out.push({ ...mention, ...extra, at: -1 });
        }
        if (/(?:-|–|to)\s*$/i.test(list)) {
          const low = parseDose(list.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*$/i)?.[1] ?? "", m[2], "");
          if (low && low.value < d.value) mention.rangeLow = low.value;
        }
      }
    }
    out.push(mention);
  }
  return out;
}

function fmtConc(value: number, dim: Dimension): string {
  const r = (x: number) => (x >= 100 ? String(Math.round(x)) : x >= 10 ? String(Math.round(x * 10) / 10) : String(Math.round(x * 100) / 100));
  if (dim !== "molar") {
    const u = Object.values(UNIT_FACTORS).filter((x) => x.dim === dim).sort((a, b) => b.f - a.f)
      .find((x) => value >= x.f * 0.9995) ?? Object.values(UNIT_FACTORS).find((x) => x.dim === dim)!;
    return `${r(value / u.f)} ${u.shown}`;
  }
  const order: Array<[number, string]> = [[1, "M"], [1e-3, "mM"], [1e-6, "uM"], [1e-9, "nM"], [1e-12, "pM"]];
  const [f, shown] = order.find(([f]) => value >= f * 0.9995) ?? order[order.length - 1];
  return `${r(value / f)} ${shown}`;
}

interface Dilution extends DoseMention {
  /** The result the sentence states ("to make a 10 uM working solution"), when it does. */
  stated?: Dose;
  /** Where the concentration being diluted starts in the sentence. */
  sourceAt?: number;
}

/** "Add 100 uL of 10 mM NMN stock to 10 mL medium": the final concentration of each dilution in a sentence. */
function dilutions(sentence: string): Dilution[] {
  const re = new RegExp(
    `(\\d+(?:\\.\\d+)?)\\s*(${VOL_UNIT})\\s+(?:of\\s+)?(?:(?:the|a|an)\\s+)?(\\d+(?:\\.\\d+)?)\\s*(${CONC_UNIT})(?![\\p{L}\\d])([^.;]{0,60}?)\\b(?:to|into|in|with)\\s+(?:(?:a|an|the|each)\\s+)?(?:(total)\\s+(?:volume\\s+)?(?:of\\s+)?)?(\\d+(?:\\.\\d+)?)\\s*(${VOL_UNIT})(?![\\p{L}])`,
    "giu",
  );
  const out: Dilution[] = [];
  for (const m of sentence.matchAll(re)) {
    const v1 = Number(m[1]) * (VOL_FACTORS[unitKey(m[2])] ?? NaN);
    const v2 = Number(m[7]) * (VOL_FACTORS[unitKey(m[8])] ?? NaN);
    const c1 = parseDose(m[3], m[4], "");
    if (!c1 || !(v1 > 0) || !(v2 > 0) || c1.dim === "percent") continue;
    const finalValue = c1.value * (m[6] ? v1 / v2 : v1 / (v1 + v2));
    const near = wordsAfter(m[5]);
    const subj = near.map(substanceWord).find((w) => w) ?? "";
    // "... to make a 1 uM working solution" / "for a final concentration of 10 uM"
    const tail = sentence.slice((m.index ?? 0) + m[0].length);
    const t = tail.match(new RegExp(`^[^.;]{0,40}?\\b(?:make|makes|making|give|gives|giving|yield|yields|obtain|prepare|reach|achieve|final(?:\\s+concentration)?(?:\\s+of)?|for)\\s+(?:a\\s+|an\\s+)?(?:final\\s+(?:concentration\\s+(?:of\\s+)?)?)?(\\d+(?:\\.\\d+)?)\\s*(${CONC_UNIT})(?![\\p{L}\\d])`, "iu"));
    const stated = t ? parseDose(t[1], t[2], subj) ?? undefined : undefined;
    out.push({
      substance: subj, value: finalValue, dim: c1.dim, text: `about ${fmtConc(finalValue, c1.dim)}`,
      near, attached: !!subj, stock: false,
      computed: `${volText(m[1], m[2])} of ${c1.text} into ${m[6] ? "a total of " : ""}${volText(m[7], m[8])}`,
      stated,
      // Where the diluted concentration is written: it is a stock, whatever the sentence calls it.
      sourceAt: sentence.indexOf(m[3], (m.index ?? 0) + m[1].length + m[2].length),
    });
  }
  return out;
}

/** A substance as the hypothesis names it, with its other spellings. */
interface SubstanceKey {
  substance: string;
  /** How findings name it when the hypothesis spells it out ("nicotinamide mononucleotide (NMN)"). */
  label?: string;
  /** Each form is a list of words that must all be present ("nicotinamide mononucleotide", or "nmn"). */
  forms: string[][];
}

function stem(w: string): string {
  return w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
}

/** Whether `short` can abbreviate `words`: same first letter, and its letters appear in them in order. */
function abbreviates(short: string, words: string): boolean {
  const s = short.replace(/[^a-z0-9]/g, "");
  const w = words.replace(/[^a-z0-9]/g, "");
  if ((s.match(/[a-z]/g) ?? []).length < 2 || s[0] !== w[0]) return false;
  let at = 0;
  for (const ch of s) {
    at = w.indexOf(ch, at);
    if (at < 0) return false;
    at++;
  }
  return true;
}

function keyFor(substance: string, hypothesis: string): SubstanceKey {
  const forms: string[][] = [[substance]];
  // "nicotinamide mononucleotide (NMN)": the acronym in brackets is another
  // spelling. Only when it abbreviates those words: in "2 mM butyrate to
  // raise resistance (TEER)" the bracket belongs to the resistance.
  const h = norm(hypothesis);
  const i = h.indexOf(substance);
  if (i >= 0) {
    const rest = h.slice(i).match(/^([a-z0-9+-]+(?:\s+[a-z0-9+-]+){0,3}?)\s*\(([a-z0-9+-]{2,10})\)/);
    if (rest && abbreviates(rest[2], rest[1])) {
      forms.push(rest[1].split(/\s+/));
      forms.push([rest[2]]);
      return { substance, forms, label: `${rest[1]} (${rest[2].toUpperCase()})` };
    }
    // The name as the hypothesis writes it, for findings: "sodium butyrate",
    // "nicotinamide riboside" (the dose parser keeps one word of it).
    const before = h.slice(0, i).match(/([a-z]+)\s+$/)?.[1];
    const after = h.slice(i + substance.length).match(/^\s+([a-z]+)/)?.[1];
    const label = `${before && COUNTER_ION.has(before) ? `${before} ` : ""}${substance}${after && /(?:ide|acid)$/.test(after) ? ` ${after}` : ""}`;
    if (label !== substance) return { substance, forms, label };
  }
  return { substance, forms };
}

function nearMatches(near: string[], key: SubstanceKey): boolean {
  const ws = new Set(near.map(stem));
  return key.forms.some((f) => f.length === 1 ? ws.has(stem(f[0])) : f.every((w) => ws.has(stem(w))));
}

function sentenceMentions(sentence: string, key: SubstanceKey): boolean {
  const ws = new Set(norm(sentence).split(/[^a-z0-9+-]+/).filter(Boolean).map(stem));
  return key.forms.some((f) => f.every((w) => ws.has(stem(w))));
}

/** Doses the hypothesis states ("10 uM metformin", "0.5 mM palmitate"). */
export function hypothesisDoses(hypothesis: string): Dose[] {
  const out: Dose[] = [];
  for (const s of sentences(hypothesis)) {
    for (const d of doseMentions(s)) {
      if (!d.attached) continue;
      if (!out.some((o) => o.substance === d.substance && o.dim === d.dim && Math.abs(o.value - d.value) < 1e-15)) {
        out.push({ substance: d.substance, text: d.text, value: d.value, dim: d.dim });
      }
    }
  }
  return out;
}

export interface DoseIssue {
  substance: string;
  /** The substance's full name, when the hypothesis gives one ("nicotinamide mononucleotide (NMN)"). */
  label?: string;
  hypothesis: string;
  plan: string[];
}

// A sentence about treating cells or animals, not about an assay reagent.
const TREATMENT_CONTEXT = /\b(?:cells?|cultures?|medium|media|dmem|rpmi|emem|mem|wells?|plates?|flasks?|dish(?:es)?|monolayers?|inserts?|transwells?|treat\w*|incubat\w*|expos\w*|mice|mouse|rats?|animals?|inject\w*|administ\w*|feed\w*|diet|apical|basolateral)\b/i;
const ASSAY_CONTEXT = /\b(?:assay|reaction|lysis|extraction|standard|calibration)\s+(?:buffer|mix(?:ture)?|solution|curve|reagent)s?\b/i;

/** Every concentration the protocol gives a hypothesis substance, with dilutions worked out. */
function planDosesFor(key: SubstanceKey, steps: { title?: string; description?: string }[]): Array<DoseMention & { treatment: boolean }> {
  const out: Array<DoseMention & { treatment: boolean }> = [];
  for (const s of steps) {
    for (const sent of sentences(`${s?.title ?? ""}. ${s?.description ?? ""}`)) {
      const about = sentenceMentions(sent, key);
      const treatment = TREATMENT_CONTEXT.test(sent) && !ASSAY_CONTEXT.test(sent);
      const diluted = dilutions(sent);
      // The concentration a dilution starts from is a stock, not the dose:
      // "Add 100 uL of 10 mM NMN to 10 mL medium" doses about 99 uM.
      const sources = new Set(diluted.map((d) => d.sourceAt).filter((n) => n !== undefined && n >= 0));
      for (const d of doseMentions(sent, { series: true })) {
        if (d.stock || sources.has(d.at)) continue;
        // An unattached dose ("to make a 1 uM working solution", "dilute to
        // 10 uM in DMEM") belongs to the substance the sentence is about.
        const mine = d.attached ? nearMatches(d.near, key) : about && d.dim !== "percent";
        if (mine) out.push({ ...d, treatment });
      }
      for (const d of diluted) {
        const mine = d.attached ? nearMatches(d.near, key) : about;
        if (mine) out.push({ ...d, treatment });
      }
    }
  }
  return out;
}

/**
 * Doses in the protocol that contradict the hypothesis: the protocol gives
 * the substance concentrations of the same kind (molar, mass per volume,
 * ...) and none of them is within 1.5x of the hypothesis' dose. Stock
 * concentrations are ignored (a 10 mM stock diluted to 10 uM is fine), and
 * so are the materials (they list stock solutions). A dilution ("100 uL of
 * 10 mM NMN into 10 mL medium") counts with its final concentration (about
 * 99 uM; QA round 3, run b4d82571). When the protocol treats cells with the
 * substance, only those doses count: an assay-buffer step does not make a
 * 10x lower treatment dose right.
 */
export function doseIssues(hypothesis: string, steps: { title?: string; description?: string }[] | undefined): DoseIssue[] {
  const doses = hypothesisDoses(hypothesis);
  if (doses.length === 0 || !Array.isArray(steps)) return [];
  const issues: DoseIssue[] = [];
  for (const d of doses) {
    const key = keyFor(d.substance, hypothesis);
    const all = planDosesFor(key, steps).filter((v) => v.dim === d.dim);
    const treatment = all.filter((v) => v.treatment);
    const seen = treatment.length > 0 ? treatment : all;
    if (seen.length === 0) continue;
    const matches = seen.some((v) => (v.value / d.value <= 1.5 && d.value / v.value <= 1.5)
      // inside a stated range ("1-100 uM")
      || (v.rangeLow !== undefined && d.value >= v.rangeLow / 1.5 && d.value <= v.value * 1.5));
    if (!matches) {
      issues.push({
        substance: d.substance,
        ...(key.label ? { label: key.label } : {}),
        hypothesis: d.text,
        plan: [...new Set(seen.map((v) => (v.computed ? `${v.text} (${v.computed})` : v.text)))],
      });
    }
  }
  return issues;
}

export interface DilutionIssue {
  step: number;
  /** "10 uL of 10 mM into 990 uL" */
  dilution: string;
  computed: string;
  stated: string;
}

/**
 * Dilutions whose stated result is wrong: "Add 10 uL of the 10 mM metformin
 * stock to 990 uL of DMEM to make a 10 uM working solution" gives 100 uM
 * (QA round 3, run 7c539b00). Flagged when the stated concentration is more
 * than 1.5x off the computed one.
 */
export function dilutionIssues(steps: { title?: string; description?: string }[] | undefined): DilutionIssue[] {
  if (!Array.isArray(steps)) return [];
  const out: DilutionIssue[] = [];
  steps.forEach((s, i) => {
    for (const sent of sentences(s?.description ?? "")) {
      for (const d of dilutions(sent)) {
        if (!d.stated || d.stated.dim !== d.dim) continue;
        const r = d.value / d.stated.value;
        if (r > 1.5 || r < 1 / 1.5) {
          out.push({ step: i + 1, dilution: d.computed ?? "", computed: fmtConc(d.value, d.dim), stated: d.stated.text });
        }
      }
    }
  });
  return out;
}

// --- readout and materials ------------------------------------------------------

// Words of a readout phrase that do not identify it.
const READOUT_GENERIC = new Set([
  "a", "an", "the", "of", "and", "with", "using", "by", "staining", "stain", "stained", "assay", "assays",
  "kit", "luminescent", "fluorescent", "colorimetric", "quantitative", "standard", "commercial", "method",
  "analysis", "imaging", "measurement", "measurements", "level", "levels", "epithelial", "based", "plate",
  "reader", "readout", "test", "system", "probe", "commercially", "available", "absorbance", "microscopy",
]);

export interface Readout {
  /** As written in the hypothesis ("Oil Red O staining"). */
  phrase: string;
  /** The words that identify it ("oil", "red"). */
  terms: string[];
  /** It is something bought (a stain, kit, antibody), not only an instrument. */
  reagent: boolean;
}

/** How the hypothesis says its outcome is measured ("measured by Oil Red O staining"). */
export function hypothesisReadout(hypothesis: string): Readout | null {
  const m = (hypothesis ?? "").match(/\b(?:measured|assessed|quantified|determined|detected|monitored|evaluated|analy[sz]ed|read\s+out|visuali[sz]ed|scored)\s+(?:by|with|using|via|through)\s+(?:an?\s+|the\s+)?([^,.;()]+)/i);
  if (!m) return null;
  const phrase = m[1].replace(/\s+/g, " ").replace(/\s+(?:by|in|at|after|compared|relative|versus|vs)\b.*$/i, "").trim();
  const terms = norm(phrase).split(/[\s]+/).flatMap((w) => w.split("/"))
    .map((w) => w.replace(/[^a-z0-9+-]/g, "")).filter((w) => w.length >= 2 && !READOUT_GENERIC.has(w));
  if (terms.length === 0) return null;
  return { phrase, terms, reagent: /stain|dye|kit|assay|antibod|elisa|probe|reagent|substrate|marker|indicator/i.test(phrase) };
}

function wordSet(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of norm(text).split(/[^a-z0-9+/-]+/)) {
    const w = raw.replace(/^[-+/]+|[-+/]+$/g, "");
    if (!w) continue;
    out.add(w);
    out.add(stem(w));
    for (const p of w.split(/[-/]/)) if (p) { out.add(p); out.add(stem(p)); }
    if (w.includes("-")) out.add(w.replace(/-/g, ""));
  }
  return out;
}

function textHas(words: Set<string>, terms: string[]): boolean {
  if (terms.length === 0) return false;
  const found = terms.filter((t) => words.has(t) || words.has(stem(t)));
  return terms.length <= 2 ? found.length === terms.length : found.length * 2 >= terms.length;
}

/** Whether the protocol has a step that does the hypothesis' readout. Null when it has, or the hypothesis names none. */
export function readoutMissing(hypothesis: string, steps: { title?: string; description?: string }[] | undefined): Readout | null {
  const r = hypothesisReadout(hypothesis);
  if (!r || !Array.isArray(steps) || steps.length === 0) return null;
  const text = steps.map((s) => `${s?.title ?? ""} ${s?.description ?? ""}`).join(" ");
  if (textHas(wordSet(text), r.terms)) return null;
  // "Measure TEER with an EVOM": the measured quantity's acronym from the
  // hypothesis ("transepithelial electrical resistance (TEER)") in a step
  // that measures counts too. The compound's own acronym (NMN) does not.
  const doseWords = new Set(hypothesisDoses(hypothesis).flatMap((d) => keyFor(d.substance, hypothesis).forms.flat()));
  const acronyms = [...(hypothesis ?? "").matchAll(/\(([A-Z][A-Z0-9+]{1,7})\)/g)].map((m) => m[1]).filter((a) => !doseWords.has(a.toLowerCase()));
  const measured = sentences(text).some((s) => /\b(?:measur|record|read|quantif|assess|monitor)\w*/i.test(s)
    && acronyms.some((a) => new RegExp(`(?:^|[^A-Za-z0-9])${a.replace(/\+/g, "\\+")}(?![A-Za-z0-9])`).test(s)));
  return measured ? null : r;
}

// Reagents a protocol often uses without listing them: the spellings to
// look for (lower case) and the name shown.
const COMMON_REAGENTS: Array<{ forms: string[][]; label: string }> = [
  { forms: [["bsa"], ["bovine", "serum", "albumin"]], label: "BSA" },
  { forms: [["dmso"], ["dimethyl", "sulfoxide"], ["dimethyl", "sulphoxide"]], label: "DMSO" },
  { forms: [["pbs"], ["dpbs"], ["phosphate", "buffered", "saline"]], label: "PBS" },
  { forms: [["trypsin"], ["tryple"]], label: "trypsin" },
  { forms: [["paraformaldehyde"], ["pfa"], ["formalin"], ["formaldehyde"]], label: "fixative (PFA or formalin)" },
  { forms: [["isopropanol"], ["2-propanol"]], label: "isopropanol" },
  { forms: [["triton"]], label: "Triton X-100" },
  { forms: [["tween"]], label: "Tween-20" },
  { forms: [["dapi"]], label: "DAPI" },
  { forms: [["hoechst"]], label: "Hoechst" },
  { forms: [["mtt"]], label: "MTT" },
  { forms: [["crystal", "violet"]], label: "crystal violet" },
  { forms: [["oil", "red"]], label: "Oil Red O" },
  { forms: [["transwell"]], label: "Transwell inserts" },
  { forms: [["matrigel"]], label: "Matrigel" },
  { forms: [["collagen"]], label: "collagen" },
  { forms: [["bca"]], label: "BCA protein assay" },
  // Buffers, not their ingredients: a step that spells out a lysis buffer's
  // recipe (Tris, EDTA, NaCl) is asking for the buffer.
  { forms: [["ripa"]], label: "RIPA buffer" },
  { forms: [["pen", "strep"], ["penstrep"], ["penicillin"]], label: "penicillin-streptomycin" },
  { forms: [["fbs"], ["fcs"], ["fetal", "bovine"], ["foetal", "bovine"], ["fetal", "calf"], ["foetal", "calf"]], label: "FBS" },
  { forms: [["dmem"], ["dulbecco", "eagle"]], label: "DMEM" },
  { forms: [["rpmi"]], label: "RPMI" },
];

function hasForm(words: Set<string>, forms: string[][]): boolean {
  return forms.some((f) => f.every((w) => words.has(w) || words.has(stem(w))));
}

const CELL_DESCRIPTOR = "human|murine|mouse|rat|neuroblastoma|hepatoma|carcinoma|adenocarcinoma|hepatocellular|colorectal|colon|epithelial|endothelial|intestinal|breast|liver|lung|kidney|prostate|cervical|cancer|tumou?r|leuka?emia|differentiated|undifferentiated";
const CELL_NOUN = "cells?|monolayers?|hepatocytes|neurons|myotubes|myoblasts|adipocytes|preadipocytes|macrophages|monocytes|fibroblasts|keratinocytes|cardiomyocytes|spheroids|organoids|line";
const CELL_LINE_RE = new RegExp(
  `(?<![A-Za-z0-9-])([A-Za-z0-9][A-Za-z0-9.]*(?:[- ][A-Za-z0-9.]+){0,2})\\s+(?:(?:${CELL_DESCRIPTOR})\\s+){0,3}(?:${CELL_NOUN})\\b`,
  "g",
);

/**
 * Cell lines the hypothesis is done in: names with a capital letter and a
 * digit before "cells", "monolayers", ... ("HepG2 hepatocytes", "MCF-7
 * breast cancer cells", "RAW 264.7 macrophages", "3T3-L1 adipocytes").
 * Lines named without a digit (HeLa, Vero, Jurkat) are not recognised.
 */
export function hypothesisCellLines(hypothesis: string): string[] {
  const out: string[] = [];
  // A hypothesis typed in capitals has no case to tell a name by ("AFTER 24
  // H CELLS WERE LYSED"): there only lines of the ATCC list count.
  const allCaps = !/[a-z]/.test(hypothesis ?? "");
  if (allCaps) {
    for (const m of (hypothesis ?? "").matchAll(new RegExp(CELL_LINE_RE.source, "gi"))) {
      for (const token of m[1].split(" ")) {
        if (/\d/.test(token) && cellLineIn(`${token} cells`) && !out.includes(token)) out.push(token);
      }
    }
    return out;
  }
  for (const m of (hypothesis ?? "").matchAll(CELL_LINE_RE)) {
    // The name is the last word with a digit; a plain word after it is a
    // descriptor the pattern took along ("MCF-7 breast" before "cancer cells").
    const tokens = m[1].split(" ");
    let at = tokens.length - 1;
    while (at > 0 && !/\d/.test(tokens[at]) && /^[a-z]+$/.test(tokens[at])) at--;
    const name = tokens[at].replace(/\.$/, "");
    const prev = at > 0 ? tokens[at - 1] : "";
    if (!/\d/.test(name)) continue;
    // "3D spheroids", "H2O2-treated cells", "G1 cells" are not cell lines.
    if (/^\d+d$/i.test(name) || name.split("-").some((p) => /^[a-z]{4,}$/.test(p))) continue;
    let full: string | null = null;
    if (/[A-Z]/.test(name) && name.length >= 3) full = name;
    // "Hep G2", "HEK 293", "RAW 264.7": the name is the two words together.
    else if (/^[A-Z][A-Za-z]{1,4}$/.test(prev)) full = `${prev} ${name}`;
    if (full && !out.includes(full)) out.push(full);
  }
  return out;
}

export interface MissingMaterials {
  /** What the hypothesis is about (its compound, cell line, readout reagent), used in the protocol but not listed. */
  required: string[];
  /** Other reagents the protocol uses that are not listed. */
  other: string[];
}

/**
 * Reagents the protocol uses that the materials table leaves out (QA round
 * 3: R1, v2 and v3 dosed palmitate and stained with Oil Red O without
 * listing either; R3 cultured HepG2 cells it never listed).
 */
export function missingMaterials(
  hypothesis: string,
  steps: { title?: string; description?: string }[] | undefined,
  materials: { name?: string; notes?: string }[] | undefined,
): MissingMaterials {
  if (!Array.isArray(steps) || steps.length === 0 || !Array.isArray(materials) || materials.length === 0) {
    return { required: [], other: [] };
  }
  const protocol = wordSet(steps.map((s) => `${s?.title ?? ""} ${s?.description ?? ""}`).join(" "));
  const listed = wordSet(materials.map((m) => `${m?.name ?? ""} ${m?.notes ?? ""}`).join(" "));
  const required: string[] = [];
  const add = (label: string) => { if (!required.some((r) => r.toLowerCase() === label.toLowerCase())) required.push(label); };

  for (const d of hypothesisDoses(hypothesis)) {
    const key = keyFor(d.substance, hypothesis);
    if (hasForm(protocol, key.forms) && !hasForm(listed, key.forms)) add(key.label ?? d.substance);
  }
  for (const line of hypothesisCellLines(hypothesis)) {
    // Any spelling: "SH-SY5Y" / "SHSY5Y", "Hep G2" / "HepG2" (the ATCC list knows the usual ones).
    const k = norm(line);
    const forms = [[k.replace(/[- .]/g, "")], k.split(/[- ]/).filter(Boolean)];
    const entry = cellLineIn(`${line} cells`);
    const used = hasForm(protocol, forms) || (!!entry && steps.some((s) => cellLineIn(`${s?.title ?? ""} ${s?.description ?? ""}`) === entry));
    const isListed = hasForm(listed, forms) || (!!entry && materials.some((m) => cellLineIn(m?.name) === entry));
    if (used && !isListed) add(line);
  }
  const r = hypothesisReadout(hypothesis);
  // A kit is listed when the table names a distinctive word of it ("Enzymatic NAD+ Assay Kit" for "enzymatic cycling assay").
  const listedLoose = (terms: string[]) => textHas(listed, terms) || terms.some((t) => t.length >= 5 && (listed.has(t) || listed.has(stem(t))));
  if (r?.reagent && textHas(protocol, r.terms) && !listedLoose(r.terms)) add(r.phrase);

  const other: string[] = [];
  for (const c of COMMON_REAGENTS) {
    if (!hasForm(protocol, c.forms) || hasForm(listed, c.forms)) continue;
    if (required.some((x) => hasForm(wordSet(x), c.forms))) continue;
    other.push(c.label);
  }
  return { required, other };
}

/**
 * Hypotheses about intracellular levels whose protocol measures the culture
 * supernatant and never lyses the cells (QA round 3, NMN run b4d82571: "Add
 * 100 uL of NAD/NADH assay to 1 mL cell culture supernatant").
 */
export function compartmentMismatch(hypothesis: string, steps: { title?: string; description?: string }[] | undefined): string | null {
  if (!/\bintracellular\b/i.test(hypothesis ?? "") || !Array.isArray(steps)) return null;
  const text = steps.map((s) => `${s?.title ?? ""}. ${s?.description ?? ""}`).join(" ");
  if (!/\bsupernatants?\b|\bconditioned\s+medi(?:um|a)\b/i.test(text)) return null;
  if (/\blys(?:e|ed|es|ing|is|ate|ates)\b|\bextract(?:ed|ion|s)?\b|\bhomogeni[sz]\w*|\bpermeabili[sz]\w*/i.test(text)) return null;
  return "The hypothesis is about intracellular levels, but the protocol measures the culture supernatant and never lyses or extracts the cells.";
}

// --- step durations --------------------------------------------------------------

const TEXT_DURATION = /(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(minutes?|mins?|hours?|hrs?|h|days?|d|weeks?|wks?)\b/gi;
const TEXT_UNIT_HOURS: Record<string, number> = {
  minute: 1 / 60, minutes: 1 / 60, min: 1 / 60, mins: 1 / 60,
  hour: 1, hours: 1, hr: 1, hrs: 1, h: 1, day: 24, days: 24, d: 24, week: 168, weeks: 168, wk: 168, wks: 168,
};

/** Longest duration a step's text states ("Incubate for 24 h" -> 24), 0 when none. */
function textHours(text: string): number {
  let max = /\bovernight\b/i.test(text ?? "") ? 16 : 0;
  for (const m of (text ?? "").matchAll(TEXT_DURATION)) {
    const n = Number(m[2] ?? m[1]);
    const f = TEXT_UNIT_HOURS[m[3].toLowerCase()];
    if (f && Number.isFinite(n)) max = Math.max(max, n * f);
  }
  return max;
}

const OPEN_ENDED_STEP = /\b(?:until|every|each\s+(?:day|week)|daily|weekly|twice|per\s+(?:day|week)|confluen\w*|differentiat\w*|acclimat\w*|passag\w*|expand\w*|order\w*|deliver\w*|shipp\w*|lead\s+time|recruit\w*|approv\w*|repeat\w*|replicate\s+experiments?|independent\s+experiments?|time[- ]?points?|time[- ]course|follow[- ]up)\b/i;

export interface StepDurationIssue {
  steps: number[];
  /** The duration column of the first such step ("2 weeks"). */
  duration: string;
  /** The longest duration their text states, in hours. */
  text_hours: number;
}

/**
 * Steps whose duration column is far longer than the work their text
 * describes: refinement v3 (QA round 3, run 69a412a9) gave all five steps
 * "2 weeks" while each said "Incubate for 24 h". Flagged when two or more
 * steps are at least 4x (and 2 days) longer than their text, or one step is
 * a week or more and 7x longer.
 */
export function stepDurationIssues(
  steps: { title?: string; description?: string; duration?: string }[] | undefined,
  parseHours: (s: string | undefined) => number,
): StepDurationIssue | null {
  if (!Array.isArray(steps)) return null;
  const bad: { step: number; field: number; text: number; duration: string }[] = [];
  steps.forEach((s, i) => {
    const field = parseHours(s?.duration);
    // A step that runs until something happens, or repeats, states no total:
    // "Culture until differentiated, changing the medium every 2 days" may well take 3 weeks.
    if (OPEN_ENDED_STEP.test(s?.description ?? "")) return;
    const text = textHours(s?.description ?? "");
    if (field > 0 && text > 0 && field >= Math.max(text * 4, text + 48)) {
      bad.push({ step: i + 1, field, text, duration: s?.duration ?? "" });
    }
  });
  const strong = bad.filter((b) => b.field >= 168 && b.field >= b.text * 7);
  if (bad.length < 2 && strong.length === 0) return null;
  const list = bad.length >= 2 ? bad : strong;
  return { steps: list.map((b) => b.step), duration: list[0].duration, text_hours: Math.max(...list.map((b) => b.text)) };
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

// --- suppliers -------------------------------------------------------------------

// Specialist suppliers and what they sell. Run 739dddf1 (CRP biosensor, QA
// round-2 fix check) bought anti-CRP antibodies and an electrode from IDT
// and whole blood from Addgene.
const SPECIALISTS: Array<{ supplier: RegExp; label: string; sells: RegExp }> = [
  { supplier: /^idt$|integrated\s+dna/i, label: "IDT (oligonucleotides, CRISPR reagents)",
    sells: /oligo|primer|probe|g-?block|gene\s+fragment|guide|g?rna|crrna|tracr|cas\s?9|cas\s?12|alt-?r|adapter|duplex|dna|sirna|nuclease|custom/i },
  { supplier: /addgene/i, label: "Addgene (plasmids, viral preps)",
    sells: /plasmid|vector|construct|virus|viral|aav|lenti|retro|clone|antibod|kit/i },
  { supplier: /^atcc$/i, label: "ATCC (cell lines, strains)",
    sells: /cell|line|strain|bacteri|virus|phage|yeast|fung|culture|medium|media|serum|[a-z]+\d|\d[a-z]/i },
  { supplier: /jackson|jax/i, label: "The Jackson Laboratory (mice)",
    sells: /mice|mouse|strain|c57|balb|nod|scid/i },
];

export interface SupplierMismatch {
  name: string;
  supplier: string;
  label: string;
}

/** Materials bought from a specialist supplier that does not sell that kind of item. */
export function unlikelySuppliers(materials: { name?: string; supplier?: string }[] | undefined): SupplierMismatch[] {
  if (!Array.isArray(materials)) return [];
  const out: SupplierMismatch[] = [];
  for (const m of materials) {
    const supplier = (m?.supplier ?? "").trim();
    const spec = SPECIALISTS.find((s) => s.supplier.test(supplier));
    if (spec && !spec.sells.test(m?.name ?? "")) out.push({ name: m?.name ?? "", supplier, label: spec.label });
  }
  return out;
}

// --- catalog numbers ------------------------------------------------------------

export type CatalogStatus = "verified" | "unverified";

/** What checkCatalogNumbers reads from a material. */
export interface CatalogInput {
  name?: string;
  supplier?: string;
  catalog_number?: string;
  notes?: string;
  catalog_status?: CatalogStatus;
  catalog_check?: string;
}

/** The fields checkCatalogNumbers sets on every material. */
export interface CatalogMarks {
  catalog_status?: CatalogStatus;
  catalog_check?: string;
}

export interface MaterialWithCatalog {
  name?: string;
  supplier?: string;
  catalog_number?: string;
  notes?: string;
  /** Set by the checks: "verified" only when a catalogue confirmed the number for this product. */
  catalog_status?: CatalogStatus;
  /** Where the number was confirmed, or why it could not be. */
  catalog_check?: string;
  [key: string]: unknown;
}

/**
 * What the live supplier lookup (skuVerify.ts) said about one material's
 * catalog number. Findings without a status come from older callers and
 * mean "listed as another product".
 */
export interface LiveSkuFinding {
  material_index: number;
  catalog_number: string;
  /** "unconfirmed": found in the catalogue under a name that only partly fits this material. */
  status?: "match" | "mismatch" | "unconfirmed" | "not_found" | "unknown";
  supplier_hint?: string;
  /** For a match: where it was found (PubChem source ID). */
  source?: string;
}

export interface CatalogRemoval {
  name: string;
  catalog_number: string;
  why: string;
}

export interface CatalogCorrection {
  name: string;
  from: string | null;
  to: string;
  why: string;
}

export interface CatalogUnverified {
  name: string;
  catalog_number: string;
  why: string;
}

// A material that names a cell line but is not the cells ("HepG2 lysate", "Caco-2 medium", "Caco-2 Transwell plate").
const NOT_CELLS = /medium|media|kit|antibod|lysate|rna|dna|serum|supplement|reagent|buffer|plasmid|vector|conditioned|extract|protein|exosome|insert|plate|flask|dish|membrane/i;

const NO_NUMBER = /^(?:custom|n\/?a|none|-+|—|tbd|not applicable|on hand|in house|in-house)$/i;

function supplierName(m: CatalogInput): string {
  return (m?.supplier ?? "").toString().trim() || "the supplier";
}

/**
 * Remove catalog numbers that are known to be wrong: the local dictionary
 * says the number is another product, the number does not have the
 * supplier's format, it looks like a placeholder ("S1000", "A1000"), or the
 * supplier's live catalog (Sigma-Aldrich through PubChem, run before this)
 * lists it under an unrelated name. The material keeps its name and price;
 * its notes say what was removed. A wrong number is worse than none:
 * someone would order it.
 */
export function removeWrongCatalogNumbers<M extends CatalogInput>(
  materials: M[] | undefined,
  live: LiveSkuFinding[] = [],
): { materials: M[]; removed: CatalogRemoval[] } {
  const r = checkCatalogNumbers(materials, live);
  return { materials: r.materials, removed: r.removed };
}

/**
 * Every catalog number in the materials gets a status (QA round 3, run
 * 92185b64: invented numbers such as Sigma "S1000" and ATCC "CCL-22" for
 * Caco-2 were shown as real because only "found under another name" was
 * acted on):
 *  - removed: wrong product (dictionary or live lookup), wrong format, or a
 *    placeholder-like number that no catalogue confirmed;
 *  - corrected: a plain cell line from the ATCC list (not a sub-line or an
 *    engineered variant) with another (or no) number gets ATCC's number;
 *  - verified: confirmed by the ATCC list, the local dictionary, or the live
 *    Sigma-Aldrich lookup (the names must agree, skuVerify.nameAgreement);
 *  - unverified: everything else (not in Sigma-Aldrich's PubChem deposits,
 *    found there under a name that only partly fits, lookup failed, or a
 *    supplier without a searchable catalogue). The materials table shows
 *    these as unverified, never as plain numbers.
 *
 * `catalog_status` and `catalog_check` on the input are ignored: a model can
 * write them too. Only `keepEarlier` (a plan this pipeline checked before,
 * for example a cached copy that is re-checked without a live lookup) keeps
 * the status of a number the earlier check looked up.
 */
export function checkCatalogNumbers<M extends CatalogInput>(
  materials: M[] | undefined,
  live: LiveSkuFinding[] = [],
  opts: { keepEarlier?: boolean } = {},
): { materials: Array<M & CatalogMarks>; removed: CatalogRemoval[]; corrected: CatalogCorrection[]; unverified: CatalogUnverified[]; verified: number } {
  if (!Array.isArray(materials)) return { materials: [], removed: [], corrected: [], unverified: [], verified: 0 };
  // Another product by the dictionary, and numbers outside the supplier's format.
  const otherProduct = new Map<number, string>();
  const badFormat = new Map<number, string>();
  for (const i of findCatalogIssues(materials)) {
    if (i.reason === "format_mismatch") {
      badFormat.set(i.material_index, `not in ${materials[i.material_index]?.supplier ?? "the supplier"}'s catalog-number format`);
    } else {
      otherProduct.set(i.material_index, `it is ${i.canonical_name}`);
    }
  }
  const liveBy = new Map<number, LiveSkuFinding>();
  for (const s of live) liveBy.set(s.material_index, s);

  const removed: CatalogRemoval[] = [];
  const corrected: CatalogCorrection[] = [];
  const unverified: CatalogUnverified[] = [];
  let verified = 0;

  const out = materials.map((m, i) => {
    const raw = (m?.catalog_number ?? "").toString().trim();
    const cat = NO_NUMBER.test(raw) ? "" : raw;
    const name = (m?.name ?? "").toString() || `material ${i + 1}`;
    const supplier = supplierName(m);
    const copy: M = { ...m };
    delete copy.catalog_status;
    delete copy.catalog_check;
    if (!cat && raw) delete copy.catalog_number;
    const asVerified = (check: string, extra: Partial<CatalogInput> = {}) => {
      verified++;
      return { ...copy, ...extra, catalog_status: "verified", catalog_check: check } as M;
    };
    const remove = (why: string) => {
      removed.push({ name, catalog_number: cat, why });
      delete copy.catalog_number;
      copy.notes = `${m?.notes ? `${m.notes} ` : ""}(Catalog number ${cat} removed by the automated check: ${why}.)`;
      return copy;
    };

    // 1) A cell line ATCC sells: its number comes from the ATCC list. Only
    //    the plain line: "Vero E6" (CRL-1586) is not Vero (CCL-81).
    const line = NOT_CELLS.test(name) ? null : plainCellLineIn(name);
    if (line && (/\batcc\b/i.test(supplier) || (cat && atccShaped(cat)))) {
      const check = `ATCC's number for ${line.label} (the app's cell-line list)`;
      if (cat.toUpperCase() === line.atcc) return asVerified(check);
      corrected.push({ name, from: cat || null, to: line.atcc, why: `ATCC's number for ${line.label}` });
      return asVerified(check, {
        catalog_number: line.atcc,
        notes: `${m?.notes ? `${m.notes} ` : ""}(${cat ? `Catalog number ${cat} replaced by ${line.atcc}` : `Catalog number ${line.atcc} added`} by the automated check: ATCC's number for ${line.label}.)`,
      });
    }
    if (!cat) return copy;

    // 2) Another product: remove.
    const lv = liveBy.get(i);
    const liveWrong = lv && (lv.status === undefined || lv.status === "mismatch");
    const other = otherProduct.get(i)
      ?? (liveWrong ? (lv!.supplier_hint ? lv!.supplier_hint.replace(/\.$/, "") : "the supplier lists it as another product") : null);
    if (other) return remove(other);

    // 3) Confirmed by a catalogue: verified. This comes before the format
    //    and placeholder rules, which are only guesses about the shape.
    const dict = dictionaryConfirms(cat, name);
    if (dict) return asVerified(`listed as ${dict} (the app's catalogue list)`);
    if (lv?.status === "match") {
      return asVerified(`found in Sigma-Aldrich's catalogue through PubChem${lv.source ? ` (${lv.source})` : ""}`);
    }

    // 4) The wrong shape for this supplier, or a made-up looking number: remove.
    const shape = badFormat.get(i) ?? (looksLikePlaceholder(cat) ? "it looks like a placeholder, not a catalogue number" : null);
    if (shape) return remove(shape);

    // 5) What an earlier pass of this pipeline found out by lookup still holds
    //    when this pass has no lookup of its own (a cached copy).
    const earlier = opts.keepEarlier && !lv && typeof m?.catalog_check === "string" && m.catalog_check ? m : null;
    if (earlier?.catalog_status === "verified") return asVerified(earlier.catalog_check!);

    // 6) Everything else: unverified.
    const reason = lv?.status === "unconfirmed"
      ? `${(lv.supplier_hint ?? "Sigma-Aldrich lists this number under another name.").replace(/\.$/, "").replace("this SKU", "this number")}; that name could not be matched to this material`
      : lv?.status === "not_found"
      ? "not in Sigma-Aldrich's catalogue as deposited in PubChem"
      : lv?.status === "unknown"
      ? "the Sigma-Aldrich lookup did not answer"
      : earlier?.catalog_status === "unverified"
      ? earlier.catalog_check!
      : /sigma|millipore|aldrich|supelco|merck|fluka/i.test(supplier)
      ? "not looked up (only the first numbers of a plan are checked live)"
      : `no searchable catalogue for ${supplier}`;
    unverified.push({ name, catalog_number: cat, why: reason });
    return { ...copy, catalog_status: "unverified", catalog_check: reason } as M;
  });
  return { materials: out, removed, corrected, unverified, verified };
}
