import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { getSolarSettings } from "@/server/modules/solar/settings";
import { resolveSizingModule } from "@/server/modules/solar/sizing";
import { parseLayoutBlocks, parseLayoutSetbacks, MODULE_FALLBACK_MM } from "@/lib/solar-layout";
import { cachedYieldsByAngles } from "@/server/modules/solar/pvwatts";
import { effectiveUsageKwh } from "@/lib/solar-energy";
import { cachedRoofPlanes, groundPlanesFor } from "@/server/modules/solar/roof-planes";
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
      usageAdjustmentKwh: true,
      moduleId: true,
      inverterId: true,
      batteryId: true,
      batteryQty: true,
      // What the battery count is sized off, and whether anything is allowed
      // to size it — see the designer's own `sizing` prop.
      systemType: true,
      batteryQtySetByRep: true,
    },
  });

  const [settings, sizingModule] = await Promise.all([
    getSolarSettings(user.companyId),
    resolveSizingModule(user.companyId, design?.moduleId ?? null),
  ]);

  /**
   * The whole catalogue, because the top bar picks from it.
   *
   * Sellable rows PLUS whatever this design already names, so a retired item on
   * an existing deal keeps showing instead of the picker silently falling back
   * to "not set" and the next save stripping a choice nobody meant to touch —
   * the same rule the lender rate sheets follow.
   */
  const namesOn = [design?.moduleId, design?.inverterId, design?.batteryId].filter(
    (v): v is string => !!v
  );
  const equipment = await prisma.solarEquipment.findMany({
    where: {
      companyId: user.companyId,
      kind: { in: ["module", "inverter", "battery"] },
      OR: [{ isActive: true }, ...(namesOn.length ? [{ id: { in: namesOn } }] : [])],
    },
    orderBy: [{ isDefault: "desc" }, { manufacturer: "asc" }, { model: "asc" }],
    select: {
      id: true, kind: true, manufacturer: true, model: true, ratingW: true, widthMm: true, heightMm: true,
      isDefault: true, isActive: true,
    },
  });

  /**
   * The starred inverter, for a design that has not named one yet.
   *
   * Off the list already loaded rather than a second query, and it is not a
   * suggestion: `recomputeDesignFigures` writes exactly this onto the design
   * the next time anything on the deal is saved. Showing it is the picker
   * agreeing with the deal instead of reading "Not set" for a slot that is
   * about to be filled.
   */
  const defaultInverterId =
    equipment.find((e) => e.kind === "inverter" && e.isDefault && e.isActive)?.id ?? null;
  const optionsOf = (kind: "module" | "inverter" | "battery") =>
    equipment
      .filter((e) => e.kind === kind)
      .map((e) => ({
        id: e.id,
        label: [e.manufacturer, e.model].filter(Boolean).join(" ") || e.model,
        ratingW: e.ratingW,
        // Which one the company standardised on, said on the OPTION rather
        // than left to the sort order — "first in the list" is not a fact a rep
        // sitting on a customer's sofa can read. A starred item that has since
        // been retired is not the standard any more, so both have to hold.
        isDefault: e.isDefault && e.isActive,
        // Only a module is drawn, so only a module's size matters.
        ...(kind === "module" ? { sized: e.widthMm != null && e.heightMm != null } : {}),
      }));

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
  const measuredYields = await cachedYieldsByAngles({
    lat: lead.lat,
    lon: lead.lng,
    blocks,
    derateFactor: settings.derateFactor,
    arrayType,
  });

  /**
   * The building's own roof planes, from the CACHE ONLY — same rule as the
   * yields above, and the same reason: opening the designer must not be slower
   * than drawing on it. A roof nobody has looked up yet comes back null and the
   * designer asks the route for it in the background.
   */
  const roofPlanes = groundPlanesFor(
    await cachedRoofPlanes(lead.lat, lead.lng),
    lead.lat,
    lead.lng
  );

  const address = [lead.address, [lead.city, lead.state].filter(Boolean).join(", "), lead.zip]
    .filter(Boolean)
    .join(" · ");

  return (
    <SolarLayoutDesigner
      leadId={lead.id}
      address={address}
      lat={lead.lat}
      lng={lead.lng}
      moduleRatingW={sizingModule?.ratingW ?? null}
      moduleMm={{
        widthMm: sizingModule?.widthMm ?? MODULE_FALLBACK_MM.widthMm,
        heightMm: sizingModule?.heightMm ?? MODULE_FALLBACK_MM.heightMm,
      }}
      catalogue={{
        module: optionsOf("module"),
        inverter: optionsOf("inverter"),
        battery: optionsOf("battery"),
      }}
      defaultBatteryQty={settings.defaultBatteryQty}
      /**
       * Whether the battery count belongs to the home or to the price list.
       *
       * The rule itself runs on the server, on every recompute. What was
       * missing here is any way to SEE it: on a solar-plus-storage deal the
       * count exists in exactly one place — the picker in this screen's top
       * bar — and that picker showed a bare number with no hint that it was
       * measured, no hint when a person had overridden it, and no way back.
       * The sizing panel that says all three only ever rendered on a
       * battery-only deal, which is the one kind that never opens a designer.
       *
       * Only the RULE is passed. The arithmetic is done on the client against
       * the production being drawn right now, not against the figure last
       * saved — the whole point of this screen is watching the numbers move.
       */
      sizing={{
        on: settings.autoBatteryQty,
        nightSharePct: settings.batteryNightSharePct,
        systemType: design?.systemType ?? "pv_storage",
      }}
      chosen={{
        // The design's own module if it names one, otherwise whatever the
        // catalogue default resolved to — so the picker shows the panel the
        // figures were actually computed with.
        moduleId: design?.moduleId ?? sizingModule?.id ?? null,
        inverterId: design?.inverterId ?? defaultInverterId,
        batteryId: design?.batteryId ?? null,
        batteryQty: design?.batteryQty ?? 0,
        batteryQtySetByRep: design?.batteryQtySetByRep ?? false,
      }}
      // Plus whatever this deal's adders add to the household's year. Offset
      // is divided by this everywhere else — the deal page, the save, the
      // customer's document — so the figure a rep watches while dragging
      // panels has to be measured against the same denominator.
      annualUsageKwh={
        effectiveUsageKwh(design?.annualUsageKwh, design?.usageAdjustmentKwh) || null
      }
      initialBlocks={blocks}
      measuredYields={measuredYields}
      roofPlanes={roofPlanes}
      groundMount={design?.mountType === "ground"}
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
