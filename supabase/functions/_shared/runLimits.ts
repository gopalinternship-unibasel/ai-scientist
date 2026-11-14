// Daily run caps for the hosted deployment.
//
// The caps are off unless their settings are present, so the local stack keeps
// its old rule (100 runs per hour per user or IP). When a cap is set, only runs
// that call the AI count: the check happens after the cache lookup, so a
// cached replay costs nothing and is never counted.
//
//   RUN_LIMIT_GLOBAL_PER_DAY  runs per rolling 24 h over all visitors
//   RUN_LIMIT_ANON_PER_DAY    runs per rolling 24 h per IP without sign-in
//   RUN_LIMIT_USER_PER_DAY    runs per rolling 24 h per signed-in user

export const RUN_KIND = "run";
export const DAY_MINUTES = 24 * 60;
/** Local rule, used when no hosted cap is set. */
export const LOCAL_PER_HOUR = 100;

export interface RunCaps {
  global: number | null;
  anon: number | null;
  user: number | null;
}

type Env = Record<string, string | undefined>;

function positiveInt(v: string | undefined): number | null {
  const t = v?.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
}

export function resolveRunCaps(env: Env): RunCaps {
  return {
    global: positiveInt(env.RUN_LIMIT_GLOBAL_PER_DAY),
    anon: positiveInt(env.RUN_LIMIT_ANON_PER_DAY),
    user: positiveInt(env.RUN_LIMIT_USER_PER_DAY),
  };
}

/** True when at least one hosted cap is set. */
export function hostedCapsActive(caps: RunCaps): boolean {
  return caps.global !== null || caps.anon !== null || caps.user !== null;
}

export interface RunUsage {
  /** New AI runs by this identity in the last 24 h. */
  identity: number;
  /** New AI runs by everyone in the last 24 h. */
  global: number;
}

export interface RunLimitDecision {
  ok: boolean;
  /** Which cap stopped the run. */
  reason: "global" | "identity" | null;
  /** The cap that applies to this caller's own count (null when not capped). */
  identityLimit: number | null;
  message: string | null;
}

/**
 * Decide whether one more AI run may start. Pure: usage counts come from the
 * caller. The global cap is checked first, so when the whole demo is used up
 * every visitor sees the same message.
 */
export function decideRunLimit(caps: RunCaps, signedIn: boolean, usage: RunUsage): RunLimitDecision {
  const identityLimit = signedIn ? caps.user : caps.anon;
  if (caps.global !== null && usage.global >= caps.global) {
    return {
      ok: false, reason: "global", identityLimit,
      message: "The daily limit for this demo has been reached. Please try again tomorrow.",
    };
  }
  if (identityLimit !== null && usage.identity >= identityLimit) {
    return {
      ok: false, reason: "identity", identityLimit,
      message: signedIn
        ? `You have reached the limit of ${identityLimit} new plans per day. Please try again tomorrow.`
        : `Visitors without an account are limited to ${identityLimit} new plans per day. Sign in for a higher limit, or try again tomorrow.`,
    };
  }
  return { ok: true, reason: null, identityLimit, message: null };
}

/** The quota figures shown by the GET endpoint. */
export function quotaFor(caps: RunCaps, signedIn: boolean, usage: RunUsage): { limit: number; used: number; remaining: number; window: "day" | "hour" } {
  const identityLimit = signedIn ? caps.user : caps.anon;
  if (!hostedCapsActive(caps)) {
    return { limit: LOCAL_PER_HOUR, used: usage.identity, remaining: Math.max(0, LOCAL_PER_HOUR - usage.identity), window: "hour" };
  }
  // Remaining is the smaller of what is left for this identity and for everyone.
  const left: number[] = [];
  if (identityLimit !== null) left.push(identityLimit - usage.identity);
  if (caps.global !== null) left.push(caps.global - usage.global);
  const remaining = Math.max(0, Math.min(...left));
  const limit = identityLimit ?? caps.global ?? 0;
  const used = identityLimit !== null ? usage.identity : usage.global;
  return { limit, used, remaining, window: "day" };
}
