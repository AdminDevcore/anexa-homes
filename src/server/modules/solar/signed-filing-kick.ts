import { selfBaseUrl } from "@/server/app-url";

/**
 * FILE THE SIGNED PROPOSAL AS PART OF SIGNING.
 *
 * Signing approves the version (proposal-public.ts) but does not render its
 * PDF inline: the renderer boots Chromium and takes the better part of a
 * minute, and a homeowner pressing Sign must not wait behind it — nor have
 * their signature fail because a browser would not start.
 *
 * So the signing action calls this AFTER its response is sent (`after()`),
 * which asks the filing route to file this one proposal immediately. The route
 * does the work in its own function, with its own five-minute budget, so the
 * public signing page never traces a browser into its bundle.
 *
 * Nothing here is load-bearing for correctness. If the call cannot be made
 * (no secret on this deployment, the network, a cold start timing out), the
 * scheduled sweep — every ten minutes, same idempotent filer — still files it.
 * What this removes is the wait, and the old dependence on an admin happening
 * to open the deal.
 */
export async function kickSignedProposalFiling(proposalId: string): Promise<void> {
  const secret = process.env.CRON_SECRET?.trim();
  // No secret means the sweep cannot run on this deployment either, and the
  // route would refuse the call. Nothing to ask.
  if (!secret) return;
  const url = `${selfBaseUrl()}/api/cron/file-signed-proposals?proposalId=${encodeURIComponent(proposalId)}`;
  try {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${secret}` },
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[proposal] filing on signature returned ${res.status}; the scheduled sweep will file it`);
    }
  } catch (err) {
    console.warn("[proposal] could not start filing on signature; the scheduled sweep will file it", err);
  }
}
