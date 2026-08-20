import type { Prisma, Vertical } from "@prisma/client";
import { prisma } from "@/server/db/client";
import type { SessionUser } from "@/server/auth/session";
import { listScope } from "@/server/rbac/policies";
import { STAFF_ROLES } from "@/server/rbac/matrix";

export async function getLeadFormOptions(companyId: string, vertical?: Vertical) {
  const [sources, pipeline, reps, fieldDefs] = await Promise.all([
    prisma.leadSource.findMany({ where: { companyId, active: true }, orderBy: { position: "asc" } }),
    prisma.pipeline.findFirst({
      where: { companyId, ...(vertical ? { vertical } : {}) },
      orderBy: { isDefault: "desc" },
      include: { stages: { orderBy: { position: "asc" } } },
    }),
    prisma.user.findMany({
      where: { companyId, role: { in: STAFF_ROLES }, status: "active" },
      orderBy: { firstName: "asc" },
      select: { id: true, firstName: true, lastName: true },
    }),
    prisma.customFieldDef.findMany({
      where: { companyId, entity: "lead" },
      orderBy: { position: "asc" },
    }),
  ]);

  return {
    sources: sources.map((s) => ({ id: s.id, name: s.name })),
    stages: (pipeline?.stages ?? []).map((s) => ({ id: s.id, name: s.name })),
    reps: reps.map((r) => ({ id: r.id, name: `${r.firstName} ${r.lastName}` })),
    // Every staff member is offerable as a setter. Deliberately not filtered to
    // canvassers: on a small team the person who knocks is often the same one
    // who closes, and a picker that cannot name them makes the field useless.
    setters: reps.map((r) => ({ id: r.id, name: `${r.firstName} ${r.lastName}` })),
    fieldDefs: fieldDefs.map((f) => ({
      id: f.id,
      key: f.key,
      label: f.label,
      type: f.type,
      options: (f.options as string[]) ?? [],
      required: f.required,
    })),
  };
}

export async function getLeadDetail(user: SessionUser, id: string) {
  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  return prisma.lead.findFirst({
    where: { AND: [{ id }, scope] },
    include: {
      stage: true,
      pipeline: { include: { stages: { orderBy: { position: "asc" } } } },
      source: true,
      assignedRep: { select: { id: true, firstName: true, lastName: true } },
      customerUser: { select: { id: true, firstName: true, lastName: true, email: true } },
      project: true,
      claims: { include: { lineItems: true, supplements: true } },
      roofMeasurements: true,
      noteEntries: {
        orderBy: { createdAt: "desc" },
        include: { author: { select: { firstName: true, lastName: true } } },
      },
      tasks: {
        orderBy: [{ status: "asc" }, { dueAt: "asc" }],
        include: { assignee: { select: { firstName: true, lastName: true } } },
      },
      files: {
        orderBy: { createdAt: "desc" },
        include: { uploadedBy: { select: { firstName: true, lastName: true } } },
      },
      documentPackages: {
        orderBy: { createdAt: "desc" },
        // signedFileId identifies the countersigned PDF the e-sign flow stores
        // as a FileAsset. The folder grid needs it to recognise that file as
        // this package rather than listing it a second time.
        select: { id: true, title: true, status: true, signedFileId: true, folderKey: true },
      },
    },
  });
}
