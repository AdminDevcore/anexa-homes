import {
  FileSignature,
  Home,
  CheckCircle2,
  Clock,
  Phone,
  ShieldCheck,
} from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { listScope } from "@/server/rbac/policies";
import { can } from "@/server/rbac/guards";
import { PageHeader, EmptyState } from "@/components/portal/ui";
import { currentFormatters } from "@/lib/format-server";
import { Button } from "@/components/ui/button";
import { ReviewSignButton } from "@/components/esign/review-sign-button";
import { FilesSection } from "@/components/portal/files-section";
import { currentBranding } from "@/server/branding/resolve";

export const metadata = { title: "My Portal" };

export default async function CustomerPortalPage() {
  const fmt = await currentFormatters();
  const user = await requireUser();
  const branding = await currentBranding();

  const projectWhere = listScope(user, "Project") as Prisma.ProjectWhereInput;
  const docWhere = listScope(user, "Document") as Prisma.DocumentPackageWhereInput;

  const [projects, pendingDocs] = await Promise.all([
    prisma.project.findMany({
      where: projectWhere,
      orderBy: { createdAt: "desc" },
      include: { lead: true, files: { orderBy: { createdAt: "desc" } } },
    }),
    prisma.documentPackage.findMany({
      where: { ...docWhere, status: { in: ["sent", "viewed", "partially_signed"] } },
      orderBy: { createdAt: "desc" },
      include: { signers: { where: { status: { in: ["pending", "sent", "viewed"] } } } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user.firstName}`}
        description="Track your project, review documents, and stay updated every step of the way."
      />

      {pendingDocs.length > 0 && (
        <div className="rounded-xl border border-gold/40 bg-gold/5 p-5">
          <div className="flex items-center gap-2 font-medium text-gold-muted">
            <FileSignature className="size-5" />
            Documents waiting for your signature
          </div>
          <ul className="mt-3 space-y-2">
            {pendingDocs.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
              >
                <span className="font-medium">{d.title}</span>
                <ReviewSignButton packageId={d.id} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {projects.length === 0 ? (
        <EmptyState
          icon={Home}
          title="No active project yet"
          description="Once your inspection is complete and your project begins, you'll see all the details here."
        />
      ) : (
        projects.map((p) => (
          <div key={p.id} className="space-y-4">
            <div className="rounded-xl border border-border bg-card">
              <div className="flex flex-col gap-2 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-display text-lg font-semibold">Project {p.projectNumber}</h2>
                  <p className="text-sm text-muted-foreground">
                    {p.address}, {p.city} {p.state} {p.zip}
                  </p>
                </div>
                <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background capitalize">
                  {p.status.replace(/_/g, " ")}
                </span>
              </div>
              <div className="grid gap-4 p-5 sm:grid-cols-3">
                <Info label="Roof System" value={p.materialSelection ?? p.roofingType ?? "—"} />
                <Info label="Contract Value" value={fmt.money(p.contractValue)} />
                <Info
                  label="Scheduled"
                  value={p.scheduledStart ? fmt.date(p.scheduledStart) : "To be scheduled"}
                />
              </div>
            </div>
            {/* Customers can add files but never delete — contracts stay immutable
                (also enforced server-side in deleteFileAction). */}
            <FilesSection
              title="Your Documents & Photos"
              files={p.files.map((f) => ({ id: f.id, name: f.name, kind: f.kind, mimeType: f.mimeType }))}
              projectId={p.id}
              canUpload={can(user, "create", "File")}
              canDelete={false}
            />
          </div>
        ))
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Feature icon={CheckCircle2} title="Quality Guaranteed" body="Every project includes a final QC inspection and warranty." />
        <Feature icon={Clock} title="Real-Time Updates" body="Your project status updates here as work progresses." />
        <Feature icon={ShieldCheck} title="Insurance Handled" body="We manage your claim and supplements for you." />
      </div>

      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">Questions about your project?</p>
        {branding.supportPhone && (
          <Button asChild variant="outline">
            <a href={`tel:${branding.supportPhone.replace(/[^0-9+]/g, "")}`}>
              <Phone className="size-4 text-gold" />
              Call your project team: {branding.supportPhone}
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}

function Feature({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <Icon className="size-5 text-gold" />
      <h3 className="mt-3 font-medium">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
