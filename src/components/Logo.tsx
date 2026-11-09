export const Logo = ({ className = "" }: { className?: string }) => (
  <div className={`flex min-w-0 items-center gap-3 ${className}`}>
    <LogoMark />
    <div className="min-w-0 leading-tight">
      <div className="truncate font-serif text-[17px] font-semibold tracking-tight text-foreground">
        The AI Scientist
      </div>
      <div className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground sm:block">
        Hypothesis → Experiment
      </div>
    </div>
  </div>
);

export const LogoMark = ({ size = 36 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 40 40"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-label="The AI Scientist"
    className="shrink-0"
  >
    {/* Outer ring — the "scientific instrument" frame */}
    <circle
      cx="20"
      cy="20"
      r="18.5"
      stroke="hsl(var(--primary))"
      strokeWidth="1.25"
    />
    {/* Inner tick marks — like a dial / petri dish gradations */}
    <g stroke="hsl(var(--primary))" strokeWidth="1" strokeLinecap="round" opacity="0.45">
      <line x1="20" y1="2.5" x2="20" y2="5" />
      <line x1="20" y1="35" x2="20" y2="37.5" />
      <line x1="2.5" y1="20" x2="5" y2="20" />
      <line x1="35" y1="20" x2="37.5" y2="20" />
    </g>
    {/* Atom / orbit — single elegant ellipse rotated */}
    <ellipse
      cx="20"
      cy="20"
      rx="11"
      ry="4.5"
      stroke="hsl(var(--primary))"
      strokeWidth="1.25"
      transform="rotate(-30 20 20)"
    />
    {/* Nucleus */}
    <circle cx="20" cy="20" r="2.25" fill="hsl(var(--primary))" />
    {/* Accent electron — a spark of discovery */}
    <circle cx="29.5" cy="14.5" r="1.6" fill="hsl(var(--accent))" />
  </svg>
);
