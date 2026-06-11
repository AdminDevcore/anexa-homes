import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import { prisma } from "@/server/db/client";
import { renderPhotoReport, type ReportPhoto } from "@/server/modules/photos/report";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!can(user, "read", "File")) return new NextResponse("Forbidden", { status: 403 });

  const scope = listScope(user, "Project") as Prisma.ProjectWhereInput;
  const project = await prisma.project.findFirst({
    where: { AND: [{ id }, scope] },
    select: {
      id: true, projectNumber: true, address: true, city: true, state: true, zip: true,
      lead: { select: { firstName: true, lastName: true } },
    },
  });
  if (!project) return new NextResponse("Not found", { status: 404 });

  const { searchParams } = new URL(req.url);
  const group = searchParams.get("group"); // "site" | "install" | null (all)

  const photos = await prisma.fileAsset.findMany({
    where: {
      companyId: user.companyId,
      projectId: id,
      kind: "photo",
      photoTemplateItem: group === "site" || group === "install" ? { template: { kind: group } } : { isNot: null },
    },
    orderBy: { createdAt: "asc" },
    select: {
      storageKey: true,
      category: true,
      photoTemplateItem: { select: { label: true } },
    },
  });

  const reportPhotos: ReportPhoto[] = photos.map((p) => ({
    storageKey: p.storageKey,
    label: p.photoTemplateItem?.label ?? p.category ?? "Photo",
  }));

  const customer = `${project.lead.firstName} ${project.lead.lastName}`;
  const address = [project.address, [project.city, project.state, project.zip].filter(Boolean).join(", ")]
    .filter(Boolean).join("  -  ");
  const setLabel = group === "site" ? "Site / Inspection" : group === "install" ? "Install" : "All photos";

  const bytes = await renderPhotoReport(reportPhotos, {
    reference: project.projectNumber,
    customer,
    address,
    setLabel,
  });

  const fname = `${project.projectNumber}-photo-report${group ? `-${group}` : ""}.pdf`;
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  });
}
