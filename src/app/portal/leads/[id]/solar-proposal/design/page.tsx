import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { getSolarSettings } from "@/server/modules/solar/settings";
import { resolveSizingModule } from "@/server/modules/solar/sizing";
import { parseLayoutBlocks, parseLayoutSetbacks, MODULE_FALLBACK_MM } from "@/lib/solar-layout";
import { yieldCacheKey } from "@/lib/solar-pvwatts";
import { cachedPlaneYields, planeFor } from "@/server/modules/solar/pvwatts";
import { SolarLayoutDesigner } from "@/components/portal/solar-layout-designer";

export const dynamic = "force-dynamic";

export const metadata = { title: "Design the array" };

/**
 * The panel designer, on its own screen.
 *
 * It used to be a box a third of the way down the System design step, which is
 * the wrong shape for the job twice over: a roof is landscape and a form is a
 * column, and the thing a rep is doing here — reading a shadow, judging whether
 * a module clears a vent — needs the picture as big as the screen allows. A
 * dedicated route also means the back button and a shared link both do what a
 * rep expects, and that leaving with unsaved work can be caught, which it
 * cannot be for one section of a longer page.
 *
 * Everything it needs is resolved HERE rather than in the component: the same
 * module the server sizes the design from, the same yield assumptions the save
 * action uses, and the annual usage the offset is measured against — so the
 * live figures on screen are arithmetic on the stored inputs rather than a
 * second opinion about them.
 */
export default async function SolarDesignerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!can(user, "create", "Proposal") && !can(user, "update", "Proposal")) {
    redirect(`/portal/leads/${id}`);
  }

  const lead = await prisma.lead.findFirst({
    where: { id, companyId: user.companyId },
    select: {
      id: true,
      vertical: true,
      address: true,
      city: true,
      state: true,
      zip: true,
      // The designer frames the roof on this. Null means no rooftop coordinate
      // yet, and it says so rather than drawing an empty canvas.
      lat: true,
      lng: true,
    },
  });
  if (!lead) notFound();
  if (lead.vertical !== "solar") redirect(`/portal/leads/${id}/presentation`);

  const design = await prisma.solarDesign.findUnique({
    where: { leadId: lead.id },
    select: {
      layoutBlocks: true,
      layoutSetbacks: true,
      mountType: true,
      annualUsageKwh: true,
      moduleId: true,
      inverterId: true,
      batteryId: true,
    },
  });

  const [settings, sizingModule] = await Promise.all([
    getSolarSettings(user.companyId),
    resolveSizingModule(user.companyId, design?.moduleId ?? null),
  ]);

  // Named, so a rep drawing 93 panels can see which panel they are. Read-only
  // here: the approved-vendor list decides what a system is built from, and it
  // is chosen on the deal's Operations card alongside the lender that gates it.
  const equipmentIds = [sizingModule?.id, design?.inverterId, design?.batteryId].filter(
    (v): v is string => !!v
  );
  const equipment = equipmentIds.length
    ? await prisma.solarEquipment.findMany({
        where: { companyId: user.companyId, id: { in: equipmentIds } },
        select: { id: true, manufacturer: true, model: true, ratingW: true },
      })
    : [];
  const named = (equipmentId: string | null | undefined) => {
    const e = equipment.find((x) => x.id === equipmentId);
    if (!e) return null;
    return [e.manufacturer, e.model].filter(Boolean).join(" ") || null;
  };
  const inverter = equipment.find((x) => x.id === design?.inverterId);

  /**
   * What NREL has already said about the planes on this roof.
   *
   * Read from the CACHE ONLY — `resolvePlaneYields` fetches what it does not
   * have, and a page load is the wrong moment to spend a rate-limited request:
   * opening a designer must not be slower than drawing on it, and a plane
   * nobody has priced yet is one the save will settle a moment later.
   *
   * Keyed by the two angles, because everything else in the request is fixed
   * for one design — see the designer's `measuredYields`.
   */
  const blocks = parseLayoutBlocks(design?.layoutBlocks);
  const arrayType = design?.mountType === "ground" ? ("ground" as const) : ("roof" as const);
  const planes = blocks.flatMap((b) => {
    const plane = planeFor({
      lat: lead.lat,
      lon: lead.lng,
      tiltDeg: b.tiltDeg,
      azimuthDeg: b.azimuthDeg,
      derateFactor: settings.derateFactor,
      arrayType,
    });
    return plane ? [{ plane, tiltDeg: b.tiltDeg!, azimuthDeg: b.azimuthDeg! }] : [];
  });
  const cachedYields = planes.length
    ? await cachedPlaneYields(planes.map((p) => p.plane))
    : new Map<string, { kwhPerKwYear: number }>();
  const measuredYields: Record<string, number> = {};
  for (const { plane, tiltDeg, azimuthDeg } of planes) {
    const hit = cachedYields.get(yieldCacheKey(plane));
    if (hit) measuredYields[`${tiltDeg}|${azimuthDeg}`] = hit.kwhPerKwYear;
  }

  const address = [lead.address, [lead.city, lead.state].filter(Boolean).join(", "), lead.zip]
    .filter(Boolean)
    .join(" · ");

  return (
    <SolarLayoutDesigner
      leadId={lead.id}
      address={address}
      lat={lead.lat}
      moduleRatingW={sizingModule?.ratingW ?? null}
      moduleMm={{
        widthMm: sizingModule?.widthMm ?? MODULE_FALLBACK_MM.widthMm,
        heightMm: sizingModule?.heightMm ?? MODULE_FALLBACK_MM.heightMm,
      }}
      moduleLabel={named(sizingModule?.id)}
      inverterLabel={named(design?.inverterId)}
      inverterRatingW={inverter?.ratingW ?? null}
      batteryLabel={named(design?.batteryId)}
      annualUsageKwh={design?.annualUsageKwh ?? null}
      initialBlocks={blocks}
      measuredYields={measuredYields}
      initialSetbacks={parseLayoutSetbacks(design?.layoutSetbacks)}
      assumptions={{
        kwhPerKwYear: settings.kwhPerKwYear,
        derateFactor: settings.derateFactor,
      }}
      canEdit={can(user, "update", "Lead")}
      backHref={`/portal/leads/${lead.id}/solar-proposal?step=design`}
    />
  );
}
