import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Settings as SettingsIcon,
  KanbanSquare,
  SlidersHorizontal,
  FileSignature,
  DollarSign,
  Palette,
  ShieldCheck,
  Bell,
  Camera,
  ListChecks,
  Calculator,
  Megaphone,
} from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/portal/ui";

const SECTIONS: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  href?: string;
}[] = [
  { icon: KanbanSquare, title: "Pipeline Stages", body: "Customize the stages appointments move through.", href: "/portal/settings/pipeline" },
  { icon: ListChecks, title: "Appointment Outcomes", body: "Customize the outcomes reps record after appointments.", href: "/portal/settings/appointment-outcomes" },
  { icon: SlidersHorizontal, title: "Custom Fields", body: "Add custom fields to appointments and projects.", href: "/portal/settings/fields" },
  { icon: Megaphone, title: "Lead Sources", body: "Customize where leads come from (Door Knock, Referral, Ads…).", href: "/portal/settings/lead-sources" },
  { icon: FileSignature, title: "Document Templates", body: "Build and edit contract templates.", href: "/portal/documents" },
  { icon: DollarSign, title: "Commission Rules", body: "Set percentage, flat, and override rules.", href: "/portal/settings/commissions" },
  { icon: Bell, title: "Notification Rules", body: "Choose triggers, recipients, and channels.", href: "/portal/settings/notifications" },
  { icon: Camera, title: "Photo Templates", body: "Site & install photo checklists for projects.", href: "/portal/settings/photo-templates" },
  { icon: ListChecks, title: "Inspection Outcomes", body: "Customize the outcomes recorded after an inspection.", href: "/portal/settings/inspection-outcomes" },
  { icon: ListChecks, title: "Production Checklist", body: "The QC checklist applied to every new job.", href: "/portal/settings/production-checklist" },
  { icon: Calculator, title: "Scope of Work Catalog", body: "Master list of insurance-restoration line items (no pricing).", href: "/portal/settings/scope-template" },
  { icon: ShieldCheck, title: "Roles & Permissions", body: "Control what each role can see and do.", href: "/portal/settings/roles" },
  { icon: Palette, title: "Branding", body: "Company logo and brand colors.", href: "/portal/settings/branding" },
];

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  if (!can(user, "read", "Settings")) redirect("/portal/dashboard");

  const company = await prisma.company.findUnique({
    where: { id: user.companyId },
    include: { settings: true, _count: { select: { users: true, pipelines: true, documentTemplates: true } } },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description={`Customize ${company?.name ?? "your workspace"} — pipeline, fields, documents, commissions, and branding.`}
      />

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <SettingsIcon className="size-4 text-gold" />
          <h2 className="font-semibold">{company?.name}</h2>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Mini label="Users" value={company?._count.users ?? 0} />
          <Mini label="Pipelines" value={company?._count.pipelines ?? 0} />
          <Mini label="Doc Templates" value={company?._count.documentTemplates ?? 0} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((s) => {
          const inner = (
            <>
              <span className="grid size-10 place-items-center rounded-lg bg-gold/12 text-gold-muted">
                <s.icon className="size-5" />
              </span>
              <h3 className="mt-4 font-medium">{s.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
              <span
                className={`mt-3 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                  s.href ? "bg-gold/15 text-gold-muted" : "bg-muted text-muted-foreground"
                }`}
              >
                {s.href ? "Open" : "Next phase"}
              </span>
            </>
          );
          return s.href ? (
            <Link
              key={s.title}
              href={s.href}
              className="rounded-xl border border-border bg-card p-5 transition-colors hover:border-gold/40"
            >
              {inner}
            </Link>
          ) : (
            <div key={s.title} className="rounded-xl border border-border bg-card p-5">
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-xl font-semibold">{value}</div>
    </div>
  );
}
