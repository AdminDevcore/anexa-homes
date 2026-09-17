import { NextResponse } from "next/server";
import { achProvider, configuredAchProviderId } from "@/server/modules/payments/providers";
import { applyPaymentEvent } from "@/server/modules/payments/payments";

/**
 * WHAT THE BANK SAYS AFTERWARDS.
 *
 * ACH is not finished when it is sent. A payment can bounce DAYS later —
 * insufficient funds, a closed account, a wrong number — so this endpoint is
 * how the books find out, and it is the only unauthenticated route in the whole
 * payments module. Its signature check is therefore the entire perimeter.
 *
 * ── THE RAW BODY IS READ FIRST, AND ONLY ONCE ───────────────────────────────
 * `req.text()` before anything else. The signature is over the bytes the
 * provider sent, and re-serialising a parsed object changes them — key order,
 * whitespace, unicode escapes — so a correctly signed delivery would fail. The
 * body is also a stream that can only be consumed once, which is the other
 * reason parsing first is not merely wrong but unrecoverable.
 *
 * ── FAIL CLOSED, AND SAY LITTLE ─────────────────────────────────────────────
 * An unverified delivery gets 401 and nothing else. The reason is deliberately
 * not echoed: an endpoint that explains whether the timestamp or the digest was
 * wrong is an oracle for guessing at the other.
 *
 * ── 2xx, QUICKLY, INCLUDING FOR A REDELIVERY ────────────────────────────────
 * Providers retry anything that is not 2xx, and they retry with increasing
 * urgency. An event we have already applied is a SUCCESS — dedupe is by the
 * provider's own event id, `applied: false` means we had it, and answering
 * anything else would guarantee the same event forever.
 *
 * A failure to APPLY a verified event still answers 2xx with the problem
 * recorded, for the same reason: the event is genuinely ours, the delivery
 * succeeded, and hammering the endpoint will not fix whatever went wrong on our
 * side. The row is in `payment_events` either way, so nothing is lost.
 */

/** This route must never be prerendered or cached; it has side effects. */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // FIRST. Before any parsing, and only once.
  const rawBody = await req.text();

  const headers: Record<string, string | undefined> = {};
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  let verified;
  try {
    const provider = await achProvider();
    verified = provider.verifyWebhook(rawBody, headers);
  } catch {
    // A provider that cannot even be constructed (misconfigured ACH_PROVIDER)
    // must not look like a signature failure.
    return NextResponse.json({ error: "Provider unavailable." }, { status: 503 });
  }

  if (!verified.ok) {
    // No detail: see the header.
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const event = verified.event;

  const applied = await applyPaymentEvent({
    providerId: configuredAchProviderId(),
    eventId: event.eventId,
    kind: event.kind,
    providerTransferId: event.providerTransferId,
    status: event.status,
    returnCode: event.returnCode ?? null,
    returnReason: event.returnReason ?? null,
    payload: event.payload,
    // No user is on this request. The actor is the system, named so the audit
    // record says what caused the entry rather than leaving it blank.
    actor: { kind: "system", label: "ach webhook" },
  });

  if (!applied.ok) {
    // Still 2xx — see the header. The event is recorded; retrying will not help.
    return NextResponse.json({ received: true, applied: false, error: applied.error }, { status: 200 });
  }

  return NextResponse.json({ received: true, applied: applied.applied }, { status: 200 });
}
