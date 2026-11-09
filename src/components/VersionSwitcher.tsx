// Compact pill list of all versions in a refinement chain.
// Highlights the currently viewed run and links to the others.
import { Link } from "react-router-dom";
import { GitBranch, Sparkles } from "lucide-react";

export interface VersionEntry {
  id: string;
  version: number;
  refinement_instruction: string | null;
  created_at: string;
  status: string;
}

interface Props {
  versions: VersionEntry[];
  currentId: string;
}

export const VersionSwitcher = ({ versions, currentId }: Props) => {
  if (versions.length <= 1) return null;
  const sorted = [...versions].sort((a, b) => a.version - b.version);

  return (
    <div className="rounded-md border border-rule bg-paper p-3">
      <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        <GitBranch className="h-3 w-3" /> Versions ({sorted.length})
      </div>
      <ol className="flex flex-wrap gap-2">
        {sorted.map((v) => {
          const isCurrent = v.id === currentId;
          const label = `v${v.version}`;
          const tooltip = v.refinement_instruction ?? "Initial plan";
          const inner = (
            <span
              title={tooltip}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                isCurrent
                  ? "border-accent bg-accent/10 text-foreground"
                  : "border-rule bg-background text-foreground/70 hover:border-foreground/30 hover:text-foreground"
              }`}
            >
              {v.refinement_instruction && <Sparkles className="h-3 w-3 text-accent" />}
              {label}
              <span className="hidden max-w-[180px] truncate text-foreground/50 sm:inline">
                {v.refinement_instruction ? `· ${v.refinement_instruction}` : "· initial"}
              </span>
              {v.status === "failed" && <span className="text-destructive">failed</span>}
            </span>
          );
          return (
            <li key={v.id}>
              {isCurrent ? inner : <Link to={`/runs/${v.id}`}>{inner}</Link>}
            </li>
          );
        })}
      </ol>
    </div>
  );
};
