import { redirect } from "next/navigation";
import Link from "next/link";
import { FileSignature, FileText, Pencil } from "lucide-react";
import { DeleteTemplateButton } from "@/components/portal/delete-template-button";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { listScope } from "@/server/rbac/policies";
import { getActiveVertical, userVerticals } from "@/server/auth/vertical";
import { VERTICAL_LABEL } from "@/lib/vertical";
import { PageHeader, EmptyState } from "@/components/portal/ui";
import { ListFilter } from "@/components/portal/list-filter";
import { SendDocumentDialog } from "@/components/esign/send-document-dialog";
import { SignatureStatusBadge, roleLabel } from "@/components/esign/signature-status-badge";
import { ResendButton } from "@/components/esign/resend-button";
import { NewTemplateButton } from "@/components/portal/new-template-button";
import { currentFormatters } from "@/lib/format-server";
import { addressSearchText } from "@/lib/address";

export const metadata = { title: "Documents" };

export default async function DocumentsPage() {
  const fmt = await currentFormatters();
  const user = await requireUser();
  if (!can(user, "read", "Document")) redirect("/portal/dashboard");

  const canSend = can(user, "create", "Document");
  const docScope = listScope(user, "Document") as Prisma.DocumentPackageWhereInput;
  const leadScope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  // Isolate sent contracts + the "send to" list to the active vertical workspace.
  const vertical = await getActiveVertical(user);
  // Where else this person could be standing. A rep whose deals are all in the
  // other workspace needs to be told that, not left staring at an empty picker.
  const otherWorkspaces = userVerticals(user)
    .filter((v) => v !== vertical)
    .map((v) => VERTICAL_LABEL[v]);

  const [templates, packages, leads] = await Promise.all([
    prisma.documentTemplate.findMany({
      where: { companyId: user.companyId, active: true, vertical },
      orderBy: { name: "asc" },
    }),
    prisma.documentPackage.findMany({
      where: { AND: [docScope, { lead: { is: { vertical } } }] },
      orderBy: { createdAt: "desc" },
      include: {
        signers: true,
        lead: {
          select: {
            firstName: true,
            lastName: true,
            address: true,
            city: true,
            state: true,
            zip: true,
          },
        },
      },
    }),
    canSend
      ? prisma.lead.findMany({
          where: { AND: [leadScope, { vertical }] },
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
          /* Rendered on the permission alone. It used to also require a
             non-empty template list AND a non-empty scoped lead list, so a rep
             with no deals in this workspace got no button — which reads as "you
             may not send documents" rather than "you have nothing to send yet".
             Every sales rep in the company was in exactly that state in the
             workspace they land in by default. The dialog explains an empty
             list now; the page no longer hides the door. */
          canSend ? (
            <SendDocumentDialog
              templates={templates.map((t) => ({ id: t.id, name: t.name }))}
              leads={leads.map((l) => ({
                id: l.id,
                name: `${l.firstName} ${l.lastName}`,
                email: l.email ?? "",
              }))}
              workspace={VERTICAL_LABEL[vertical]}
              otherWorkspaces={otherWorkspaces}
              canManageTemplates={can(user, "update", "Document")}
            />
          ) : undefined
        }
      />

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
            {/* Don't tell somebody to click a button they were not given. A rep
                reads templates and sends them; authoring is an admin job. */}
            {can(user, "update", "Document") ? (
              <>
                No contract templates in this workspace yet. Click <strong>New template</strong> to add one, then map
                its fields to auto-fill from each deal.
              </>
            ) : (
              <>No contract templates in this workspace yet. An admin adds these.</>
            )}
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
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/portal/documents/templates/${t.id}`}
                      className="text-muted-foreground hover:text-gold-muted"
                      aria-label="Edit template"
                    >
                      <Pencil className="size-4" />
                    </Link>
                    <DeleteTemplateButton id={t.id} name={t.name} />
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
        )}
      </div>

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
          <ListFilter placeholder="Search documents, customer, address…" className="p-5">
          <ul className="divide-y divide-border rounded-lg border border-border">
            {packages.map((p) => {
              const signedCount = p.signers.filter((s) => s.status === "signed").length;
              const showResend =
                canSend && ["sent", "viewed", "partially_signed"].includes(p.status);
              return (
              <li
                key={p.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between"
                data-search-item
                data-search-text={`${p.status} ${addressSearchText(p.lead)} ${p.signers
                  .map((s) => `${s.name} ${s.status}`)
                  .join(" ")}`}
              >
                <div className="min-w-0">
                  <Link href={`/portal/documents/${p.id}`} className="font-medium hover:text-gold-muted">
                    {p.title}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {p.lead ? `${p.lead.firstName} ${p.lead.lastName} · ` : ""}
                    {p.signers.length} signer(s) · {fmt.date(p.createdAt)}
                  </div>
                  {p.signers.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {p.signers.map((s) => (
                        <span
                          key={s.id}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px]"
                        >
                          <span className="font-medium">{s.name}</span>
                          {s.role !== "customer" && (
                            <span className="text-muted-foreground">{roleLabel(s.role)}</span>
                          )}
                          <SignatureStatusBadge status={s.status} className="px-1.5 py-0" />
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 sm:flex-col sm:items-end">
                  <SignatureStatusBadge status={p.status} />
                  {p.signers.length > 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      signed {signedCount} of {p.signers.length}
                    </span>
                  )}
                  {showResend && <ResendButton packageId={p.id} />}
                </div>
              </li>
              );
            })}
          </ul>
          </ListFilter>
        )}
      </div>

    </div>
  );
}
