import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, Hammer, MapPin } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import { prisma } from "@/server/db/client";
import { PageHeader, EmptyState } from "@/components/portal/ui";

export const metadata = { title: "My Jobs" };

const day = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });

/**
 * The installer's whole portal: the jobs he is on, and a way into each one.
 *
 * It exists because of the invoice. An installer is named on a visit and is
 * deliberately NOT admitted to the customer record (see the Lead branch of
 * rbac/policies.ts), so before this there was no page he could open that
 * belonged to a job at all — the calendar showed him a date with nowhere to go.
 * That was tolerable while he only needed to know where to be on Tuesday; it is
 * not tolerable when he also has to bill for Tuesday, possibly a fortnight
 * later, when the visit has scrolled off the calendar.
 *
 * Scoped through `listScope(user, "Project")`, so it is not an installer-only
 * page in its implementation — anyone who opens it sees exactly the jobs their
 * role already grants. Only the sidebar entry is narrowed to installers, who
 * are the only people without a better route to the same jobs.
 */
export default async function MyJobsPage() {
  const user = await requireUser();
  if (!can(user, "read", "Project")) redirect("/portal/dashboard");

  const jobs = await prisma.project.findMany({
    where: listScope(user, "Project") as Prisma.ProjectWhereInput,
    // Most recently scheduled first, so the job someone is standing on — or
    // just finished — is the one at the top. Nulls last: an unscheduled job is
    // not the one being invoiced today.
    orderBy: [{ installDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: 100,
    select: {
      id: true,
      projectNumber: true,
      status: true,
      installDate: true,
      address: true,
      city: true,
      state: true,
      lead: { select: { firstName: true, lastName: true, address: true, city: true, state: true } },
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Jobs"
        description="The jobs you're on. Open one to submit your invoice."
      />

      {jobs.length === 0 ? (
        <EmptyState
          icon={Hammer}
          title="No jobs assigned yet"
          description="Once you're added to an install or an inspection, that job shows up here."
        />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {jobs.map((j) => {
            const where =
              [j.address ?? j.lead.address, j.city ?? j.lead.city, j.state ?? j.lead.state]
                .filter(Boolean)
                .join(", ") || null;
            return (
              <li key={j.id}>
                <Link
                  href={`/portal/jobs/${j.id}`}
                  className="block rounded-lg border border-border bg-card p-4 transition-colors hover:border-gold/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-medium">
                      {`${j.lead.firstName} ${j.lead.lastName}`.trim() || "Unnamed job"}
                    </span>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      {j.projectNumber}
                    </span>
                  </div>
                  {where && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="mt-0.5 size-3.5 shrink-0" />
                      {where}
                    </p>
                  )}
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CalendarDays className="size-3.5 shrink-0" />
                    {j.installDate ? day.format(j.installDate) : "Install not scheduled"}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
