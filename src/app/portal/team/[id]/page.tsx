import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Mail, Phone, Briefcase, Calendar, Clock, Shield, Users2, ChevronRight, ShieldCheck, Lock, Landmark, FileText, MapPin, Paperclip } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { isPayEligible, PAY_ELIGIBLE_ROLES } from "@/server/rbac/matrix";
import { getUserDetail, getAssignableReps, getAssignableManagers, ROLE_ORDER } from "@/server/modules/team/queries";
import { getUserOnboarding } from "@/server/modules/onboarding/queries";
import { roleLabel, assignableRolesFor } from "@/lib/roles";
import { currentFormatters } from "@/lib/format-server";
import { currentBranding } from "@/server/branding/resolve";
import { formatEmployeeNo } from "@/lib/employee";
import { initials } from "@/lib/format";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { TeamMemberActions } from "@/components/portal/team-member-actions";
import { CommissionOverrides } from "@/components/portal/commission-overrides";
import { MemberPayStructure } from "@/components/portal/member-pay-structure";
import { RepVendorLink } from "@/components/portal/rep-vendor-link";
import { prisma } from "@/server/db/client";
import { allowedVerticals, isActiveVertical, DEFAULT_VERTICAL } from "@/lib/vertical";
import { companyVerticals, userVerticals } from "@/server/auth/vertical";
import { getSolarSettings } from "@/server/modules/solar/settings";

export const metadata = { title: "Team member" };

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  invited: "bg-blue-100 text-blue-700",
  suspended: "bg-amber-100 text-amber-700",
  disabled: "bg-red-100 text-red-700",
};

