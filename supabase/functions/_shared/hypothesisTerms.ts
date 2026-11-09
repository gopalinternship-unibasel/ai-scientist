// What a hypothesis is about, as weighted concepts.
//
// One deterministic reading of the hypothesis serves three jobs:
//  - the keyword queries sent to PubMed / OpenAlex / Semantic Scholar
//    (queryDegradation.ts),
//  - how well a retrieved paper covers the hypothesis (relevanceRank.ts and
//    the novelty verdict check in noveltyVerdict.ts),
//  - which hypothesis terms a plan's materials must name (planGuards.ts).
//
// Why (QA round 2, 9 Nov 2026): for "Treating HepG2 hepatocytes with 10 µM
// metformin for 24 hours before a 0.5 mM palmitate challenge will reduce
// intracellular lipid accumulation, measured by Oil Red O staining, ..."
// the old keyword picker took words in sentence order ("treating hepg2
// hepatocytes metformin hours"), so the queries that reached PubMed lost
// palmitate and lipid accumulation, the verdict said "likely novel", and a
// second run retrieved no reference at all. PubMed answers 10 papers to
// "metformin palmitate HepG2 lipid accumulation". The materials check passed
// a plan without metformin, palmitate or HepG2 because "Oil Red O" was one
// shared word.
//
// Import-free (no Deno or browser APIs).

export interface Concept {
  /** Text used in search queries (original spelling). */
  query: string;
  /** Normalised word lists; a text mentions the concept when it contains every word of one form. */
  forms: string[][];
  weight: number;
  /** Token position of the first occurrence (queries keep sentence order). */
  pos: number;
  /** Named after a comparison cue ("compared with", "matching ... ELISA"): the comparator, not the subject. */
  comparator: boolean;
}

// Function words.
const STOP = new Set([
  "the", "and", "or", "but", "of", "in", "on", "at", "to", "for", "with", "by", "from", "as", "is", "are",
  "was", "were", "be", "been", "being", "this", "that", "these", "those", "will", "would", "should", "could",
  "may", "might", "can", "do", "does", "did", "than", "then", "so", "such", "into", "via", "between", "across",
  "within", "without", "over", "under", "using", "use", "used", "not", "no", "nor", "we", "our", "their", "its",
  "it", "also", "only", "more", "less", "least", "most", "if", "when", "while", "where", "what", "which", "who",
  "whom", "because", "due", "per", "each", "every", "any", "all", "some", "none", "after", "before", "during",
  "about", "has", "have", "had", "how", "why", "one", "two", "three", "four", "five", "both", "same", "other",
  "very", "much", "many", "an", "a", "up", "down", "out", "off", "below", "above", "upon", "whether", "there",
  "here", "they", "them", "it's", "whose", "until", "since", "among", "along", "around", "against", "toward",
  "towards", "least", "approximately", "roughly", "about", "nearly", "almost", "fold",
]);

// Words common to almost every experiment description: they say nothing about
// which experiment this is.
const GENERIC = new Set([
  "cell", "culture", "cultured", "control", "group", "sample", "assay", "level", "increase", "increased",
  "decrease", "decreased", "reduce", "reduced", "reduction", "raise", "raised", "improve", "improved",
  "treatment", "treated", "treat", "treating", "hour", "day", "week", "month", "minute", "second", "effect",
  "concentration", "measure", "measured", "measuring", "measurement", "percent", "higher", "lower", "high",
  "low", "study", "experiment", "protocol", "buffer", "medium", "media", "solution", "kit", "reagent",
  "standard", "test", "tested", "testing", "result", "data", "analysis", "baseline", "relative",
  "significant", "significantly", "total", "final", "compared", "comparison", "versus", "vehicle", "dose",
  "dosing", "replicate", "triplicate", "temperature", "incubate", "incubation", "challenge", "challenged",
  "condition", "model", "system", "human", "type", "based", "new", "novel", "show", "shows", "showed",
  "lead", "leads", "led", "cause", "causes", "caused", "result", "results", "resulting", "require",
  "requiring", "required", "detect", "detects", "detection", "detected", "match", "matching", "matched",
  "staining", "stained", "stain", "quantify", "quantified", "quantification", "determine", "determined",
  "evaluate", "evaluated", "assess", "assessed", "induce", "induced", "inducing", "promote", "promotes",
  "enhance", "enhances", "enhanced", "inhibit", "inhibits", "inhibited", "suppress", "suppresses",
  "elevate", "elevated", "boost", "boosts", "restore", "restores", "prevent", "prevents", "protect",
  "protects", "change", "changes", "changed", "alter", "alters", "altered", "affect", "affects", "affected",
  "exposure", "exposed", "exposing", "supplementation", "supplemented", "supplementing", "supplement",
  "administration", "administered", "administering", "incubated", "grown", "growing", "maintained",
  "sensitivity", "specificity", "accuracy", "performance", "efficiency", "rate", "time", "times",
  "amount", "number", "fraction", "ratio", "value", "values", "unit", "units", "volume", "weight",
  "laboratory", "lab", "commercial", "standardized", "conventional", "typical", "existing", "current",
  "preprocessing", "processing", "procedure", "approach", "method", "technique", "design", "designed",
  "whole", "full", "single", "multiple", "several", "various", "different", "specific", "similar",
  "least", "greater", "smaller", "larger", "longer", "shorter", "faster", "slower", "better", "worse",
  "capable", "able", "ability", "allow", "allows", "enable", "enables", "provide", "provides", "yield",
  "yields", "achieve", "achieves", "reach", "reaches", "remain", "remains", "become", "becomes",
  "presence", "absence", "present", "absent", "following", "prior", "subsequent", "pre", "post",
]);

