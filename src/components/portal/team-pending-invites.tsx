"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Mail, RotateCw, Trash2, Loader2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFormat } from "@/components/portal/branding-provider";
import { resendInvitationAction, revokeInvitationAction } from "@/server/modules/team/actions";

type PendingInvite = {
  id: string;
  email: string;
  role: string;
  roleLabel: string;
  invitedByName: string | null;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
};

export function TeamPendingInvites({ invites }: { invites: PendingInvite[] }) {
  const router = useRouter();
  const fmt = useFormat();
  const [busy, setBusy] = React.useState<string | null>(null);

  if (invites.length === 0) return null;

  async function resend(id: string) {
    setBusy(`${id}:resend`);
    const res = await resendInvitationAction(id);
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    if (res.inviteLink) navigator.clipboard?.writeText(res.inviteLink).catch(() => {});
    toast.success(res.emailed ? "Invite re-emailed — link also copied" : "Email not configured — link copied, send it manually");
    router.refresh();
  }

  async function revoke(id: string, email: string) {
    if (!window.confirm(`Revoke the invitation for ${email}? Their activation link will stop working.`)) return;
    setBusy(`${id}:revoke`);
    const res = await revokeInvitationAction(id);
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    toast.success("Invitation revoked");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Clock className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Pending invitations</h2>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">{invites.length}</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-left font-semibold">Email</th>
              <th className="px-4 py-2.5 text-left font-semibold">Role</th>
              <th className="hidden px-4 py-2.5 text-left font-semibold md:table-cell">Invited by</th>
              <th className="hidden px-4 py-2.5 text-left font-semibold lg:table-cell">Sent</th>
              <th className="px-4 py-2.5 text-left font-semibold">Status</th>
              <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {invites.map((inv) => (
              <tr key={inv.id} className="hover:bg-muted/40">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <Mail className="size-4 shrink-0 text-muted-foreground" />
                    <span className="font-medium">{inv.email}</span>
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <span className="rounded-full bg-gold/15 px-2.5 py-1 text-[11px] font-medium text-gold-muted">{inv.roleLabel}</span>
                </td>
                <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">{inv.invitedByName ?? "—"}</td>
                <td className="hidden px-4 py-2.5 tabular-nums text-muted-foreground lg:table-cell">{fmt.date(inv.createdAt)}</td>
                <td className="px-4 py-2.5">
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", inv.expired ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700")}>
                    {inv.expired ? "Expired" : "Invited"}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      onClick={() => resend(inv.id)}
                      disabled={!!busy}
                      className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                    >
                      {busy === `${inv.id}:resend` ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />} Resend
                    </button>
                    <button
                      onClick={() => revoke(inv.id, inv.email)}
                      disabled={!!busy}
                      className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      {busy === `${inv.id}:revoke` ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />} Revoke
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
