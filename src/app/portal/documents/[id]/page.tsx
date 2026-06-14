import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  FileDown,
  ShieldCheck,
  ShieldAlert,
  Users,
  History,
} from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import { prisma } from "@/server/db/client";
import { verifyChain } from "@/server/modules/esign/audit";
import { PageHeader } from "@/components/portal/ui";
import { VoidButton } from "@/components/esign/void-button";
import { ResendButton } from "@/components/esign/resend-button";
import { SignatureStatusBadge, roleLabel } from "@/components/esign/signature-status-badge";
import { Button } from "@/components/ui/button";
import { currentFormatters } from "@/lib/format-server";

export const metadata = { title: "Document" };

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const fmt = await currentFormatters();
  const { id } = await params;
  const user = await requireUser();

  // Scope by role, not just company: a rep must not open another rep's document by id.
  const pkg = await prisma.documentPackage.findFirst({
    where: { id, ...(listScope(user, "Document") as Prisma.DocumentPackageWhereInput) },
    include: {
      signers: { orderBy: { order: "asc" } },
      events: { orderBy: { createdAt: "asc" } },
      lead: { select: { firstName: true, lastName: true } },
      signedFile: true,
    },
  });
  if (!pkg) notFound();

  const chainValid = verifyChain(pkg.events);
  const canVoid = can(user, "update", "Document") && pkg.status !== "completed" && pkg.status !== "voided";
  const canResend =
    can(user, "create", "Document") && ["sent", "viewed", "partially_signed"].includes(pkg.status);

  return (
    <div className="space-y-6">
      <Link
        href="/portal/documents"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to documents
      </Link>

      <PageHeader
        title={pkg.title}
        description={pkg.lead ? `${pkg.lead.firstName} ${pkg.lead.lastName}` : undefined}
        action={
          <div className="flex items-center gap-2">
            <SignatureStatusBadge status={pkg.status} className="px-3 py-1 text-xs" />
            {canResend && <ResendButton packageId={pkg.id} />}
            {/* Filled PDF on demand (auto-filled + signatures so far) — view it,
                don't only send it. */}
            <Button asChild size="sm" variant="outline">
              <a href={`/portal/documents/${pkg.id}/pdf`} target="_blank" rel="noopener noreferrer">
                <FileDown className="size-4" /> Generate PDF
              </a>
            </Button>
            {pkg.status === "completed" && pkg.signedFileId && (
              <Button asChild size="sm" className="bg-gold text-gold-foreground hover:bg-gold/90">
                <a href={`/portal/documents/${pkg.id}/download`}>
                  <Download className="size-4" /> Download signed
                </a>
              </Button>
            )}
            {canVoid && <VoidButton packageId={pkg.id} />}
          </div>
        }
      />

      {/* Integrity */}
      <div
        className={`flex items-center gap-2 rounded-xl border p-4 text-sm ${
          chainValid
            ? "border-emerald-300 bg-emerald-50 text-emerald-700"
            : "border-destructive/40 bg-destructive/10 text-destructive"
        }`}
      >
        {chainValid ? <ShieldCheck className="size-5" /> : <ShieldAlert className="size-5" />}
        {chainValid
          ? "Audit trail integrity verified — the hash chain is intact (tamper-evident)."
          : "Warning: audit trail hash chain does not validate."}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Signers */}
        <div className="rounded-xl border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
            <Users className="size-4 text-gold" />
            <h2 className="font-semibold">Signers</h2>
          </div>
          <ul className="divide-y divide-border">
            {pkg.signers.map((s) => (
              <li key={s.id} className="px-5 py-3.5">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {s.name}
                    {s.role !== "customer" && (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        {roleLabel(s.role)}
                      </span>
                    )}
                  </span>
                  <SignatureStatusBadge status={s.status} />
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {s.email ?? "—"}
                  {s.signedAt && <> · signed {fmt.date(s.signedAt)}</>}
                  {s.ip && <> · IP {s.ip}</>}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Audit trail */}
        <div className="rounded-xl border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
            <History className="size-4 text-gold" />
            <h2 className="font-semibold">Audit Trail</h2>
          </div>
          <ul className="divide-y divide-border">
            {pkg.events.map((e) => {
              const hash = (e.metadata as { hash?: string } | null)?.hash ?? "";
              return (
                <li key={e.id} className="px-5 py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium capitalize">{e.type.replace(/_/g, " ")}</span>
                    <span className="text-xs text-muted-foreground">{fmt.date(e.createdAt)}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {e.actor ?? "system"}
                    {e.ip && ` · ${e.ip}`}
                  </div>
                  {hash && (
                    <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground/70">
                      sha256: {hash.slice(0, 32)}…
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
