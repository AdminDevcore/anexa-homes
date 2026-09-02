import { cn } from "@/lib/utils";

// Shared status pill for signature packages and individual signers, so the
// documents list and the document detail page stay visually consistent.
const STATUS_STYLES: Record<string, { label?: string; className: string }> = {
  completed: { className: "bg-emerald-100 text-emerald-700" },
  signed: { className: "bg-emerald-100 text-emerald-700" },
  partially_signed: { label: "partially signed", className: "bg-amber-100 text-amber-700" },
  viewed: { className: "bg-blue-100 text-blue-700" },
  sent: { className: "bg-muted text-muted-foreground" },
  pending: { className: "bg-muted text-muted-foreground" },
  draft: { className: "bg-muted text-muted-foreground" },
  declined: { className: "bg-destructive/10 text-destructive" },
  voided: { className: "bg-destructive/10 text-destructive" },
  expired: { className: "bg-destructive/10 text-destructive" },
};

export function SignatureStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const style = STATUS_STYLES[status] ?? { className: "bg-muted text-muted-foreground" };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium capitalize",
        style.className,
        className
      )}
    >
      {style.label ?? status.replace(/_/g, " ")}
    </span>
  );
}

const ROLE_LABELS: Record<string, string> = {
  customer: "customer",
  // "Co-owner" everywhere, matching the deal's own field. "Co-borrower" was
  // financing vocabulary on a role that signs cash contracts too.
  co_customer: "co-owner",
  // Not "company rep": nobody from the company signs this by hand any more —
  // it is the authorised signer's mark, applied at send.
  company_rep: "signed for us",
  witness: "witness",
};

/** Human label for a signer role (e.g. "co_customer" -> "co-owner"). */
export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role.replace(/_/g, " ");
}
