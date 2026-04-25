import { CheckCircle2, AlertTriangle, FileSearch, ExternalLink } from "lucide-react";
import type { LiteratureQC } from "@/lib/samples";

const signalConfig = {
  not_found: {
    label: "Not found — likely novel",
    icon: CheckCircle2,
    tone: "border-success/40 bg-success/5 text-success",
    badge: "bg-success text-success-foreground",
    description: "No prior work matches closely. You may be breaking new ground.",
  },
  similar: {
    label: "Similar work exists",
    icon: FileSearch,
    tone: "border-warning/40 bg-warning/5 text-foreground",
    badge: "bg-warning text-warning-foreground",
    description: "Related studies found. Build on them, differentiate clearly.",
  },
  exact_match: {
    label: "Exact match found",
    icon: AlertTriangle,
    tone: "border-destructive/40 bg-destructive/5 text-destructive",
    badge: "bg-destructive text-destructive-foreground",
    description: "This experiment appears to have been conducted. Reconsider scope.",
  },
} as const;

export const LiteratureQCCard = ({ qc }: { qc: LiteratureQC }) => {
  const cfg = signalConfig[qc.signal];
  const Icon = cfg.icon;

  return (
    <section className="paper-surface rounded-lg p-6 md:p-8 animate-fade-in">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Stage 02 — Literature QC
          </span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {qc.sources_used
            ? `via ${[
                qc.sources_used.s2 && "Semantic Scholar",
                qc.sources_used.openalex && "OpenAlex",
                qc.sources_used.pubmed && "PubMed",
              ].filter(Boolean).join(" · ") || "—"}`
            : "via Semantic Scholar"}
        </span>
      </div>

      <div className={`flex items-start gap-4 rounded-md border p-4 ${cfg.tone}`}>
        <Icon className="mt-0.5 h-5 w-5 flex-shrink-0" />
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`stamp ${cfg.badge} border-transparent`}>{cfg.label}</span>
            {qc.semantic_overlap && qc.semantic_overlap !== "low" && (
              <span className="stamp border-warning/40 bg-warning/10 text-foreground">
                Semantic overlap: {qc.semantic_overlap}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-foreground/80">{cfg.description}</p>
          <p className="mt-3 text-sm font-serif italic text-foreground/90">"{qc.rationale}"</p>
        </div>
      </div>

      {qc.references.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Relevant references ({qc.references.length})
          </h3>
          <ul className="divide-y divide-rule">
            {qc.references.map((r, i) => (
              <li key={i} className="py-3">
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-start gap-3"
                >
                  <span className="mt-1 font-mono text-[11px] text-muted-foreground">
                    [{i + 1}]
                  </span>
                  <div className="flex-1">
                    <div className="font-serif text-[15px] font-medium leading-snug text-foreground group-hover:underline">
                      {r.title}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {(r.authors ?? []).slice(0, 3).join(", ")}
                      {r.authors && r.authors.length > 3 ? " et al." : ""}
                      {r.venue ? ` · ${r.venue}` : ""}
                      {r.year ? ` · ${r.year}` : ""}
                      {typeof r.citationCount === "number" ? ` · ${r.citationCount} citations` : ""}
                    </div>
                  </div>
                  <ExternalLink className="mt-1 h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};
