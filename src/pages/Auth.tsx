import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { lovable } from "@/integrations/lovable";

const Auth = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) navigate("/my-runs", { replace: true });
  }, [user, loading, navigate]);

  const onGoogle = async () => {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: `${window.location.origin}/my-runs`,
    });
    if (result.error) {
      toast.error("Could not start Google sign-in. Please try again.");
      return;
    }
    if (result.redirected) return;
    navigate("/my-runs");
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-rule">
        <div className="container flex h-16 items-center justify-between">
          <Logo />
          <Link to="/">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-3.5 w-3.5" /> Home
            </Button>
          </Link>
        </div>
      </header>

      <main className="container max-w-md py-16">
        <div className="paper-surface rounded-lg p-8">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            The AI Scientist · Sign in
          </div>
          <h1 className="font-serif text-3xl font-semibold leading-tight text-foreground">
            Save your experiments
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-foreground/75">
            Sign in to keep a private library of every plan you generate, raise your
            run quota, and pick up where you left off across devices.
          </p>

          <Button onClick={onGoogle} size="lg" className="mt-8 w-full gap-3">
            <GoogleIcon /> Continue with Google
          </Button>

          <p className="mt-6 text-center text-[11px] text-muted-foreground">
            Anonymous browsing keeps working — sign-in is optional.
          </p>
        </div>
      </main>
    </div>
  );
};

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
    <path fill="#FFF" d="M21.6 12.227c0-.66-.06-1.296-.17-1.909H12v3.611h5.387a4.605 4.605 0 0 1-1.998 3.022v2.512h3.232c1.892-1.742 2.98-4.31 2.98-7.236Z" />
    <path fill="#FFF" d="M12 22c2.7 0 4.964-.895 6.62-2.422l-3.231-2.512c-.895.6-2.04.955-3.39.955-2.605 0-4.81-1.76-5.598-4.123H3.06v2.59A9.997 9.997 0 0 0 12 22Z" opacity=".9" />
    <path fill="#FFF" d="M6.402 13.898A5.997 5.997 0 0 1 6.09 12c0-.66.114-1.302.314-1.898V7.51H3.06A9.997 9.997 0 0 0 2 12c0 1.614.387 3.14 1.06 4.49l3.342-2.592Z" opacity=".7" />
    <path fill="#FFF" d="M12 5.977c1.471 0 2.79.506 3.829 1.498l2.866-2.866C16.96 2.99 14.7 2 12 2A9.997 9.997 0 0 0 3.06 7.51l3.342 2.592C7.19 7.738 9.395 5.977 12 5.977Z" opacity=".5" />
  </svg>
);

export default Auth;
