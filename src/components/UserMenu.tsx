import { Link, useNavigate } from "react-router-dom";
import { LogIn, LogOut, FlaskConical, ChevronDown, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";

export const UserMenu = () => {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();

  if (loading) return <div className="h-9 w-24 animate-pulse rounded-md bg-muted" />;

  if (!user) {
    return (
      <Link to="/auth">
        <Button variant="outline" size="sm" className="gap-2">
          <LogIn className="h-3.5 w-3.5" /> Sign in
        </Button>
      </Link>
    );
  }

  const name = (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "Account";
  const initial = name.charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2" aria-label={`Account menu for ${name}`}>
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
            {initial}
          </span>
          {/* Phone width: the initial only (QA round 2: the name pushed the header past 375 px). */}
          <span className="hidden max-w-[140px] truncate sm:inline">{name}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate text-xs text-muted-foreground">
          {user.email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate("/my-runs")} className="gap-2">
          <FlaskConical className="h-3.5 w-3.5" /> My runs
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate("/my-feedback")} className="gap-2">
          <MessageSquareText className="h-3.5 w-3.5" /> My feedback
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut} className="gap-2 text-destructive focus:text-destructive">
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
