"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserPlus, Loader2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { inviteUserAction } from "@/server/modules/team/actions";

export function TeamInvite({ roles, isSuperAdmin }: { roles: { value: string; label: string }[]; isSuperAdmin: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState("sales_rep");
  const [busy, setBusy] = React.useState(false);
  const [link, setLink] = React.useState<string | null>(null);
  const [emailed, setEmailed] = React.useState(false);
  const [invitedEmail, setInvitedEmail] = React.useState("");

  const selectable = roles.filter((r) => isSuperAdmin || r.value !== "super_admin");

  async function invite() {
    if (!email.trim()) return toast.error("Enter an email.");
    setBusy(true);
    const res = await inviteUserAction({ email, role: role as never });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    setLink(res.inviteLink ?? null);
    setEmailed(res.emailed);
    setInvitedEmail(email);
    toast.success(res.emailed ? "Invite emailed" : "Invite link created");
    router.refresh();
  }

  function reset() {
    setOpen(false);
    setEmail("");
    setRole("sales_rep");
    setLink(null);
    setEmailed(false);
    setInvitedEmail("");
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : reset())}>
      <Button size="sm" onClick={() => setOpen(true)} className="bg-gold text-gold-foreground hover:bg-gold/90">
        <UserPlus className="size-4" /> Invite user
      </Button>
      <DialogContent>
        <DialogHeader><DialogTitle>Invite a team member</DialogTitle></DialogHeader>
        {link ? (
          <div className="space-y-3">
            {emailed ? (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                ✓ Invite emailed to <strong>{invitedEmail}</strong>. They&rsquo;ll get a link to set their password, then complete onboarding on first login.
              </p>
            ) : (
              <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                ⚠ <strong>Email isn&rsquo;t set up</strong>, so this wasn&rsquo;t sent automatically. Copy the link below and send it to <strong>{invitedEmail}</strong> yourself (text, Slack, or email). To send invites automatically, add a <code className="rounded bg-amber-100 px-1">RESEND_API_KEY</code> in your environment.
              </p>
            )}
            <p className="text-sm text-muted-foreground">Activation link (valid 7 days):</p>
            <div className="flex items-center gap-2">
              <Input readOnly value={link} className="text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button size="icon" variant="outline" onClick={() => { navigator.clipboard?.writeText(link); toast.success("Copied"); }}>
                <Copy className="size-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{selectable.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
        )}
        <DialogFooter>
          {link ? (
            <Button onClick={reset}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={reset}>Cancel</Button>
              <Button onClick={invite} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} Create invite</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
