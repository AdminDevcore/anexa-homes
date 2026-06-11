import { redirect } from "next/navigation";
import Link from "next/link";
import { FileSignature, FileText, Pencil } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { listScope } from "@/server/rbac/policies";
import { getActiveIndustry } from "@/server/auth/industry";
import { PageHeader, EmptyState } from "@/components/portal/ui";
import { ListFilter } from "@/components/portal/list-filter";
import { SendDocumentDialog } from "@/components/esign/send-document-dialog";
import { NewTemplateButton } from "@/components/portal/new-template-button";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Documents" };

export default async function DocumentsPage() {
  const user = await requireUser();
  if (!can(user, "read", "Document")) redirect("/portal/dashboard");

  const isStaff = user.role !== "customer";
  const canSend = can(user, "create", "Document");
  const docScope = listScope(user, "Document") as Prisma.DocumentPackageWhereInput;
  const leadScope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  // Isolate sent contracts + the "send to" list to the active industry workspace.
  const industry = await getActiveIndustry(user);

  const [templates, packages, leads] = await Promise.all([
    isStaff
      ? prisma.documentTemplate.findMany({
          where: { companyId: user.companyId, active: true, industry },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    prisma.documentPackage.findMany({
      where: { AND: [docScope, { lead: { is: { industry } } }] },
      orderBy: { createdAt: "desc" },
      include: { signers: true, lead: { select: { firstName: true, lastName: true } } },
    }),
    canSend
      ? prisma.lead.findMany({
          where: { AND: [leadScope, { industry }] },
          orderBy: { createdAt: "desc" },
          take: 100,
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documents"
        description="Contracts, agreements, and e-signatures."
        action={
          canSend && templates.length > 0 && leads.length > 0 ? (
            <SendDocumentDialog
              templates={templates.map((t) => ({ id: t.id, name: t.name }))}
              leads={leads.map((l) => ({
                id: l.id,
                name: `${l.firstName} ${l.lastName}`,
                email: l.email ?? "",
              }))}
            />
          ) : undefined
        }
      />

      {isStaff && (
        <div className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3.5">
            <div className="flex items-center gap-2">
              <FileText className="size-4 text-gold" />
              <h2 className="font-semibold">Templates</h2>
            </div>
            {can(user, "update", "Document") && <NewTemplateButton />}
          </div>
          {templates.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              No contract templates in this workspace yet. Click <strong>New template</strong> to add one, then map its
              fields to auto-fill from each deal.
            </div>
          ) : (
          <ul className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
            {templates.map((t) => (
              <li key={t.id} className="bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{t.name}</div>
                    <div className="mt-1 text-xs capitalize text-muted-foreground">
                      {t.type.replace(/_/g, " ")}
                    </div>
                  </div>
                  {can(user, "update", "Document") && (
                    <Link
                      href={`/portal/documents/templates/${t.id}`}
                      className="text-muted-foreground hover:text-gold-muted"
                      aria-label="Edit template"
                    >
                      <Pencil className="size-4" />
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
          )}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
          <FileSignature className="size-4 text-gold" />
          <h2 className="font-semibold">Sent for Signature</h2>
        </div>
        {packages.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={FileSignature}
              title="No documents sent yet"
              description={
                canSend
                  ? "Click “Send for Signature” to send a contract to a customer."
                  : "Signed documents will appear here."
              }
            />
          </div>
        ) : (
          <ListFilter placeholder="Search documents…" className="p-5">
          <ul className="divide-y divide-border rounded-lg border border-border">
            {packages.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-5 py-4" data-search-item data-search-text={`${p.title} ${p.lead ? `${p.lead.firstName} ${p.lead.lastName}` : ""} ${p.status}`}>
                <div>
                  <Link href={`/portal/documents/${p.id}`} className="font-medium hover:text-gold-muted">
                    {p.title}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {p.lead ? `${p.lead.firstName} ${p.lead.lastName} · ` : ""}
                    {p.signers.length} signer(s) · {formatDate(p.createdAt)}
                  </div>
                </div>
                <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium capitalize">
                  {p.status.replace(/_/g, " ")}
                </span>
              </li>
            ))}
          </ul>
          </ListFilter>
        )}
      </div>
    </div>
  );
}
