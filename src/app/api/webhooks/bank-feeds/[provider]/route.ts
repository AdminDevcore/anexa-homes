import { prisma } from "@/server/db/client";
import { runUnscoped } from "@/server/vertical/context";
import { bankFeedProvider, configuredProviderId } from "@/server/modules/bank-feeds";

export const dynamic = "force-dynamic";

/**
 * Inbound bank-feed webhook.
 *
 *   POST /api/webhooks/bank-feeds/plaid
 *
 * ── IT RECORDS, IT DOES NOT SYNC ────────────────────────────────────────────
 * The handler verifies, dedupes, writes one row and returns. It deliberately
 * does NOT pull transactions inline.
 *
 * Syncing here would put a multi-page network loop inside a delivery that the
 * provider expects to be acknowledged in seconds — and a slow 200 reads as a
 * dead host, which is what disables an endpoint after five consecutive
 * abandoned deliveries. The cron sweep is already the guarantee (it must be:
 * missed deliveries are never replayed), so the webhook's whole job is to make
 * the sweep's next run worth doing sooner.
 *
 * ── VERIFY OVER THE RAW BYTES ───────────────────────────────────────────────
 * `req.text()` before any parsing. Plaid's JWT carries a hash of the body it
 * signed; re-serialising a parsed object changes the bytes and the comparison
 * fails. The adapter owns the scheme — this route only knows "verified or not".
 */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: routeProvider } = await params;

  // A delivery addressed to a provider this deployment is not configured for is
  // refused rather than verified against the wrong scheme.
  if (routeProvider !== configuredProviderId()) {
    return new Response("Unknown provider", { status: 404 });
  }

  const rawBody = await req.text();
  const provider = await bankFeedProvider();
  const verified = await provider.verifyWebhook({ rawBody, headers: req.headers });

  if (!verified.ok) {
    // Never echo the reason to the caller: an attacker probing the endpoint
    // learns nothing about which check failed. The operator gets the detail.
    console.error(`[webhook:${routeProvider}] rejected: ${verified.error}`);
    return new Response("Unauthorized", { status: 401 });
  }

  /**
   * DEDUPE. Delivery is at-least-once, so the same event will arrive again —
   * on a retry after a slow response, or simply because the provider chose to.
   * The unique (provider, eventId) makes the second one a no-op.
   *
   * Unscoped: a delivery arrives with no session and often names a connection
   * whose company we have not resolved yet.
   */
  const recorded = await runUnscoped("bank feed webhook: record an inbound delivery", async () => {
    const existing = await prisma.webhookEvent.findUnique({
      where: { provider_eventId: { provider: routeProvider, eventId: verified.eventId } },
      select: { id: true },
    });
    if (existing) return { duplicate: true as const };

    const connection = verified.providerItemId
      ? await prisma.bankConnection.findFirst({
          where: { provider: routeProvider, providerItemId: verified.providerItemId },
          select: { id: true, companyId: true },
        })
      : null;

    await prisma.webhookEvent.create({
      data: {
        provider: routeProvider,
        eventId: verified.eventId,
        companyId: connection?.companyId ?? null,
        code: verified.code,
        payload: verified.payload as object,
        // "received" means the sweep should look at this connection. Nothing
        // downstream treats it as an instruction to post anything.
        status: connection ? "received" : "ignored",
        ...(connection ? {} : { error: "No connection matches this delivery." }),
      },
    });

    /**
     * An auth problem is the one code worth acting on immediately, because the
     * remedy is a human re-authenticating and the UI cannot ask until the row
     * says so. Still a single cheap write, not a sync.
     */
    if (connection && /ITEM_LOGIN_REQUIRED|PENDING_EXPIRATION|USER_PERMISSION_REVOKED/i.test(verified.code)) {
      await prisma.bankConnection.update({
        where: { id: connection.id },
        data: { status: "needs_reconnect", needsReconnectAt: new Date() },
      });
    }

    return { duplicate: false as const };
  });

  // 2xx either way: a duplicate is a success, not an error, and telling the
  // provider otherwise would earn a retry for something already handled.
  return Response.json({ ok: true, duplicate: recorded.duplicate });
}