// Real but weak modifiers: kept, with little weight.
const LOW = new Set([
  "intracellular", "extracellular", "cellular", "primary", "secondary", "whole", "total", "mean",
  "average", "overall", "early", "late", "acute", "chronic", "basal", "paper", "blood", "serum", "plasma",
  "tissue", "tissues", "luminescent", "fluorescent", "colorimetric",
]);

// Biomedical topic nouns that identify what is measured.
const TOPIC = new Set([
  "lipid", "lipids", "glucose", "insulin", "cholesterol", "triglyceride", "triglycerides", "steatosis",
  "apoptosis", "autophagy", "inflammation", "fibrosis", "oxidative", "mitochondrial", "senescence",
  "proliferation", "migration", "invasion", "viability", "differentiation", "angiogenesis", "metastasis",
  "biofilm", "biofilms", "antibody", "antibodies", "antigen", "biosensor", "immunosensor", "aptamer",
  "nanoparticle", "nanoparticles", "hydrogel", "scaffold", "cathode", "anode", "electrolyte", "catalyst",
  "plasmid", "promoter", "enhancer", "methylation", "acetylation", "phosphorylation", "ubiquitination",
  "organoids", "spheroids", "tumor", "tumour", "cancer",
  "carcinoma", "leukemia", "lymphoma", "glioma", "neuroblastoma", "melanoma", "obesity", "diabetes",
]);

// Cell types: they describe the system, which a named cell line (HepG2)
// usually pins down already, so they weigh less than the topic nouns.
const CELL_TYPE = new Set([
  "neurons", "neuron", "astrocytes", "astrocyte", "microglia", "macrophages", "macrophage", "hepatocytes",
  "hepatocyte", "cardiomyocytes", "cardiomyocyte", "fibroblasts", "fibroblast", "keratinocytes",
  "keratinocyte", "adipocytes", "adipocyte", "myotubes", "myoblasts", "lymphocytes", "monocytes",
]);

// Words that end like compound names but are not.
const NOT_COMPOUND = new Set([
  "protein", "proteins", "within", "determine", "examine", "immediate", "evaluate", "demonstrate",
  "intermediate", "approximate", "accumulate", "concentrate", "separate", "estimate", "moderate",
  "medicine", "routine", "baseline", "online", "decline", "guideline", "combine", "define", "outline",
  "pipeline", "machine", "alone", "control", "protocol", "candidate", "adequate", "appropriate",
  "accurate", "ultimate", "duplicate", "triplicate", "replicate", "indicate", "investigate", "generate",
  "activate", "deactivate", "illustrate", "facilitate", "eliminate", "regulate", "modulate", "stimulate",
  "translate", "isolate", "simulate", "calculate", "correlate", "validate", "incubate", "elevate",
  "initiate", "mediate", "terminate", "aggregate", "substrate", "rate", "state", "late", "date",
  "plate", "glycerol", "patrol", "decide", "provide", "guide", "inside", "outside", "beside", "wide",
  "side", "override", "divide", "worldwide", "tone", "zone", "phone", "done", "gone", "none", "bone",
  "stone", "alongside", "objective", "positive", "negative",
]);

// Ends like a drug, metabolite or reagent name.
const COMPOUND_SUFFIX = /(?:formin|mycin|cillin|statin|azole|olol|pril|sartan|mab|nib|vir|tide|oside|amide|amine|ine|ate|ide|ol|one|ose|in|ium|yl|ene|ane|ase)$/;

