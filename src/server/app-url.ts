/**
 * The absolute URL this deployment can reach ITSELF on.
 *
 * For server code that has to call its own routes from inside the runtime — the
 * proposal renderer pointing Chromium at the document, the signing flow asking
 * the filing route to run. `NEXT_PUBLIC_APP_URL` is the one customer links
 * already rely on; VERCEL_URL is the per-deployment fallback for a preview build
 * with no custom domain.
 *
 * Its own module so a caller needing only this does not import the renderer,
 * which traces a whole browser into its function bundle.
 */
export function selfBaseUrl(): string {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  if (configured) return configured;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://127.0.0.1:3000";
}
