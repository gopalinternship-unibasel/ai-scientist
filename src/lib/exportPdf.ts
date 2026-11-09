// PDF export for ExperimentPlan.
// Uses jsPDF directly so we get pixel-accurate page breaks, a real cover sheet,
// and consistent typography — unlike `window.print()` which depended on screen CSS.
import { jsPDF } from "jspdf";
import type { ExperimentPlan, LiteratureQC } from "@/lib/samples";
import { budgetTotal, checkLabel, costLineItems, planCheckNotes, verifiedSource } from "@/lib/planIntegrity";

const PAGE = { w: 210, h: 297 }; // A4 mm
const M = 18;                    // margin
const COL = PAGE.w - M * 2;

interface Ctx {
  doc: jsPDF;
  y: number;
  page: number;
}

const fmtUsd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

// jsPDF's built-in Helvetica is WinAnsi-only. Unicode chars outside that range
// (Greek letters, arrows, em-dashes, curly quotes, μ, •, →, ↳, etc.) either
// render as the wrong glyph (α → ±, → → !') or break splitTextToSize so the
// text comes out letter-spaced and clipped at the right margin. We don't ship
// a custom TTF, so transliterate to ASCII before drawing.
// Anything outside Latin-1 (U+0000-U+00FF). Each half of a surrogate pair is
// in this range too, as it was with the original negated Latin-1 class.
const NON_LATIN1 = /[Ā-￿]/g;

function ascii(s: string): string {
  if (!s) return "";
  return s
    .replace(/\u00a0/g, " ")
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u2022\u25cf\u00b7]/g, "-")
    .replace(/\u2192/g, "->")
    .replace(/\u21b3/g, "->")
    .replace(/\u2190/g, "<-")
    .replace(/\u2194/g, "<->")
    .replace(/[\u2264]/g, "<=")
    .replace(/[\u2265]/g, ">=")
    .replace(/\u00d7/g, "x")
    .replace(/\u03b1/g, "alpha")
    .replace(/\u03b2/g, "beta")
    .replace(/\u03b3/g, "gamma")
    .replace(/\u03bc|\u00b5/g, "u")
    .replace(/\u03c3/g, "sigma")
    .replace(/\u00b0/g, "deg")
    .replace(/\u00b1/g, "+/-")
    .replace(NON_LATIN1, "?");
}

function ensureSpace(ctx: Ctx, needed: number, footer: () => void) {
  if (ctx.y + needed > PAGE.h - M - 10) {
    footer();
    ctx.doc.addPage();
    ctx.page += 1;
    ctx.y = M;
  }
}

function drawFooter(doc: jsPDF, plan: ExperimentPlan, page: number, total: number | null) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(plan.title.slice(0, 80), M, PAGE.h - 8);
  const right = total ? `${page} / ${total}` : `${page}`;
  doc.text(right, PAGE.w - M, PAGE.h - 8, { align: "right" });
  doc.setTextColor(0);
}

function heading(ctx: Ctx, num: string, label: string, footer: () => void) {
  ensureSpace(ctx, 18, footer);
  ctx.doc.setDrawColor(220);
  ctx.doc.line(M, ctx.y, PAGE.w - M, ctx.y);
  ctx.y += 6;
  ctx.doc.setFont("helvetica", "bold");
  ctx.doc.setFontSize(9);
  ctx.doc.setTextColor(140);
  ctx.doc.text(`§ ${num}`, M, ctx.y);
  ctx.doc.setFontSize(13);
  ctx.doc.setTextColor(20);
  ctx.doc.text(label, M + 14, ctx.y);
  ctx.y += 8;
}

function paragraph(ctx: Ctx, text: string, footer: () => void, opts?: { italic?: boolean; size?: number; color?: number }) {
  ctx.doc.setFont("helvetica", opts?.italic ? "italic" : "normal");
  ctx.doc.setFontSize(opts?.size ?? 10);
  ctx.doc.setTextColor(opts?.color ?? 40);
  const lines = ctx.doc.splitTextToSize(text, COL);
  for (const line of lines) {
    ensureSpace(ctx, 5, footer);
    ctx.doc.text(line, M, ctx.y);
    ctx.y += 5;
  }
}

