import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  /** Optional friendly label for the section that failed (e.g. "experiment plan"). */
  label?: string;
  /** Optional fallback override. */
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time errors in a subtree (e.g. a malformed plan from the model)
 * so the rest of the page stays usable instead of blanking entirely.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    const label = this.props.label ?? "this section";
    return (
      <div className="paper-surface rounded-lg p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <h2 className="font-serif text-lg text-foreground">
              We couldn't display {label}
            </h2>
            <p className="mt-1 text-sm text-foreground/75">
              The data for this section is malformed. Other parts of the page should still
              work — try refining the plan or generating a new one.
            </p>
            <details className="mt-3 text-xs text-muted-foreground">
              <summary className="cursor-pointer font-mono uppercase tracking-wider">
                Technical details
              </summary>
              <pre className="mt-2 overflow-auto rounded bg-muted/40 p-2">
                {this.state.error.message}
              </pre>
            </details>
            <Button variant="outline" size="sm" onClick={this.reset} className="mt-4">
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
