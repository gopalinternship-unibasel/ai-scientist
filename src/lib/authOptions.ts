// "Continue with Google" goes through Lovable Cloud's OAuth broker, which
// only exists on a Lovable-hosted site (the page navigates to
// /~oauth/initiate on the same origin). Anywhere else, the self-hosted stack
// included, that route is the app's 404 page, so the button is shown only
// when the build says it runs on Lovable hosting (VITE_LOVABLE_OAUTH=true).
export const googleSignInAvailable = (env: Record<string, unknown> = import.meta.env): boolean =>
  env.VITE_LOVABLE_OAUTH === "true";
