import { redirect } from "next/navigation";
import Link from "next/link";
import { Users, Phone, Mail, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { listScope } from "@/server/rbac/policies";
import { getActiveIndustry } from "@/server/auth/industry";
import { PageHeader, EmptyState } from "@/components/portal/ui";
import { ListFilter } from "@/components/portal/list-filter";
import { formatCents, formatDateTime } from "@/lib/format";
import { serviceTypeLabel } from "@/lib/service-types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "Appointments" };

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireUser();
  if (!can(user, "read", "Lead")) redirect("/portal/dashboard");

  const { q } = await searchParams;
  // Isolate by the active industry workspace (Roofing / Solar / Water).
  const industry = await getActiveIndustry(user);
  const scope: Prisma.LeadWhereInput = { ...(listScope(user, "Lead") as Prisma.LeadWhereInput), industry };
  const where: Prisma.LeadWhereInput = q
    ? {
        AND: [
          scope,
          {
            OR: [
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
            ],
          },
        ],
      }
    : scope;

  const leads = await prisma.lead.findMany({
    where,
    // Scheduled appointments first (soonest-known first), unscheduled last.
    orderBy: [{ appointmentAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    include: {
      stage: { select: { name: true, color: true } },
      source: { select: { name: true } },
      assignedRep: { select: { firstName: true, lastName: true } },
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Appointments"
        description={`${leads.length} ${leads.length === 1 ? "appointment" : "appointments"} in your view`}
        action={
          <div className="flex items-center gap-2">
            <form className="flex gap-2">
              <input
                name="q"
                defaultValue={q}
                placeholder="Search appointments…"
                className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </form>
            {can(user, "create", "Lead") && (
              <Button asChild className="bg-gold text-gold-foreground hover:bg-gold/90">
                <Link href="/portal/leads/new">
                  <Plus className="size-4" /> New Appointment
                </Link>
              </Button>
            )}
          </div>
        }
      />

      {leads.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No appointments found"
          description="Appointments from canvassing conversions, lead providers, and website inquiries will appear here."
        />
      ) : (
        <ListFilter placeholder="Search name, phone, address…">
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">Contact</TableHead>
                <TableHead className="hidden lg:table-cell">Type</TableHead>
                <TableHead className="hidden lg:table-cell">Source</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="hidden sm:table-cell">Rep</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="hidden lg:table-cell">Appointment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((l) => (
                <TableRow key={l.id} className="cursor-pointer" data-search-item data-search-text={`${l.firstName} ${l.lastName} ${l.phone ?? ""} ${l.email ?? ""} ${l.address ?? ""} ${l.city ?? ""} ${l.appointmentDisposition ?? ""}`}>
                  <TableCell>
                    <Link href={`/portal/leads/${l.id}`} className="font-medium hover:text-gold-muted">
                      {l.firstName} {l.lastName}
                    </Link>
                    <div className="text-xs text-muted-foreground md:hidden">{l.phone}</div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                      {l.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="size-3" /> {l.phone}
                        </span>
                      )}
                      {l.email && (
                        <span className="flex items-center gap-1">
                          <Mail className="size-3" /> {l.email}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">
                      {serviceTypeLabel(l.serviceType)}
                    </span>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                    {l.source?.name ?? "—"}
                  </TableCell>
                  <TableCell>
                    {l.stage ? (
                      <span
                        className="rounded-full px-2.5 py-1 text-[11px] font-medium"
                        style={{ backgroundColor: `${l.stage.color}22`, color: l.stage.color }}
                      >
                        {l.stage.name}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                    {l.assignedRep ? `${l.assignedRep.firstName} ${l.assignedRep.lastName}` : "Unassigned"}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCents(l.value, { compact: true })}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                    {l.appointmentAt ? (
                      formatDateTime(l.appointmentAt)
                    ) : (
                      <span className="text-muted-foreground/60">Not scheduled</span>
                    )}
                    {l.appointmentDisposition && (
                      <span className="mt-1 block w-fit rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-medium text-gold-muted">
                        {l.appointmentDisposition}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        </ListFilter>
      )}
    </div>
  );
}
