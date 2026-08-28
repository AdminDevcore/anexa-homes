import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CalendarDays, MapPin, ReceiptText } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/portal/ui";
import { Card } from "@/components/portal/deal-ui";
import { InvoiceDropBox } from "@/components/portal/invoice-drop-box";
import { CONTRACTOR_INVOICE_CATEGORY } from "@/lib/contractor-invoice";

export const metadata = { title: "Job" };

const day = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

/**
 * One job, as an installer is allowed to see it: where it is, when it is, and
 * a slot to put his invoice in. Nothing else.
 *
 * What is deliberately NOT here is most of the point. No price, no proposal, no
 * claim, no documents, no notes, no homeowner phone number — an installer is
 * named on a visit, not admitted to the customer record. The name and address
 * are the two facts his calendar has always shown him, so this page adds no
 * exposure over the event he already taps.
 *
 * Anyone else who lands here sees the same three things, and reaches the real
 * deal page through the link at the top. Whether that link renders is asked of
 * the LEAD scope rather than the role, because roofing installers on a standing
 * crew do hold deal access and should not be sent the long way round.
 */
export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!can(user, "read", "Project")) redirect("/portal/dashboard");

  const job = await prisma.project.findFirst({
    where: { AND: [{ id }, listScope(user, "Project") as Prisma.ProjectWhereInput] },
    select: {
      id: true,
      leadId: true,
      projectNumber: true,
      installDate: true,
      inspectionAt: true,
      address: true,
      city: true,
      state: true,
      zip: true,
      lead: { select: { firstName: true, lastName: true, address: true, city: true, state: true, zip: true } },
    },
  });
  if (!job) notFound();

  // Two questions, deliberately kept apart: how many invoices this job holds
  // (a count, which anyone standing on the job may know) and whether this
  // viewer can open one (which almost nobody may). Neither query returns a
  // file id — that list is Contractor Pay's, and only Contractor Pay's.
  const submitted = await prisma.fileAsset.count({
    where: {
      companyId: user.companyId,
      category: CONTRACTOR_INVOICE_CATEGORY,
      OR: [{ projectId: job.id }, { leadId: job.leadId }],
    },
  });

  // Does this viewer hold the customer record? Asked of the scope, not the
  // role — see the note above.
  const dealVisible = await prisma.lead.findFirst({
    where: { AND: [{ id: job.leadId }, listScope(user, "Lead") as Prisma.LeadWhereInput] },
    select: { id: true },
  });

  const customer = `${job.lead.firstName} ${job.lead.lastName}`.trim() || "Unnamed job";
  const where =
    [
      job.address ?? job.lead.address,
      job.city ?? job.lead.city,
      [job.state ?? job.lead.state, job.zip ?? job.lead.zip].filter(Boolean).join(" "),
    ]
      .filter(Boolean)
      .join(", ") || null;

  return (
    <div className="space-y-6">
      <Link
        href="/portal/jobs"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> My jobs
      </Link>

      <PageHeader
        title={customer}
        description={job.projectNumber}
        action={
          dealVisible ? (
            <Link
              href={`/portal/leads/${job.leadId}`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Open full deal
            </Link>
          ) : undefined
        }
      />

      <div className="grid gap-2 sm:grid-cols-2">
        {where && (
          <p className="flex items-start gap-2 rounded-lg border border-border bg-card p-4 text-sm">
            <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>{where}</span>
          </p>
        )}
        <p className="flex items-start gap-2 rounded-lg border border-border bg-card p-4 text-sm">
          <CalendarDays className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>
            {job.installDate ? day.format(job.installDate) : "Install not scheduled"}
            {job.inspectionAt && (
              <span className="block text-xs text-muted-foreground">
                Inspection {day.format(job.inspectionAt)}
              </span>
            )}
          </span>
        </p>
      </div>

      <Card
        title="Contractor Invoice"
        icon={ReceiptText}
        description="Submit what you billed for this job"
      >
        <InvoiceDropBox
          projectId={job.id}
          submitted={submitted}
          canUpload={can(user, "create", "File")}
        />
      </Card>
    </div>
  );
}
