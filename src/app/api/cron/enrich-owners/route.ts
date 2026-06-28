import { prisma } from "@/server/db/client";
import { getSkipTraceProvider, skipTraceEnabled, type OwnerResult } from "@/server/modules/skiptrace/provider";
import { resolvePropertyValue } from "@/server/modules/property";

// Nightly house enrichment: for house dots not yet enriched, fills the PROPERTY
// value + address (AVM provider) and the homeowner NAME / PHONE / EMAIL (skip-trace
// provider). With BatchData configured for both, one nightly pass backfills the
// whole map. THIS BILLS PER LOOKUP, so it's gated on a configured skip-trace
// provider and a per-run cap (OWNER_ENRICH_BATCH, default 50). Stamps
// ownerLookedUpAt either way so a no-match isn't retried forever.
// Vercel Cron calls with Bearer CRON_SECRET.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const DELAY_MS = 1500; // throttle the paid API
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  // Dormant unless a real skip-trace provider + key are configured (no accidental billing).
  if (!skipTraceEnabled()) {
    return Response.json({ ok: true, skipped: "no skip-trace provider configured" });
  }
  const provider = getSkipTraceProvider();
  const cap = Math.max(0, Number(process.env.OWNER_ENRICH_BATCH ?? 50)) || 50;

  try {
    const dots = await prisma.knock.findMany({
      where: { ownerLookedUpAt: null },
      select: {
        id: true, lat: true, lng: true, address: true, city: true, state: true, zip: true,
        contactName: true, contactPhone: true, contactEmail: true,
      },
      orderBy: { knockedAt: "asc" },
      take: cap,
    });

    let valued = 0;
    let enriched = 0;
    for (let i = 0; i < dots.length; i++) {
      if (i > 0) await sleep(DELAY_MS);
      const k = dots[i];

      // 1) Property value + (for "Address pending" dots) the parcel address.
      let address = k.address;
      try {
        const est = await resolvePropertyValue({ address: k.address, city: k.city, state: k.state, zip: k.zip, lat: k.lat, lng: k.lng });
        if (est) {
          if (!address && est.formattedAddress) address = est.formattedAddress;
          await prisma.knock.update({
            where: { id: k.id },
            data: {
              propertyValue: est.matched ? est.value : null,
              propertyValueSource: est.source,
              propertyValueAt: new Date(est.asOfDate),
              propertyData: est as unknown as object,
              ...(!k.address && est.formattedAddress ? { address: est.formattedAddress } : {}),
            },
          });
          if (est.matched) valued++;
        }
      } catch {
        /* value lookup failed — continue to owner lookup */
      }

      // 2) Homeowner skip-trace (needs an address).
      let result: OwnerResult | null = null;
      if (address) {
        try {
          result = await provider.lookup({ address, city: k.city, state: k.state, zip: k.zip });
        } catch {
          result = null;
        }
      }
      await prisma.knock.update({
        where: { id: k.id },
        data: result
          ? {
              ownerData: result as unknown as object,
              ownerSource: result.source,
              ownerLookedUpAt: new Date(),
              contactName: k.contactName || result.names[0] || null,
              contactPhone: k.contactPhone || result.phones[0] || null,
              contactEmail: k.contactEmail || result.emails[0] || null,
            }
          : { ownerLookedUpAt: new Date() }, // stamp so we don't retry a no-match forever
      });
      if (result) enriched++;
    }

    return Response.json({ ok: true, provider: provider.name, processed: dots.length, valued, enriched });
  } catch (err) {
    console.error("[cron:enrich-owners] failed", err);
    return new Response("Error", { status: 500 });
  }
}
