import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import { prisma } from "@/server/db/client";
import { renderPhotoReport, type ReportPhoto } from "@/server/modules/photos/report";
import { PHOTO_GROUPS, type PhotoGroup } from "@/lib/photo-groups";

// Deal-level photo report. Compiles a deal's Survey or Install/Roof photos
// (tagged via FileAsset.category) into a branded PDF — each group separately.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!can(user, "read", "File")) return new NextResponse("Forbidden", { status: 403 });

  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  const lead = await prisma.lead.findFirst({
    where: { AND: [{ id }, scope] },
    select: { firstName: true, lastName: true, address: true, city: true, state: true, zip: true },
  });
  if (!lead) return new NextResponse("Not found", { status: 404 });

  const { searchParams } = new URL(req.url);
  const group = searchParams.get("group") as PhotoGroup | null;
  if (!group || !(group in PHOTO_GROUPS)) return new NextResponse("Bad group", { status: 400 });
  const def = PHOTO_GROUPS[group];

  const photos = await prisma.fileAsset.findMany({
    where: { companyId: user.companyId, leadId: id, kind: "photo", category: group },
    orderBy: { createdAt: "asc" },
    select: { storageKey: true, name: true },
  });

  const reportPhotos: ReportPhoto[] = photos.map((p) => ({
    storageKey: p.storageKey,
    label: def.reportSection,
    caption: p.name.replace(/\.[a-z0-9]+$/i, ""),
  }));

  const customer = `${lead.firstName} ${lead.lastName}`;
  const address = [lead.address, [lead.city, lead.state, lead.zip].filter(Boolean).join(", ")]
    .filter(Boolean).join("  -  ");

  const bytes = await renderPhotoReport(reportPhotos, {
    reference: customer,
    customer,
    address,
    setLabel: def.label,
  });

  const slug = customer.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${slug}-${group}-photos.pdf"`,
    },
  });
}
