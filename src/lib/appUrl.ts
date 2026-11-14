// Absolute URLs and paths of this app when it is served below a base path
// (the hosted build runs at /ai-scientist/; local runs are at the root).
// The base comes from Vite's BASE_URL, which is set by VITE_BASE_PATH.

/** Base path without a trailing slash: "" at the root, "/ai-scientist" on the project site. */
export function routerBasename(base: string = import.meta.env.BASE_URL): string {
  return base.replace(/\/+$/, "");
}

/** Absolute URL of an in-app path such as "/my-runs" or "runs/1?t=x". */
export function buildAppUrl(path: string, base: string, origin: string): string {
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return new URL(prefix + path.replace(/^\/+/, ""), origin).href;
}

export function appUrl(path: string): string {
  return buildAppUrl(path, import.meta.env.BASE_URL, window.location.origin);
}

/** The current location's path inside the app, with the base path removed. */
export function appPathname(pathname: string = window.location.pathname, base: string = import.meta.env.BASE_URL): string {
  const b = routerBasename(base);
  if (b && (pathname === b || pathname.startsWith(`${b}/`))) return pathname.slice(b.length) || "/";
  return pathname;
}