function bullet(ctx: Ctx, text: string, footer: () => void) {
  ctx.doc.setFont("helvetica", "normal");
  ctx.doc.setFontSize(10);
  ctx.doc.setTextColor(40);
  const lines = ctx.doc.splitTextToSize(text, COL - 5);
  for (let i = 0; i < lines.length; i++) {
    ensureSpace(ctx, 5, footer);
    if (i === 0) ctx.doc.text("•", M, ctx.y);
    ctx.doc.text(lines[i], M + 5, ctx.y);
    ctx.y += 5;
  }
}

function kv(ctx: Ctx, label: string, value: string, footer: () => void) {
  ensureSpace(ctx, 10, footer);
  ctx.doc.setFont("helvetica", "bold");
  ctx.doc.setFontSize(8);
  ctx.doc.setTextColor(120);
  ctx.doc.text(label.toUpperCase(), M, ctx.y);
  ctx.y += 4;
  paragraph(ctx, value, footer);
  ctx.y += 1;
}

/**
 * @param references the run's literature-QC references. The protocol cites
 *   them as [N] (1-based, in this order), so the PDF lists them at the end;
 *   without the list an exported plan's citations could not be resolved.
 */
export function exportPlanToPdf(
  plan: ExperimentPlan,
  hypothesis: string,
  version = 1,
  references: LiteratureQC["references"] = [],
) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  // Wrap text-emitting APIs so every caller is sanitized to WinAnsi-safe ASCII.
  // jsPDF's built-in fonts can't render arbitrary Unicode and silently break
  // line-wrapping when they encounter unsupported codepoints.
  const origText = doc.text.bind(doc) as (t: unknown, x: number, y: number, opts?: unknown) => jsPDF;
  doc.text = ((t: unknown, x: number, y: number, opts?: unknown) => {
    if (typeof t === "string") return origText(ascii(t), x, y, opts);
    if (Array.isArray(t)) return origText(t.map((s) => typeof s === "string" ? ascii(s) : s), x, y, opts);
    return origText(t, x, y, opts);
  }) as typeof doc.text;
  const origSplit = doc.splitTextToSize.bind(doc) as (t: unknown, w: number, opts?: unknown) => string[];
  doc.splitTextToSize = ((t: unknown, w: number, opts?: unknown) => {
    if (typeof t === "string") return origSplit(ascii(t), w, opts);
    return origSplit(t, w, opts);
  }) as typeof doc.splitTextToSize;

  const ctx: Ctx = { doc, y: M, page: 1 };
  const footer = () => drawFooter(doc, plan, ctx.page, null);

  // ── Cover page ────────────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(140);
  doc.text("THE AI SCIENTIST · EXPERIMENT PLAN", M, M + 4);

  doc.setDrawColor(40);
  doc.setLineWidth(0.4);
  doc.line(M, M + 8, PAGE.w - M, M + 8);

  ctx.y = M + 30;
  doc.setFont("times", "bold");
  doc.setFontSize(24);
  doc.setTextColor(20);
  const titleLines = doc.splitTextToSize(plan.title, COL);
  for (const line of titleLines) {
    doc.text(line, M, ctx.y);
    ctx.y += 10;
  }

  ctx.y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(80);
  const summaryLines = doc.splitTextToSize(plan.summary, COL);
  for (const line of summaryLines) {
    doc.text(line, M, ctx.y);
    ctx.y += 6;
  }

  ctx.y += 10;
  doc.setDrawColor(200);
  doc.line(M, ctx.y, PAGE.w - M, ctx.y);
  ctx.y += 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text("HYPOTHESIS", M, ctx.y);
  ctx.y += 5;
  doc.setFont("times", "italic");
  doc.setFontSize(11);
  doc.setTextColor(40);
  const hLines = doc.splitTextToSize(hypothesis, COL);
  for (const line of hLines) { doc.text(line, M, ctx.y); ctx.y += 6; }

  ctx.y += 10;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(80);
  const meta = [
    ["Domain", plan.domain],
    ["Total budget", fmtUsd(budgetTotal(plan.budget))],
    ["Phases", `${plan.timeline.length}`],
    ["Protocol steps", `${plan.protocol.length}`],
    ["Reagents", `${plan.materials.length}`],
    ["Version", `v${version}`],
    ["Generated", new Date().toLocaleDateString()],
  ];
  for (const [k, v] of meta) {
    doc.setFont("helvetica", "bold"); doc.text(k.toUpperCase(), M, ctx.y);
    doc.setFont("helvetica", "normal"); doc.text(String(v), M + 45, ctx.y);
    ctx.y += 6;
  }

  // Automated checks (deterministic guards): what was corrected or flagged.
  const checks = planCheckNotes(plan, references);
  if (checks.length) {
    ctx.y += 4;
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(120);
    doc.text("AUTOMATED CHECKS", M, ctx.y);
    ctx.y += 5;
    for (const c of checks) {
      const label = checkLabel(c);
      const lines = doc.splitTextToSize(`${label}: ${c.detail}`, COL);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(label === "Check" ? 150 : 80);
      for (const line of lines) {
        if (ctx.y > PAGE.h - M - 14) break;
        doc.text(line, M, ctx.y);
        ctx.y += 4.5;
      }
      ctx.y += 1;
    }
  }

  drawFooter(doc, plan, ctx.page, null);
  doc.addPage();
  ctx.page += 1;
  ctx.y = M;

  // ── 01 Success criteria ──────────────────────────────────────────────────
  heading(ctx, "01", "Success criteria", footer);
  for (const c of plan.success_criteria) bullet(ctx, c, footer);
  ctx.y += 4;

  // ── 02 Protocol ──────────────────────────────────────────────────────────
  heading(ctx, "02", "Protocol", footer);
  for (const s of plan.protocol) {
    ensureSpace(ctx, 12, footer);
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(20);
    doc.text(`${s.step}. ${s.title}`, M, ctx.y);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(120);
    doc.text(s.duration, PAGE.w - M, ctx.y, { align: "right" });
    ctx.y += 5;
    paragraph(ctx, s.description, footer, { size: 9, color: 60 });
    // Only retrieved references (or a plain label) are printed as a source.
    const source = verifiedSource(s.source, references);
    if (source) paragraph(ctx, `↳ ${source}`, footer, { size: 8, color: 120 });
    ctx.y += 2;
  }

  // ── 03 Materials ─────────────────────────────────────────────────────────
  heading(ctx, "03", "Materials & supply chain", footer);
  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(120);
  doc.text("REAGENT", M, ctx.y);
  doc.text("SUPPLIER", M + 70, ctx.y);
  doc.text("QTY", M + 110, ctx.y);
  doc.text("TOTAL", PAGE.w - M, ctx.y, { align: "right" });
  ctx.y += 4;
  doc.setDrawColor(200); doc.line(M, ctx.y, PAGE.w - M, ctx.y); ctx.y += 4;
  let materialsTotal = 0;
  for (const m of plan.materials) {
    ensureSpace(ctx, 8, footer);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(30);
    const nameLines = doc.splitTextToSize(m.name, 65);
    doc.text(nameLines[0], M, ctx.y);
    doc.text(doc.splitTextToSize(m.supplier, 38)[0], M + 70, ctx.y);
    doc.text(String(m.quantity), M + 110, ctx.y);
    doc.text(fmtUsd(m.total_cost_usd), PAGE.w - M, ctx.y, { align: "right" });
    ctx.y += 5;
    materialsTotal += m.total_cost_usd ?? 0;
  }
  doc.setDrawColor(60); doc.line(M, ctx.y, PAGE.w - M, ctx.y); ctx.y += 4;
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(20);
  doc.text("Subtotal", M, ctx.y);
  doc.text(fmtUsd(materialsTotal), PAGE.w - M, ctx.y, { align: "right" });
  ctx.y += 8;

  // ── 04 Budget ────────────────────────────────────────────────────────────
  heading(ctx, "04", "Budget", footer);
  for (const li of costLineItems(plan.budget.line_items)) {
    ensureSpace(ctx, 6, footer);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(30);
    doc.text(li.category, M, ctx.y);
    doc.text(fmtUsd(li.amount_usd), PAGE.w - M, ctx.y, { align: "right" });
    ctx.y += 5;
    if (li.note) {
      doc.setFontSize(8); doc.setTextColor(120);
      doc.text(li.note, M, ctx.y); ctx.y += 4;
    }
  }
  ctx.y += 2;
  doc.setDrawColor(60); doc.line(M, ctx.y, PAGE.w - M, ctx.y); ctx.y += 5;
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(20);
  doc.text("Total (sum of line items)", M, ctx.y);
  doc.text(fmtUsd(budgetTotal(plan.budget)), PAGE.w - M, ctx.y, { align: "right" });
  ctx.y += 8;

  // ── 05 Timeline ──────────────────────────────────────────────────────────
  heading(ctx, "05", "Timeline", footer);
  for (const p of plan.timeline) {
    ensureSpace(ctx, 12, footer);
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(20);
    doc.text(p.phase, M, ctx.y);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(120);
    doc.text(p.duration, PAGE.w - M, ctx.y, { align: "right" });
    ctx.y += 5;
    for (const d of p.deliverables) bullet(ctx, d, footer);
    if (p.dependencies?.length) paragraph(ctx, `Depends on: ${p.dependencies.join(", ")}`, footer, { size: 8, color: 120 });
    ctx.y += 3;
  }

  // ── 06 Validation ────────────────────────────────────────────────────────
  heading(ctx, "06", "Validation", footer);
  paragraph(ctx, plan.validation.approach, footer);
  ctx.y += 2;
  kv(ctx, "Primary metric", plan.validation.primary_metric, footer);
  if (plan.validation.statistical_plan) kv(ctx, "Statistical plan", plan.validation.statistical_plan, footer);
  kv(ctx, "Controls", plan.validation.controls.join(", "), footer);

  // ── 07 Statistical design ───────────────────────────────────────────────
  if (plan.statistical_design) {
    const sd = plan.statistical_design;
    heading(ctx, "07", "Statistical design", footer);
    kv(ctx, "Groups", sd.groups.join(", "), footer);
    kv(ctx, "N per group", String(sd.n_per_group), footer);
    kv(ctx, "Primary test", sd.primary_test, footer);
    kv(ctx, "Effect size", sd.effect_size, footer);
    kv(ctx, "Alpha / Power", `α = ${sd.alpha} · power = ${sd.power}`, footer);
    kv(ctx, "Randomization", sd.randomization, footer);
    kv(ctx, "Blinding", sd.blinding, footer);
    if (sd.notes) paragraph(ctx, sd.notes, footer, { size: 9, color: 60 });
  }

  // ── 08 Safety ────────────────────────────────────────────────────────────
  if (plan.safety) {
    const s = plan.safety;
    heading(ctx, "08", "Safety & approvals", footer);
    const flags = [
      s.biosafety_level,
      s.irb_required ? "IRB required" : null,
      s.iacuc_required ? "IACUC required" : null,
      s.ibc_required ? "IBC required" : null,
      s.controlled_substances ? "Controlled substances" : null,
    ].filter(Boolean) as string[];
    kv(ctx, "Approvals", flags.join(" · "), footer);
    if (s.hazards.length) kv(ctx, "Hazards", s.hazards.join("; "), footer);
    if (s.ppe.length) kv(ctx, "PPE", s.ppe.join(", "), footer);
    kv(ctx, "Waste handling", s.waste_handling, footer);
    kv(ctx, "Emergency procedure", s.emergency_procedure, footer);
  }

  // ── 09 Risks ─────────────────────────────────────────────────────────────
  if (plan.risks?.length) {
    heading(ctx, "09", "Risks & mitigations", footer);
    for (const r of plan.risks) {
      ensureSpace(ctx, 10, footer);
      doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(20);
      doc.text(r.risk, M, ctx.y); ctx.y += 5;
      paragraph(ctx, `→ ${r.mitigation}`, footer, { size: 9, color: 60 });
      ctx.y += 2;
    }
  }

  // ── 10 Team ──────────────────────────────────────────────────────────────
  if (plan.team?.length) {
    heading(ctx, "10", "Team", footer);
    for (const t of plan.team) {
      ensureSpace(ctx, 6, footer);
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(30);
      doc.text(t.role, M, ctx.y);
      doc.text(`${t.fte} FTE`, PAGE.w - M, ctx.y, { align: "right" });
      ctx.y += 5;
    }
  }

  // ── References ───────────────────────────────────────────────────────────
  if (references.length) {
    heading(ctx, "11", "References", footer);
    references.forEach((r, i) => {
      const authors = (r.authors ?? []).slice(0, 3).join(", ") + ((r.authors?.length ?? 0) > 3 ? " et al." : "");
      const meta = [authors, r.venue, r.year].filter(Boolean).join(" - ");
      paragraph(ctx, `[${i + 1}] ${r.title}`, footer, { size: 10, color: 20 });
      if (meta) paragraph(ctx, meta, footer, { size: 9, color: 80 });
      if (r.url) paragraph(ctx, r.url, footer, { size: 9, color: 80 });
      ctx.y += 2;
    });
  }

  // Footer pass: now we know total pages.
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    drawFooter(doc, plan, p, total);
  }

  const slug = plan.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "experiment-plan";
  doc.save(`${slug}-v${version}.pdf`);
}
