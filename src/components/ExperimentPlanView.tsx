import { useMemo } from "react";
import {
  FlaskConical,
  Beaker,
  CalendarRange,
  ShoppingCart,
  Target,
  AlertTriangle,
  Users,
  CircleDollarSign,
  ListChecks,
  Quote,
  Printer,
  Share2,
  Sigma,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { ExperimentPlan } from "@/lib/samples";

/**
 * Plan section. On mobile (< md) the body is collapsible via a native <details>
 * element so users can scan the plan without endless scrolling. On md+ screens
 * everything is always visible (and prints expanded).
 */
const Section = ({
  icon: Icon,
  label,
  number,
  children,
  defaultOpen = true,
}: {
  icon: React.ElementType;
  label: string;
  number: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) => {
  const header = (
    <>
      <span className="flex h-7 w-7 items-center justify-center rounded-sm bg-primary text-primary-foreground">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        § {number}
      </span>
      <h2 className="font-serif text-xl font-semibold text-foreground">{label}</h2>
    </>
  );
  return (
    <section className="paper-surface rounded-lg p-6 md:p-8 animate-fade-in">
      {/* Mobile: collapsible */}
      <details open={defaultOpen} className="md:hidden group">
        <summary className="mb-5 flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
          {header}
          <svg
            className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </summary>
        {children}
      </details>
      {/* Desktop / print: always expanded */}
      <div className="hidden md:block">
        <header className="mb-5 flex items-center gap-3">{header}</header>
        {children}
      </div>
    </section>
  );
};

const fmtUsd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export const ExperimentPlanView = ({ plan }: { plan: ExperimentPlan }) => {
  const materialsTotal = useMemo(
    () => plan.materials.reduce((s, m) => s + (m.total_cost_usd ?? 0), 0),
    [plan.materials]
  );

  const onShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied to clipboard");
    } catch {
      toast.error("Could not copy link");
    }
  };

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="no-print flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onShare} className="gap-2">
          <Share2 className="h-3.5 w-3.5" /> Share
        </Button>
        <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-2">
          <Printer className="h-3.5 w-3.5" /> Save as PDF
        </Button>
      </div>

      {/* Header card */}
      <section className="paper-surface relative overflow-hidden rounded-lg p-6 md:p-10 animate-fade-in">
        <div className="absolute right-6 top-6 flex flex-col items-end gap-2">
          <span className="stamp border-accent/40 bg-accent/10 text-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Experiment Plan
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {plan.domain}
          </span>
        </div>

        <div className="max-w-3xl">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Stage 03
          </div>
          <h1 className="mt-2 font-serif text-3xl font-semibold leading-tight text-foreground md:text-4xl">
            {plan.title}
          </h1>
          <p className="mt-4 font-serif text-base leading-relaxed text-foreground/80 md:text-lg">
            {plan.summary}
          </p>

          <div className="mt-6 rounded-md border-l-2 border-accent bg-paper p-4">
            <div className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              <Quote className="h-3 w-3" /> Hypothesis
            </div>
            <p className="font-serif italic text-foreground/90">{plan.hypothesis_restated}</p>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="Total budget" value={fmtUsd(plan.budget.total_usd)} />
            <Stat
              label="Timeline"
              value={`${plan.timeline.length} phases`}
              sub={plan.timeline.map((p) => p.duration).slice(0, 1)[0]}
            />
            <Stat label="Protocol steps" value={`${plan.protocol.length}`} sub={`${plan.materials.length} reagents`} />
          </div>
        </div>
      </section>

      <Section number="01" label="Success criteria" icon={Target}>
        <ul className="space-y-2">
          {plan.success_criteria.map((c, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent" />
              <span className="font-serif text-[15px] leading-relaxed text-foreground/90">{c}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section number="02" label="Protocol" icon={FlaskConical}>
        <ol className="relative space-y-5 border-l border-rule pl-6">
          {plan.protocol.map((s) => (
            <li key={s.step} className="relative">
              <span className="absolute -left-[31px] top-0 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-paper font-mono text-[11px] font-semibold text-foreground">
                {s.step}
              </span>
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h3 className="font-serif text-base font-semibold text-foreground">{s.title}</h3>
                <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  {s.duration}
                </span>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-foreground/80">{s.description}</p>
              {s.source && (
                <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">↳ {s.source}</p>
              )}
            </li>
          ))}
        </ol>
      </Section>

      <Section number="03" label="Materials & supply chain" icon={ShoppingCart}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rule text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Reagent</th>
                <th className="py-2 pr-4 font-medium">Supplier</th>
                <th className="py-2 pr-4 font-medium">Cat #</th>
                <th className="py-2 pr-4 font-medium">Qty</th>
                <th className="py-2 pr-4 text-right font-medium">Unit</th>
                <th className="py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {plan.materials.map((m, i) => (
                <tr key={i} className="align-top">
                  <td className="py-2.5 pr-4">
                    <div className="font-medium text-foreground">{m.name}</div>
                    {m.notes && <div className="text-xs text-muted-foreground">{m.notes}</div>}
                  </td>
                  <td className="py-2.5 pr-4 text-foreground/80">{m.supplier}</td>
                  <td className="py-2.5 pr-4 font-mono text-xs text-muted-foreground">
                    {m.catalog_number ?? "—"}
                  </td>
                  <td className="py-2.5 pr-4 text-foreground/80">{m.quantity}</td>
                  <td className="py-2.5 pr-4 text-right font-mono text-xs">
                    {fmtUsd(m.unit_cost_usd)}
                  </td>
                  <td className="py-2.5 text-right font-mono text-sm font-medium">
                    {fmtUsd(m.total_cost_usd)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-foreground/20">
                <td colSpan={5} className="py-3 text-right font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  Materials subtotal
                </td>
                <td className="py-3 text-right font-mono text-sm font-semibold">
                  {fmtUsd(materialsTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Section>

      <Section number="04" label="Budget" icon={CircleDollarSign}>
        <div className="grid gap-4 md:grid-cols-[1fr,auto]">
          <ul className="divide-y divide-rule">
            {plan.budget.line_items.map((li, i) => (
              <li key={i} className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium text-foreground">{li.category}</div>
                  {li.note && <div className="text-xs text-muted-foreground">{li.note}</div>}
                </div>
                <div className="font-mono text-sm tabular-nums">{fmtUsd(li.amount_usd)}</div>
              </li>
            ))}
          </ul>
          <div className="md:min-w-[220px]">
            <div className="rounded-md border border-foreground/15 bg-paper p-5">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Total
              </div>
              <div className="mt-1 font-serif text-3xl font-semibold text-foreground">
                {fmtUsd(plan.budget.total_usd)}
              </div>
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                {plan.budget.currency}
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section number="05" label="Timeline" icon={CalendarRange}>
        <div className="space-y-4">
          {plan.timeline.map((p, i) => (
            <div key={i} className="grid gap-2 rounded-md border border-rule p-4 md:grid-cols-[180px,1fr]">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-wider text-accent">
                  {p.duration}
                </div>
                <div className="mt-1 font-serif text-base font-semibold text-foreground">
                  {p.phase}
                </div>
              </div>
              <div className="space-y-2">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Deliverables
                  </div>
                  <ul className="mt-1 space-y-1 text-sm text-foreground/85">
                    {p.deliverables.map((d, j) => (
                      <li key={j} className="flex items-start gap-2">
                        <ListChecks className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                        {d}
                      </li>
                    ))}
                  </ul>
                </div>
                {p.dependencies && p.dependencies.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    Depends on: {p.dependencies.join(", ")}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section number="06" label="Validation" icon={Beaker}>
        <div className="space-y-4">
          <p className="font-serif text-[15px] leading-relaxed text-foreground/90">
            {plan.validation.approach}
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <KV label="Primary metric" value={plan.validation.primary_metric} />
            {plan.validation.statistical_plan && (
              <KV label="Statistical plan" value={plan.validation.statistical_plan} />
            )}
          </div>
          <div>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Controls
            </div>
            <div className="flex flex-wrap gap-2">
              {plan.validation.controls.map((c, i) => (
                <span key={i} className="stamp border-border bg-secondary text-secondary-foreground">
                  {c}
                </span>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {plan.statistical_design && (
        <Section number="07" label="Statistical design" icon={Sigma}>
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <KV label="N per group" value={String(plan.statistical_design.n_per_group)} />
              <KV label="Alpha" value={String(plan.statistical_design.alpha)} />
              <KV label="Power" value={String(plan.statistical_design.power)} />
              <KV label="Primary test" value={plan.statistical_design.primary_test} />
              <KV label="Effect size" value={plan.statistical_design.effect_size} />
              <KV label="Blinding" value={plan.statistical_design.blinding} />
            </div>
            <KV label="Randomization" value={plan.statistical_design.randomization} />
            <div>
              <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Groups
              </div>
              <div className="flex flex-wrap gap-2">
                {plan.statistical_design.groups.map((g, i) => (
                  <span key={i} className="stamp border-border bg-secondary text-secondary-foreground">
                    {g}
                  </span>
                ))}
              </div>
            </div>
            {plan.statistical_design.notes && (
              <p className="text-sm text-foreground/75">{plan.statistical_design.notes}</p>
            )}
          </div>
        </Section>
      )}

      {plan.safety && (
        <Section number="08" label="Safety & approvals" icon={ShieldAlert}>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <span className="stamp border-warning/40 bg-warning/10 text-foreground">
                {plan.safety.biosafety_level}
              </span>
              {plan.safety.irb_required && (
                <span className="stamp border-destructive/40 bg-destructive/10 text-foreground">
                  IRB required
                </span>
              )}
              {plan.safety.iacuc_required && (
                <span className="stamp border-destructive/40 bg-destructive/10 text-foreground">
                  IACUC required
                </span>
              )}
              {plan.safety.ibc_required && (
                <span className="stamp border-destructive/40 bg-destructive/10 text-foreground">
                  IBC required
                </span>
              )}
              {plan.safety.controlled_substances && (
                <span className="stamp border-destructive/40 bg-destructive/10 text-foreground">
                  Controlled substances
                </span>
              )}
            </div>
            {plan.safety.hazards.length > 0 && (
              <div>
                <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Hazards
                </div>
                <ul className="space-y-1 text-sm text-foreground/85">
                  {plan.safety.hazards.map((h, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-warning" />
                      {h}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {plan.safety.ppe.length > 0 && (
              <div>
                <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  PPE
                </div>
                <div className="flex flex-wrap gap-2">
                  {plan.safety.ppe.map((p, i) => (
                    <span key={i} className="stamp border-border bg-secondary text-secondary-foreground">
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <KV label="Waste handling" value={plan.safety.waste_handling} />
              <KV label="Emergency procedure" value={plan.safety.emergency_procedure} />
            </div>
          </div>
        </Section>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Section number="09" label="Risks & mitigations" icon={AlertTriangle}>
          <ul className="space-y-3">
            {plan.risks.map((r, i) => (
              <li key={i} className="rounded-md border border-rule p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-warning" />
                  <div className="font-medium text-sm text-foreground">{r.risk}</div>
                </div>
                <div className="mt-1.5 pl-5 text-sm text-foreground/75">→ {r.mitigation}</div>
              </li>
            ))}
          </ul>
        </Section>

        <Section number="10" label="Team" icon={Users}>
          <ul className="divide-y divide-rule">
            {plan.team.map((t, i) => (
              <li key={i} className="flex items-center justify-between py-2.5">
                <span className="font-serif text-[15px] text-foreground">{t.role}</span>
                <span className="font-mono text-xs text-muted-foreground">{t.fte} FTE</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
};

const Stat = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="rounded-md border border-rule bg-paper p-4">
    <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
    <div className="mt-1 font-serif text-xl font-semibold text-foreground">{value}</div>
    {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
  </div>
);

const KV = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-md border border-rule p-3">
    <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    <div className="mt-1 text-sm text-foreground/90">{value}</div>
  </div>
);
