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

  const selectable = roles.filter((r) => isSuperAdmin || r.value !== "super_admin");

  async function invite() {
    if (!email.trim()) return toast.error("Enter an email.");
    setBusy(true);
    const res = await inviteUserAction({ email, role: role as never });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    setLink(res.inviteLink ?? null);
    toast.success("Invitation created");
    router.refresh();
  }

  function reset() {
    setOpen(false);
    setEmail("");
    setRole("sales_rep");
    setLink(null);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : reset())}>
      <Button size="sm" onClick={() => setOpen(true)} className="bg-gold text-gold-foreground hover:bg-gold/90">
        <UserPlus className="size-4" /> Invite user
      </Button>
      <DialogContent>
        <DialogHeader><DialogTitle>Invite a team member</DialogTitle></DialogHeader>
        {link ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Invitation created. Share this link (valid 7 days):</p>
            <div className="flex items-center gap-2">
              <Input readOnly value={link} className="text-xs" />
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