// Methods, organisms and materials that almost always identify the topic.
const SALIENT = new Set([
  "pcr", "qpcr", "rt-pcr", "crispr", "cas9", "rna-seq", "scrna-seq", "elisa", "chip-seq", "atac-seq",
  "western", "cytometry", "microscopy", "confocal", "cryo-em", "hplc", "nmr", "knockout", "knockdown",
  "transfection", "transduction", "sequencing", "mouse", "mice", "rat", "rats", "zebrafish", "axolotl",
  "drosophila", "elegans", "arabidopsis", "coli", "yeast", "bacteria", "bacterium", "archaea", "hela",
  "trehalose", "dmso", "cryoprotectant", "nanofiber", "graphene", "silicon", "perovskite",
  "photovoltaic", "supercapacitor", "virus", "oncolytic", "spirulina", "phycocyanin",
]);

// Counter-ions and salt forms: "sodium palmitate" is about palmitate. Run
// 78967afc ranked sodium-palmitate papers above metformin ones because
// "sodium" weighed as much as the compound.
const COUNTER_ION = new Set(["sodium", "potassium", "chloride", "hydrochloride", "magnesium", "calcium", "salt"]);

// "compared with vehicle-treated controls", "matching laboratory ELISA sensitivity".
const COMPARATOR_CUE = new Set(["compared", "comparable", "versus", "vs", "than", "matching", "relative", "against", "outperform", "outperforming", "unlike"]);
const COMPARATOR_SPAN = 4;

const UNIT = /^(?:[nµμu]?m|mm|pm|[nµμum]?g|mg\/kg|mg\/ml|[µμu]g\/ml|ng\/ml|mg\/l|[mµμu]?l|ml|kg|h|hr|hrs|min|mins|sec|s|°c|c|rpm|x|nm|kda|da|v|mv|ma|hz|khz|mhz|w|kw|bp|kb|mb|wt|v\/v|w\/v)$/;

/** Lower-case, Unicode-compatible form (µ micro sign and μ Greek mu become "u"). */
export function normText(s: string): string {
  return (s ?? "").normalize("NFKC").replace(/[µμ]/g, "u").toLowerCase();
}

/** Comparable form of one word: no trailing "+" (NAD+), crude plural/inflection stem. */
export function stemWord(w: string): string {
  let t = w.replace(/\++$/, "");
  if (t.length > 5 && t.endsWith("ies")) t = `${t.slice(0, -3)}y`;
  else if (t.length > 4 && t.endsWith("es") && /(?:ses|xes|ches|shes)$/.test(t)) t = t.slice(0, -2);
  else if (t.length > 4 && t.endsWith("s") && !t.endsWith("ss") && !t.endsWith("us") && !t.endsWith("is")) t = t.slice(0, -1);
  return t;
}

/** Two words name the same thing: equal stems, or a shared prefix of 5+ letters covering 70% of the shorter. */
export function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5) return false;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  let k = 0;
  while (k < s.length && s[k] === l[k]) k++;
  return k >= 5 && k >= 0.7 * s.length;
}

interface RawToken {
  /** Original spelling. */
  raw: string;
  /** normText + punctuation trimmed. */
  norm: string;
  /** Inside parentheses in the original text. */
  paren: boolean;
  /** Ends a sentence clause (a comma, period or semicolon follows it). */
  clauseEnd: boolean;
}

