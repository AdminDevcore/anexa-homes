"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { VERTICALS, VERTICAL_LABEL, DEFAULT_VERTICAL, type ActiveVertical } from "@/lib/vertical";
import { updateTeamMemberAction, deleteTeamMemberAction } from "@/server/modules/team/actions";

// Pay terms deliberately do NOT live here any more. Role, status and workspace
// access are access-control decisions with their own guards — a Super Admin
// gate, a self-lockout check, a forced re-auth — and none of them should re-run
// because somebody corrected a decimal on a commission rate. Pay is its own
// card, its own action: see components/portal/member-pay-structure.tsx.

export function TeamMemberActions({
  userId,
  currentRole,
  currentTitle,
  currentStatus,
  currentIndustries,
  currentSalesRepId,
  reps,
  currentManagerId,
  managers,
  roles,
  assignableRoles,
  isSuperAdmin,
  isSelf,
}: {
  userId: string;
  currentRole: string;
  currentTitle: string | null;
  currentStatus: string;
  currentIndustries: ActiveVertical[];
  currentSalesRepId: string | null;
  reps: { id: string; name: string }[];
  currentManagerId: string | null;
  managers: { id: string; name: string; teamName: string | null }[];
  roles: { value: string; label: string }[];
  assignableRoles: string[];
  isSuperAdmin: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [role, setRole] = React.useState(currentRole);
  const [title, setTitle] = React.useState(currentTitle ?? "");
  const [status, setStatus] = React.useState(currentStatus);
  const [verticals, setIndustries] = React.useState<ActiveVertical[]>(
    currentIndustries.length ? currentIndustries : [DEFAULT_VERTICAL]
  );
  const [salesRepId, setSalesRepId] = React.useState(currentSalesRepId ?? "none");
  const [managerId, setManagerId] = React.useState(currentManagerId ?? "none");
  const [busy, setBusy] = React.useState(false);

  function toggleIndustry(ind: ActiveVertical) {
    setIndustries((cur) => (cur.includes(ind) ? cur.filter((x) => x !== ind) : [...cur, ind]));
  }
  const industriesKey = (a: ActiveVertical[]) => [...a].sort().join(",");

  // Show roles this editor may assign, plus the member's current role so saving
  // other fields (title/status) on a privileged member still works.
  const selectableRoles = roles.filter((r) => assignableRoles.includes(r.value) || r.value === currentRole);
  const showCanvasserRep = role === "canvasser";
  const showRepManager = role === "sales_rep";
  const dirty =
    role !== currentRole ||
    title !== (currentTitle ?? "") ||
    status !== currentStatus ||
    salesRepId !== (currentSalesRepId ?? "none") ||
    managerId !== (currentManagerId ?? "none") ||
    (isSuperAdmin && industriesKey(verticals) !== industriesKey(currentIndustries.length ? currentIndustries : [DEFAULT_VERTICAL]));

  async function save() {
    if (isSuperAdmin && verticals.length === 0) return toast.error("Grant at least one vertical.");
    setBusy(true);
    try {
      const res = await updateTeamMemberAction({
        userId, role: role as never, title: title || null, status: status as never,
        salesRepId: showCanvasserRep ? (salesRepId === "none" ? null : salesRepId) : null,
        managerId: showRepManager ? (managerId === "none" ? null : managerId) : null,
        ...(isSuperAdmin ? { verticals } : {}),
      });
      if (!res.ok) return toast.error(res.error);
      toast.success("Member updated");
      router.refresh();
    } finally {
      // In a finally: a thrown action must not leave the form permanently
      // disabled with nothing on screen explaining why.
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(
      "Delete this team member?\n\nThey'll be removed from the team and can no longer log in or receive notifications. Their existing deals stay in the company and keep showing their name. Tip: suspend first if you only want to pause access."
    )) return;
    setBusy(true);
    const res = await deleteTeamMemberAction(userId);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Member deleted");
    router.push("/portal/team");
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-5">
      <h3 className="font-semibold">Manage member</h3>
      {isSelf && <p className="text-xs text-amber-600">You can edit your own title, but not your own role or status.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Role</Label>
          <Select value={role} onValueChange={setRole} disabled={isSelf}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{selectableRoles.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Status</Label>
          <Select value={status} onValueChange={setStatus} disabled={isSelf}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Title</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Roofing Consultant" />
      </div>

      {/* Canvasser → sales rep. Everything this canvasser generates funnels to the rep. */}
      {showCanvasserRep && (
        <div className="space-y-1.5 rounded-lg border border-gold/30 bg-gold/5 p-3">
          <Label className="text-xs">Assigned sales rep (reports to)</Label>
          <Select value={salesRepId} onValueChange={setSalesRepId}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Unassigned" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Unassigned</SelectItem>
              {reps.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            Every knock, lead, and appointment this canvasser creates auto-assigns to this rep, and shows up in the rep&rsquo;s pipeline and canvassing views.
          </p>
        </div>
      )}

      {/* Sales rep → sales manager. The manager can see this rep's whole team. */}
      {showRepManager && (
        <div className="space-y-1.5 rounded-lg border border-gold/30 bg-gold/5 p-3">
          <Label className="text-xs">Sales manager (reports to)</Label>
          <Select value={managerId} onValueChange={setManagerId}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Unassigned" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Unassigned</SelectItem>
              {/* The team is what a rep is actually being put ON, so it is named
                  here rather than left for the profile page to reveal. */}
              {managers.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.teamName ? `${m.name} — ${m.teamName}` : m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            This manager can see this rep&rsquo;s deals, canvassing, tasks, and commissions — and the canvassers under them. Managers only see their own team.
          </p>
        </div>
      )}

      {/* Pay terms live in the Pay structure card, not here. */}

      {/* Vertical access — only the Super Admin decides who sees which workspace. */}
      {isSuperAdmin && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <Label className="text-xs">Vertical access</Label>
          <div className="flex flex-col gap-1.5">
            {VERTICALS.map((ind) => (
              <label key={ind} className="flex items-center gap-2 text-sm">
                <Checkbox checked={verticals.includes(ind)} onCheckedChange={() => toggleIndustry(ind)} />
                {VERTICAL_LABEL[ind]}
              </label>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Which workspaces this person can open and switch between. Grant at least one.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" onClick={save} disabled={busy || !dirty} className="bg-gold text-gold-foreground hover:bg-gold/90">
          {busy && <Loader2 className="size-4 animate-spin" />} Save changes
        </Button>
        {!isSelf && (
          <Button
            size="sm"
            variant="outline"
            onClick={remove}
            disabled={busy}
            className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
          >
            <Trash2 className="size-4" /> Delete user
          </Button>
        )}
      </div>
      {!isSelf && (
        <p className="text-[11px] text-muted-foreground">
          Deleting removes them from the team and stops their logins & notifications. Their deals stay in the pipeline under their name. To pause access temporarily, set Status to <strong>Suspended</strong> instead.
        </p>
      )}
    </div>
  );
}
