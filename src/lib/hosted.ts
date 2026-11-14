// The hosted build (GitHub Pages) is made with VITE_HOSTED_DEMO=true. Local
// builds leave it unset, so nothing below shows locally.
export const hostedDemo = (env: Record<string, unknown> = import.meta.env): boolean =>
  env.VITE_HOSTED_DEMO === "true";

export const HOSTED_NOTICE =
  "This is a hosted demo with a daily limit on new plans. The hypothesis you enter is sent to a hosted AI provider.";
