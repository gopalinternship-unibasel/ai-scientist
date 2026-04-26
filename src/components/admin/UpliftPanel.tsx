// /admin → "Uplift" tab. Surfaces per-lesson outcome attribution from the
// attribute_lesson_uplift trigger so moderators can see which lessons are
// actually helping vs poisoning the retrieval pool, and one-click auto-demote
// the consistently-negative ones.
import { useEffect, useState } from "react";
import { Loader2, EyeOff, Eye, TrendingDown, TrendingUp, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";

interface UpliftRow {
  id: string;
  section: string;
  domain: string | null;
  correction: string | null;
  rating: number | null;
  applications: number;
  uplift_n: number;
  avg_uplift: number | null;
  hidden: boolean;
  created_at: string;
}

export const UpliftPanel = () => {
  const [rows, setRows] = useState<UpliftRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [demoting, setDemoting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("lesson_uplift_stats", { _limit: 100 });
      if (error) throw error;
      setRows((data as unknown as UpliftRow[]) ?? []);
    } catch (e) {
      console.error("uplift load failed", e);
      toast.error("Could not load uplift stats");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggleHidden = async (row: UpliftRow) => {
    const next = !row.hidden;
    const { error } = await supabase
      .from("plan_feedback")
      .update({ hidden: next })
      .eq("id", row.id);
    if (error) { toast.error("Could not update"); return; }
    setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, hidden: next } : r));
    toast.success(next ? "Hidden from retrieval" : "Restored");
  };

  const autoDemote = async () => {
    setDemoting(true);
    try {
      const { data, error } = await supabase.rpc("auto_demote_low_uplift_lessons", {
        _min_applications: 5,
        _max_avg_uplift: -0.5,
      });
      if (error) throw error;
      const n = (data as unknown as number) ?? 0;
      toast.success(n === 0 ? "No lessons met the demote threshold" : `Auto-demoted ${n} lesson${n === 1 ? "" : "s"}`);
      await load();
    } catch (e) {
      console.error("auto-demote failed", e);
      toast.error("Could not auto-demote");
    } finally {
      setDemoting(false);
    }
  };

  // Eligibility for auto-demote — same thresholds as the SQL function.
  const eligible = rows.filter((r) => !r.hidden && r.uplift_n >= 5 && (r.avg_uplift ?? 0) <= -0.5).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            <p>
              Per-lesson uplift = avg(rating of subsequent feedback when this lesson was applied) − global baseline.
            </p>
            <p className="mt-1 text-muted-foreground">
              Lessons with ≥5 applications and avg uplift ≤ −0.5 are flagged for demotion.
              {eligible > 0 && <> <span className="font-medium text-destructive">{eligible} currently eligible.</span></>}
            </p>
          </div>
          <Button
            variant={eligible > 0 ? "destructive" : "outline"}
            size="sm"
            onClick={autoDemote}
            disabled={demoting || loading}
            className="shrink-0 gap-1.5"
          >
            {demoting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            Auto-demote eligible
          </Button>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center py-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">
          No lessons have been applied to a downstream rated run yet. Uplift accrues automatically as feedback lands on runs that used these lessons.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const u = row.avg_uplift ?? 0;
            const positive = u > 0.05;
            const negative = u < -0.05;
            return (
              <Card key={row.id} className={row.hidden ? "opacity-60" : ""}>
                <CardContent className="flex items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <Badge variant="outline" className="capitalize">{row.section}</Badge>
                      {row.domain && <Badge variant="outline">{row.domain}</Badge>}
                      {row.rating != null && <span>★ {row.rating}</span>}
                      <span>applied ×{row.applications}</span>
                      <span>n = {row.uplift_n}</span>
                      <span
                        className={
                          positive ? "inline-flex items-center gap-1 font-mono text-emerald-600 dark:text-emerald-400"
                          : negative ? "inline-flex items-center gap-1 font-mono text-destructive"
                          : "inline-flex items-center gap-1 font-mono"
                        }
                      >
                        {positive && <TrendingUp className="h-3 w-3" />}
                        {negative && <TrendingDown className="h-3 w-3" />}
                        Δ {u >= 0 ? "+" : ""}{u.toFixed(2)}
                      </span>
                      <span>{new Date(row.created_at).toLocaleDateString()}</span>
                      <Link to={`/runs`} className="underline hover:text-foreground">runs</Link>
                    </div>
                    <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap break-words text-sm">
                      {row.correction ?? <span className="italic text-muted-foreground">(rating only)</span>}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleHidden(row)}
                    className="shrink-0 gap-1.5"
                  >
                    {row.hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    {row.hidden ? "Restore" : "Hide"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};
