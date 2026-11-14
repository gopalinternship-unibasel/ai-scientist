import { Link } from "react-router-dom";
import { Gauge } from "lucide-react";
import { useRateLimit } from "@/hooks/useRateLimit";
import { cn } from "@/lib/utils";

interface Props {
  /** Bump this when a run is started/completed to force a refresh. */
  refreshKey?: unknown;
  className?: string;
}

export const RateLimitBadge = ({ refreshKey, className }: Props) => {
  const { info } = useRateLimit(refreshKey);
  if (!info) return null;

  const pct = info.limit > 0 ? info.used / info.limit : 0;
  const tone =
    pct >= 1 ? "border-destructive/50 text-destructive bg-destructive/10"
    : pct >= 0.75 ? "border-warning/50 text-foreground bg-warning/10"
    : "border-rule text-muted-foreground bg-paper";

  const body = (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors",
      tone,
      className,
    )}>
      <Gauge className="h-3 w-3" />
      {info.used}/{info.limit} runs · {info.window === "day" ? "1 day" : "1 h"}
      {!info.authenticated && info.remaining <= 5 && (
        <span className="ml-1 text-foreground/70 normal-case tracking-normal">
          (sign in for more)
        </span>
      )}
    </span>
  );

  if (!info.authenticated && info.remaining <= 5) {
    return <Link to="/auth" title="Sign in for a higher quota">{body}</Link>;
  }
  return body;
};
