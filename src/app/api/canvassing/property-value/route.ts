import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { resolvePropertyValue } from "@/server/modules/property";

// Lazy property-value lookup for a single house dot (called when a dot is opened).
// Resolves a real AVM estimate (value + range + last sale + parcel details),
// caches per address in the DB so repeat clicks don't re-bill the API.
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || !can(user, "read", "Canvassing")) {
    return NextResponse.json({ value: null, matched: false, source: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat") ? Number(searchParams.get("lat")) : null;
  const lng = searchParams.get("lng") ? Number(searchParams.get("lng")) : null;
  const address = searchParams.get("address");
  const city = searchParams.get("city");
  const state = searchParams.get("state");
  const zip = searchParams.get("zip");
  const knockId = searchParams.get("knockId");

  if ((lat == null || Number.isNaN(lat)) && !address) {
    return NextResponse.json({ value: null, matched: false, source: "Unavailable" }, { status: 400 });
  }

  // resolvePropertyValue handles rooftop geocoding + provider call + caching.
  const resolved = await resolvePropertyValue({ address, city, state, zip, lat, lng });
  if (!resolved) return NextResponse.json({ value: null, matched: false, source: "Unavailable" });

  // Persist onto the knock (real ids only — synthetic "house:" dots aren't rows
  // yet) so the value + range + last sale carry through to lead/appointment.
  if (knockId && !knockId.startsWith("house:")) {
    await prisma.knock
      .updateMany({
        where: { id: knockId, companyId: user.companyId },
        data: {
          propertyValue: resolved.matched ? resolved.value : null,
          propertyValueSource: resolved.source,
          propertyValueAt: new Date(resolved.asOfDate),
          propertyData: resolved as unknown as object,
        },
      })
      .catch(() => {});
  }

  return NextResponse.json(resolved);
}
