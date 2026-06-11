"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { acceptInviteAction } from "@/server/auth/invite";

export function AcceptInviteForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [f, setF] = React.useState({ firstName: "", lastName: "", password: "", confirm: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (f.password.length < 8) return toast.error("Password must be at least 8 characters.");
    if (f.password !== f.confirm) return toast.error("Passwords don't match.");
    setBusy(true);
    const res = await acceptInviteAction({ token, firstName: f.firstName, lastName: f.lastName, password: f.password });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Account activated — sign in to continue.");
    router.push(`/login?activated=1&email=${encodeURIComponent(res.email)}`);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label>Email</Label>
        <Input value={email} disabled readOnly />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5"><Label>First name</Label><Input value={f.firstName} onChange={set("firstName")} required autoFocus /></div>
        <div className="space-y-1.5"><Label>Last name</Label><Input value={f.lastName} onChange={set("lastName")} required /></div>
      </div>
      <div className="space-y-1.5"><Label>Create password</Label><Input type="password" value={f.password} onChange={set("password")} placeholder="At least 8 characters" required /></div>
      <div className="space-y-1.5"><Label>Confirm password</Label><Input type="password" value={f.confirm} onChange={set("confirm")} required /></div>
      <Button type="submit" disabled={busy} className="w-full">
        {busy && <Loader2 className="size-4 animate-spin" />} Activate &amp; continue
      </Button>
    </form>
  );
}