export default async function TeamMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const fmt = await currentFormatters();
  const { id } = await params;
  const user = await requireUser();
  if (!can(user, "read", "User")) redirect("/portal/dashboard");

  const detail = await getUserDetail(user.companyId, id);
  if (!detail) notFound();

  const branding = await currentBranding();
  const employeeNo = formatEmployeeNo(branding.recordPrefix, detail.employeeNo);

  const isPrivileged = ["super_admin", "admin", "manager"].includes(user.role);
  const canEdit = can(user, "update", "User");
  const isSelf = detail.id === user.userId;
  const showFull = isPrivileged || isSelf;
  const roles = ROLE_ORDER.map((r) => ({ value: r, label: roleLabel(r) }));
  // Roles this editor may assign (privileged roles are Super Admin-only).
  const assignableRoles = assignableRolesFor(user.role) as string[];
  // Sales reps a canvasser can be assigned to (only needed by the editor).
  const assignableReps = canEdit ? await getAssignableReps(user.companyId, detail.id) : [];
  const assignableManagers = canEdit ? await getAssignableManagers(user.companyId, detail.id) : [];

  // Onboarding / payroll PII — owner, admin, accounting, or the member themselves.
  const canViewOnboarding = ["super_admin", "admin", "accounting"].includes(user.role) || isSelf;
  const onboarding = canViewOnboarding ? await getUserOnboarding(user.companyId, detail.id) : null;

  // Overrides this member earns off other people's deals (commission-capable roles).
  // Read unfiltered by workspace on purpose: this is the person's whole override
  // sheet, and an admin standing in Roofing still needs to see the Solar rates.
  const showOverrides = showFull && isPayEligible(detail.role);
  const [overrideRows, overrideCandidates] = showOverrides
    ? await Promise.all([
        prisma.commissionOverride.findMany({
          where: { companyId: user.companyId, beneficiaryId: id },
          include: { source: { select: { firstName: true, lastName: true } } },
          orderBy: [{ vertical: "asc" }, { createdAt: "asc" }],
        }),
        prisma.user.findMany({
          where: { companyId: user.companyId, status: "active", role: { in: PAY_ELIGIBLE_ROLES }, id: { not: id } },
          select: { id: true, firstName: true, lastName: true, role: true, verticals: true },
          orderBy: { firstName: "asc" },
        }),
      ])
    : [[], []];
  // Workspaces this build runs — one vertical collapses the override sheet back
  // to a flat list with no picker.
  const liveVerticals = companyVerticals();

  // Pay structure. Same audience as the override sheet — privileged viewers and
  // the person themselves — and the same reason for reading it unfiltered by the
  // active workspace: an admin standing in Solar still needs this rep's roofing
  // terms. Only the roles the commission engine actually reads carry terms.
  const memberVerticals = allowedVerticals(detail.verticals);
  const showPay = showFull && isPayEligible(detail.role);
  const showSolarPay = showPay && memberVerticals.includes("solar");
  // The company's own pricing defaults, so the worked example is a deal this
  // company would actually write, and the names of the lenders currently on
  // fixed pay, so "$0.40/W" is not an unexplained number.
  const [solarSettings, perWattLenders] = showSolarPay
    ? await Promise.all([
        getSolarSettings(user.companyId),
        prisma.solarLender.findMany({
          where: { companyId: user.companyId, isActive: true, repPayMode: "per_watt" },
          select: { name: true },
          orderBy: { name: "asc" },
        }),
      ])
    : [null, []];

  // Sales reps are 1099 contractors — show their linked vendor + let admins reassign it.
  const showRepVendor = canEdit && detail.role === "sales_rep";
  const [companyVendors, linkedVendor] = showRepVendor
    ? await Promise.all([
        prisma.bookkeepingVendor.findMany({ where: { companyId: user.companyId }, orderBy: { name: "asc" }, select: { id: true, name: true, is1099: true } }),
        prisma.bookkeepingVendor.findFirst({ where: { companyId: user.companyId, userId: detail.id }, select: { id: true } }),
      ])
    : [[], null];

  const links = [
    { label: "Assigned appointments", value: detail.activity.assignedLeads, href: "/portal/leads" },
    { label: "Open tasks", value: detail.activity.openTasks, href: "/portal/tasks" },
    { label: "Completed tasks", value: detail.activity.doneTasks, href: "/portal/tasks" },
    { label: "Appointments", value: detail.activity.appointments, href: "/portal/canvassing" },
    { label: "Knocks", value: detail.activity.knocks, href: "/portal/canvassing" },
    { label: "Commissions", value: `${detail.activity.commissionCount} · ${fmt.money(detail.activity.commissionTotalCents)}`, href: "/portal/commissions" },
  ];

  return (
    <div className="space-y-6">
      <Link href="/portal/team" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to team
      </Link>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Profile */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-4">
              <Avatar className="size-16 border border-border">
                {detail.avatarUrl && <AvatarImage src={detail.avatarUrl} alt={detail.name} />}
                <AvatarFallback className="bg-foreground text-lg font-semibold text-background">{initials(detail.name)}</AvatarFallback>
              </Avatar>
              <div>
                <h1 className="font-display text-2xl font-semibold">{detail.name}</h1>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {employeeNo && (
                    <span className="rounded-full bg-neutral-900 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-white" title="Employee number — rank by join order (lower = earlier)">
                      {employeeNo}
                    </span>
                  )}
                  <span className="rounded-full bg-gold/15 px-2.5 py-1 text-[11px] font-medium text-gold-muted">{detail.roleLabel}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${STATUS_STYLES[detail.status] ?? "bg-muted text-muted-foreground"}`}>{detail.status}</span>
                </div>
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Detail icon={Briefcase} label="Title" value={detail.title ?? "—"} />
              <Detail icon={Mail} label="Email" value={detail.email} />
              <Detail icon={Phone} label="Phone" value={detail.phone ?? "—"} />
              <Detail icon={Calendar} label="Joined" value={fmt.date(detail.createdAt)} />
              <Detail icon={Clock} label="Last active" value={detail.lastLoginAt ? fmt.date(detail.lastLoginAt) : "Never"} />
            </div>
          </div>

          {/* Pay structure — both verticals, side by side. `isRep` is wording
              only: everyone but a sales manager is paid here as the rep on
              their own deals, an owner who sells included. */}
          {showPay && (
            <MemberPayStructure
              userId={detail.id}
              roleLabel={detail.roleLabel}
              isRep={detail.role !== "manager"}
              verticals={memberVerticals}
              canEdit={canEdit}
              current={{
                commissionSplitPct: detail.commissionSplitPct,
                providedLeadType: detail.providedLeadType,
                providedLeadSplitPct: detail.providedLeadSplitPct,
                providedLeadFlatCents: detail.providedLeadFlatCents,
                deductiblePct: detail.deductiblePct,
                solarRedlineCentsPerWatt: detail.solarRedlineCentsPerWatt,
                solarPerWattMills: detail.solarPerWattMills,
              }}
              solarExample={{
                grossPpwCents: solarSettings?.defaultGrossPpwCents ?? 350,
                dealerFeePct: solarSettings?.defaultDealerFeePct ?? 18,
              }}
              perWattLenders={perWattLenders.map((l) => l.name)}
            />
          )}

          {/* Onboarding & payroll PII — restricted to owner/admin/accounting/self */}
          {canViewOnboarding && (
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="mb-4 flex items-center gap-2">
                <ShieldCheck className="size-4 text-gold" />
                <h2 className="font-display text-lg font-semibold">Onboarding &amp; Payroll</h2>
                {onboarding?.completedAt ? (
                  <span className="ml-auto rounded-full border bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium">Completed</span>
                ) : (
                  <span className="ml-auto rounded-full border chip-warning px-2 py-0.5 text-[11px] font-medium">Pending</span>
                )}
              </div>
              {onboarding ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Detail icon={Users2} label="Legal name" value={[onboarding.legalFirstName, onboarding.legalMiddleName, onboarding.legalLastName].filter(Boolean).join(" ") || "—"} />
                  <Detail icon={Calendar} label="Date of birth" value={onboarding.dateOfBirth ? fmt.date(new Date(onboarding.dateOfBirth)) : "—"} />
                  <Detail icon={Lock} label="SSN" value={onboarding.ssnMasked ?? "—"} />
                  <Detail icon={MapPin} label="Address" value={[onboarding.address, onboarding.city, onboarding.state, onboarding.zip].filter(Boolean).join(", ") || "—"} />
                  <Detail icon={Landmark} label="Bank" value={`${onboarding.bankName ?? "—"}${onboarding.accountType ? ` · ${onboarding.accountType}` : ""}`} />
                  <Detail icon={Users2} label="Name on account" value={onboarding.accountHolderName ?? "—"} />
                  <Detail icon={Lock} label="Account" value={`${onboarding.accountMasked ?? "—"}${onboarding.routingNumber ? ` · rtg ${onboarding.routingNumber}` : ""}`} />
                  <Detail icon={MapPin} label="Address on account" value={onboarding.accountAddress ?? "—"} />
                  <Detail icon={FileText} label="Tax class" value={onboarding.taxClassification ? onboarding.taxClassification.replace(/_/g, " ") : "—"} />
                  <Detail icon={Lock} label="EIN" value={onboarding.einMasked ?? "—"} />
                  <div className="flex flex-wrap gap-2 pt-1 sm:col-span-2">
                    {onboarding.idPhotoFileId && (
                      <a href={`/portal/files/${onboarding.idPhotoFileId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"><Paperclip className="size-3.5" /> License front</a>
                    )}
                    {onboarding.idPhotoBackFileId && (
                      <a href={`/portal/files/${onboarding.idPhotoBackFileId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"><Paperclip className="size-3.5" /> License back</a>
                    )}
                    {onboarding.ssnCardFileId && (
                      <a href={`/portal/files/${onboarding.ssnCardFileId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"><Paperclip className="size-3.5" /> SS card front</a>
                    )}
                    {onboarding.ssnCardBackFileId && (
                      <a href={`/portal/files/${onboarding.ssnCardBackFileId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"><Paperclip className="size-3.5" /> SS card back</a>
                    )}
                    {onboarding.voidedCheckFileId && (
                      <a href={`/portal/files/${onboarding.voidedCheckFileId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"><Paperclip className="size-3.5" /> Voided check</a>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Onboarding not started yet.</p>
              )}
            </div>
          )}

          {/* Reporting relationship (canvasser → rep → manager) */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="flex items-center gap-2 font-semibold"><Users2 className="size-4 text-muted-foreground" /> Reporting</h3>

            {/* Who this person reports to */}
            {detail.role === "canvasser" && (
              <p className="mt-2 text-sm">
                <span className="text-muted-foreground">Reports to (sales rep): </span>
                {detail.salesRepName ? <span className="font-medium">{detail.salesRepName}</span> : <span className="text-muted-foreground">Unassigned</span>}
                <span className="mt-1 block text-xs text-muted-foreground">Their knocks, leads, and appointments auto-assign to this rep.</span>
              </p>
            )}
            {detail.role === "sales_rep" && (
              <p className="mt-2 text-sm">
                <span className="text-muted-foreground">Reports to (sales manager): </span>
                {detail.managerName ? <span className="font-medium">{detail.managerName}</span> : <span className="text-muted-foreground">Unassigned</span>}
                <span className="mt-1 block text-xs text-muted-foreground">This manager can see everything this rep&apos;s team does.</span>
              </p>
            )}

            {/* Reps reporting to a manager */}
            {detail.reports.length > 0 && (
              <div className="mt-3 border-t border-border pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Sales reps reporting to {detail.firstName} ({detail.reports.length})
                </p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {detail.reports.map((r) => (
                    <li key={r.id}>
                      <Link href={`/portal/team/${r.id}`} className="inline-flex rounded-full bg-muted px-2.5 py-1 text-xs font-medium hover:bg-muted/70">{r.name}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Canvassers reporting to a rep */}
            {detail.canvassers.length > 0 && (
              <div className="mt-3 border-t border-border pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Canvassers reporting to {detail.firstName} ({detail.canvassers.length})
                </p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {detail.canvassers.map((c) => (
                    <li key={c.id}>
                      <Link href={`/portal/team/${c.id}`} className="inline-flex rounded-full bg-muted px-2.5 py-1 text-xs font-medium hover:bg-muted/70">{c.name}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {detail.role === "manager" && detail.reports.length === 0 && (
              <p className="mt-2 text-sm text-muted-foreground">
                No reps assigned. Assign sales reps to this manager from each rep&apos;s profile so their team&apos;s work shows up here.
              </p>
            )}
          </div>

          {/* Activity rollups (privileged or self) */}
          {showFull && (
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="font-semibold">Activity</h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {links.map((l) => (
                  <Link key={l.label} href={l.href} className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 text-sm hover:bg-muted/50">
                    <span className="text-muted-foreground">{l.label}</span>
                    <span className="flex items-center gap-1 font-medium tabular-nums">{l.value} <ChevronRight className="size-3.5 text-muted-foreground" /></span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {canEdit ? (
            <TeamMemberActions
              userId={detail.id}
              currentRole={detail.role}
              currentTitle={detail.title}
              currentStatus={detail.status}
              // Retired values on legacy rows are filtered out here, so the editor
              // only ever shows (and can only ever save) live verticals.
              currentIndustries={allowedVerticals(detail.verticals)}
              currentSalesRepId={detail.salesRepId}
              reps={assignableReps}
              currentManagerId={detail.managerId}
              managers={assignableManagers}
              roles={roles}
              assignableRoles={assignableRoles}
              isSuperAdmin={user.role === "super_admin"}
              isSelf={isSelf}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-card/50 p-5 text-sm text-muted-foreground">
              View only — editing roles and status is limited to admins.
            </div>
          )}

          {showRepVendor && (
            <RepVendorLink userId={detail.id} vendors={companyVendors} currentVendorId={linkedVendor?.id ?? null} />
          )}

          {showOverrides && (
            <CommissionOverrides
              beneficiaryId={detail.id}
              beneficiaryName={detail.firstName}
              overrides={overrideRows.map((o) => ({
                id: o.id,
                sourceId: o.sourceId,
                sourceName: `${o.source.firstName} ${o.source.lastName}`.trim(),
                // Retired verticals are pinned to the default so a legacy row
                // still renders somewhere real instead of an empty group.
                vertical: isActiveVertical(o.vertical) ? o.vertical : DEFAULT_VERTICAL,
                type: o.type as "percentage" | "flat",
                percent: o.percent,
                flatAmount: o.flatAmount,
              }))}
              candidates={overrideCandidates.map((c) => ({
                id: c.id,
                name: `${c.firstName} ${c.lastName}`.trim(),
                // Only the sides this person works: an override on a workspace
                // they can't sell in would never pay, so it isn't offered.
                verticals: userVerticals(c),
              }))}
              verticals={liveVerticals}
              canEdit={canEdit}
            />
          )}

          {showFull && (
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="flex items-center gap-2 font-semibold"><Shield className="size-4 text-muted-foreground" /> Role access</h3>
              <p className="mt-1 text-xs text-muted-foreground">What the {detail.roleLabel} role can access.</p>
              <ul className="mt-3 space-y-1.5 text-sm">
                {detail.permissions.length === 0 && <li className="text-muted-foreground">No access grants.</li>}
                {detail.permissions.map((p) => (
                  <li key={p.resource} className="flex items-start justify-between gap-2">
                    <span className="font-medium">{p.resource}</span>
                    <span className="text-right text-xs capitalize text-muted-foreground">{p.actions.join(", ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Detail({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="truncate text-sm font-medium">{value}</div>
      </div>
    </div>
  );
}
