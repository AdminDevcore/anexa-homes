import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { CONTRACTOR_INVOICE_CATEGORY } from "@/lib/contractor-invoice";
import { solarVerticalEnabled } from "@/server/vertical/flag";
import { resolveVertical } from "@/server/vertical/context";

/**
 * The invoices contractors have dropped into jobs, newest first.
 *
 * Every column here is something the database already knew. `uploadedById` and
 * `createdAt` have been stamped on every FileAsset since the table existed, and
 * the category that filed the invoice into the folder is the one that finds it
 * again — so the whole of Contractor Pay reads a table nobody had to add.
 * "Who" is his login and "when" is the upload, which is what makes both
 * un-fakeable: there is no field for a contractor to type either into.
 */
export type SubmittedInvoice = {
  /** FileAsset id — also the URL that opens it, which is why this list is gated. */
  id: string;
  name: string;
  sizeBytes: number;
  isPdf: boolean;
  submittedAt: Date;
  uploadedBy: { name: string; role: Role } | null;
  job: {
    leadId: string | null;
    customer: string;
    address: string | null;
    projectNumber: string | null;
    vertical: string | null;
  };
};

/**
 * Which workspace's invoices to show.
 *
 * FileAsset is deliberately not a vertical-SCOPED model — the same table holds
 * company-level assets that belong to no workspace — so, exactly as the ledger
 * reports do, this filters explicitly through the parent deal instead of hoping
 * the Prisma extension reaches into an `include`. It does not.
 *
 * Flag off → no clause at all, and the query is what it would have been before
 * multi-vertical existed.
 */
async function dealVerticalFilter(): Promise<Prisma.LeadWhereInput | null> {
  if (!solarVerticalEnabled()) return null;
  const res = await resolveVertical();
  return res.mode === "vertical" ? { vertical: res.vertical } : null;
}

const fullName = (u: { firstName: string; lastName: string }) =>
  `${u.firstName} ${u.lastName}`.trim();

export async function listContractorInvoices(
  companyId: string,
  query?: string,
): Promise<SubmittedInvoice[]> {
  const vertical = await dealVerticalFilter();
  const q = query?.trim();

  // An invoice reaches its deal one of two ways: uploaded on the job page,
  // which knows only the projectId, or dropped in the deal's folder, which
  // sends the leadId. `uploadFileAction` now resolves the first to the second,
  // but the OR covers anything filed before it did.
  const inWorkspace: Prisma.FileAssetWhereInput = vertical
    ? { OR: [{ lead: { is: vertical } }, { project: { is: { lead: { is: vertical } } } }] }
    : {};

  const matches: Prisma.FileAssetWhereInput = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { lead: { is: { firstName: { contains: q, mode: "insensitive" } } } },
          { lead: { is: { lastName: { contains: q, mode: "insensitive" } } } },
          { lead: { is: { address: { contains: q, mode: "insensitive" } } } },
          { lead: { is: { project: { is: { projectNumber: { contains: q, mode: "insensitive" } } } } } },
          { uploadedBy: { is: { firstName: { contains: q, mode: "insensitive" } } } },
          { uploadedBy: { is: { lastName: { contains: q, mode: "insensitive" } } } },
        ],
      }
    : {};

  const rows = await prisma.fileAsset.findMany({
    where: {
      companyId,
      category: CONTRACTOR_INVOICE_CATEGORY,
      ...(vertical ? { AND: [inWorkspace, matches] } : matches),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      size: true,
      mimeType: true,
      createdAt: true,
      uploadedBy: { select: { firstName: true, lastName: true, role: true } },
      lead: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          address: true,
          city: true,
          vertical: true,
          project: { select: { projectNumber: true } },
        },
      },
      project: {
        select: {
          projectNumber: true,
          lead: { select: { id: true, firstName: true, lastName: true, address: true, city: true, vertical: true } },
        },
      },
    },
  });

  return rows.map((f) => {
    const lead = f.lead ?? f.project?.lead ?? null;
    return {
      id: f.id,
      name: f.name,
      sizeBytes: f.size,
      isPdf: f.mimeType === "application/pdf",
      submittedAt: f.createdAt,
      uploadedBy: f.uploadedBy
        ? { name: fullName(f.uploadedBy), role: f.uploadedBy.role }
        : null,
      job: {
        leadId: lead?.id ?? null,
        // A deleted deal cascades its files away, so a nameless job means the
        // invoice was filed against nothing — worth showing, not hiding.
        customer: lead ? fullName(lead) || "Unnamed job" : "No job",
        address: lead ? [lead.address, lead.city].filter(Boolean).join(", ") || null : null,
        projectNumber: f.lead?.project?.projectNumber ?? f.project?.projectNumber ?? null,
        vertical: lead?.vertical ?? null,
      },
    } satisfies SubmittedInvoice;
  });
}