function rawTokens(text: string): RawToken[] {
  const out: RawToken[] = [];
  // Split on whitespace and slashes between words (NAD/NADH); keep "+", "-", "." inside words.
  const re = /[^\s/]+/g;
  let depth = 0;
  for (const m of text.matchAll(re)) {
    let raw = m[0];
    const opens = (raw.match(/\(/g) ?? []).length;
    const closes = (raw.match(/\)/g) ?? []).length;
    const paren = depth > 0 || opens > 0;
    depth = Math.max(0, depth + opens - closes);
    const clauseEnd = /[,;.:]$/.test(raw.replace(/[)\]"']+$/, ""));
    raw = raw.replace(/^[("'[]+|[)"'\],;:.!?]+$/g, "").replace(/[()]/g, "");
    if (!raw) continue;
    const norm = normText(raw).replace(/^[-.]+|[-.]+$/g, "");
    out.push({ raw, norm, paren, clauseEnd });
  }
  return out;
}

function isNumberish(t: string): boolean {
  return /^[<>~≈±]?\d+(?:[.,]\d+)?(?:%|x|-fold)?$/.test(t) || /^\d+(?:[.,]\d+)?[a-z°%/]+$/.test(t) && UNIT.test(t.replace(/^\d+(?:[.,]\d+)?/, ""));
}

function wordWeight(w: string, raw: string, caseless: boolean): number {
  const hasDigit = /\d/.test(w);
  const hasLetter = /[a-z]/.test(w);
  if (hasDigit && hasLetter) return 3;                                    // HepG2, SH-SY5Y, IL-6, p53
  const acronym = !caseless && /^[A-Z][A-Z0-9+]{1,7}$/.test(raw.replace(/-/g, "")) && /[A-Z].*[A-Z]/.test(raw);
  if (w.endsWith("+") || acronym) return 2.5;                             // NAD+, NMN, CRP, ELISA
  if (COUNTER_ION.has(w)) return 0.5;
  if (SALIENT.has(w)) return 2;
  if (TOPIC.has(w)) return 2;
  if (CELL_TYPE.has(w)) return 1.5;
  if (LOW.has(w)) return 0.5;
  if (w.length >= 6 && COMPOUND_SUFFIX.test(w) && !NOT_COMPOUND.has(w)) return 2.5; // metformin, palmitate
  if (/(?:ized|ised|ated|ing|ed)$/.test(w)) return 0.5;                  // functionalized, coated
  if (w.length >= 9) return 1.5;
  if (w.length >= 6) return 1;
  return 0.7;
}

function skipWord(w: string): boolean {
  if (!w || STOP.has(w) || GENERIC.has(w) || GENERIC.has(stemWord(w))) return true;
  if (isNumberish(w) || UNIT.test(w)) return true;
  if (w.length < 3 && !/\d/.test(w)) return true;
  if (!/[a-z]/.test(w)) return true;
  return false;
}

/**
 * Weighted concepts of a hypothesis, heaviest first.
 *
 * Weights: alphanumeric names (cell lines, genes) 3; acronyms and names
 * ending in "+" 2.5; compound-like names (metformin, palmitate) 2.5; topic
 * nouns and common methods 2; other long words 1-1.5; weak modifiers 0.5.
 * Words after a comparison cue count 40% (the comparator is not the
 * subject). "nicotinamide mononucleotide (NMN)" becomes one concept that a
 * text mentions with either spelling.
 */
export function hypothesisConcepts(text: string): Concept[] {
  const tokens = rawTokens(text ?? "");
  const letters = (text ?? "").replace(/[^A-Za-z]/g, "");
  const upper = letters.replace(/[^A-Z]/g, "").length;
  const caseless = letters.length > 20 && upper / letters.length > 0.6;  // ALL-CAPS input

  const concepts: Concept[] = [];
  let comparatorLeft = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const w = tok.norm;
    const inComparator = comparatorLeft > 0;
    if (COMPARATOR_CUE.has(w)) comparatorLeft = COMPARATOR_SPAN + 1;
    if (comparatorLeft > 0) comparatorLeft--;
    if (tok.clauseEnd) comparatorLeft = 0;

    // Hyphenated words: weigh the whole word and its parts ("anti-CRP" counts as CRP).
    const parts = w.includes("-") ? w.split("-").filter(Boolean) : [];
    const rawParts = tok.raw.includes("-") ? tok.raw.split("-").filter(Boolean) : [];
    let weight: number;
    let partForms: string[][] = [];
    if (parts.length > 1) {
      const kept = parts.map((p, k) => (skipWord(p) || p.length < 2 ? 0 : wordWeight(p, rawParts[k] ?? p, caseless)));
      if (kept.every((x) => x === 0) && !/\d/.test(w)) continue;          // "vehicle-treated"
      weight = Math.max(/\d/.test(w) ? 3 : 0, ...kept);
      // "anti-CRP" is also mentioned by a text that says "CRP".
      partForms = parts.filter((_, k) => kept[k] >= 2).map((p) => [stemWord(p)]);
    } else {
      if (skipWord(w)) continue;
      weight = wordWeight(w, tok.raw, caseless);
    }
    if (inComparator) weight *= 0.4;

    // "nicotinamide mononucleotide (NMN)": the acronym is another spelling of
    // the words just before it.
    if (tok.paren && weight >= 2.5 && concepts.length > 0 && /^[a-z0-9+]{2,8}$/.test(w)) {
      // The concepts just before it, starting at the one whose initial is the
      // acronym's ("nicotinamide mononucleotide (NMN)"; "HepG2 cells (ATCC)" is no alias).
      let prev = concepts.filter((c) => c.pos >= i - 4 && c.pos < i && !c.comparator).sort((a, b) => a.pos - b.pos);
      const start = prev.findIndex((c) => normText(c.query).startsWith(w[0]));
      prev = start >= 0 ? prev.slice(start) : [];
      if (prev.length > 0) {
        const phrase = prev.map((c) => c.query).join(" ");
        const phraseForm = prev.flatMap((c) => c.forms[0]);
        const merged: Concept = {
          query: phrase,
          forms: [phraseForm, [stemWord(w)]],
          weight: Math.max(weight, ...prev.map((c) => c.weight)),
          pos: prev[0].pos,
          comparator: false,
        };
        for (const p of prev) concepts.splice(concepts.indexOf(p), 1);
        concepts.push(merged);
        continue;
      }
    }

    const form = [stemWord(w)];
    const existing = concepts.find((c) => c.forms.some((f) => f.length === 1 && wordsMatch(f[0], form[0])));
    if (existing) {
      if (weight > existing.weight) { existing.weight = weight; existing.comparator = inComparator; }
      continue;
    }
    concepts.push({ query: tok.raw, forms: [form, ...partForms], weight, pos: i, comparator: inComparator });
  }
  return concepts.sort((a, b) => b.weight - a.weight || a.pos - b.pos);
}

/** Normalised, stemmed words of a text (titles, abstracts, material names). */
export function textWords(text: string): string[] {
  const out: string[] = [];
  for (const raw of normText(text ?? "").split(/[^\p{L}\p{N}+-]+/u)) {
    const t = raw.replace(/^[-+]+|-+$/g, "");
    if (!t) continue;
    out.push(stemWord(t));
    if (t.includes("-")) {
      out.push(stemWord(t.replace(/-/g, "")));
      for (const p of t.split("-")) if (p) out.push(stemWord(p));
    }
  }
  return out;
}

/** Whether `words` (from textWords) mention the concept. */
export function mentions(words: string[] | Set<string>, c: Concept): boolean {
  const list = Array.isArray(words) ? words : [...words];
  const set = new Set(list);
  return c.forms.some((form) => form.every((fw) => set.has(fw) || set.has(fw.replace(/-/g, "")) || list.some((w) => wordsMatch(w, fw))));
}

export interface Coverage {
  /** Weighted share of the hypothesis concepts the text mentions (0-1). */
  score: number;
  matched: Concept[];
}

/** How much of the hypothesis a text (a paper's title + abstract, a materials list) covers. */
export function coverage(concepts: Concept[], text: string): Coverage {
  const total = concepts.reduce((s, c) => s + c.weight, 0);
  if (total === 0) return { score: 0, matched: [] };
  const words = textWords(text);
  const matched = concepts.filter((c) => mentions(words, c));
  return { score: matched.reduce((s, c) => s + c.weight, 0) / total, matched };
}

/**
 * Relevance of a paper to the hypothesis: the mean of its title's coverage
 * and its title + abstract coverage. A title says what a paper is about; an
 * abstract that mentions metformin as a positive control (a herbal-compound
 * study) should not outrank "Metformin regulates palmitate-induced ... in
 * HepG2 cells". Papers without an abstract (PubMed summaries) score their
 * title only.
 */
export function paperRelevance(concepts: Concept[], title: string, abstract?: string | null): Coverage {
  const t = coverage(concepts, title ?? "");
  if (!abstract) return t;
  const full = coverage(concepts, `${title ?? ""} ${abstract}`);
  return { score: (t.score + full.score) / 2, matched: full.matched };
}

/** The `k` heaviest concepts as a keyword query, in sentence order. */
export function keywordQuery(concepts: Concept[], k: number): string {
  const top = concepts.filter((c) => !c.comparator).slice(0, k);
  return top.sort((a, b) => a.pos - b.pos).map((c) => c.query).join(" ");
}

/**
 * The intervention and outcome without the system: the 3 heaviest concepts
 * weighing 2 to 2.5 ("metformin palmitate lipid", "nicotinamide
 * mononucleotide NAD+ NADH"). Prior work on the same intervention in another
 * cell line is still prior work. Empty when fewer than 2 such concepts.
 */
export function coreQuery(concepts: Concept[]): string {
  const core = concepts.filter((c) => !c.comparator && c.weight >= 2 && c.weight < 3).slice(0, 3);
  return core.length >= 2 ? core.sort((a, b) => a.pos - b.pos).map((c) => c.query).join(" ") : "";
}

/**
 * What a plan's materials must name: the subject concepts of weight >= 2
 * (cell line or organism, compound or intervention, topic), comparators
 * excluded.
 */
export function anchorConcepts(concepts: Concept[]): Concept[] {
  return concepts.filter((c) => c.weight >= 2 && !c.comparator);
}
