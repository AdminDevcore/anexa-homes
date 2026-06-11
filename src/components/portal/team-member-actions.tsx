"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Industry } from "@prisma/client";
import { INDUSTRIES, INDUSTRY_LABEL } from "@/lib/industry";
import { updateTeamMemberAction } from "@/server/modules/team/actions";

// Roles that earn a split commission (profit pool × their %).
const SPLIT_ROLES = ["sales_rep", "manager"];

export function TeamMemberActions({
  userId,
  currentRole,
  currentTitle,
  currentStatus,
  currentSplitPct,
  currentProvidedSplitPct,
  currentProvidedType,
  currentProvidedFlatCents,
  currentDeductiblePct,
  currentIndustries,
  currentSalesRepId,
  reps,
  currentManagerId,
  managers,
  roles,
  isSuperAdmin,
  isSelf,
}: {
  userId: string;
  currentRole: string;
  currentTitle: string | null;
  currentStatus: string;
  currentSplitPct: number | null;
  currentProvidedSplitPct: number | null;
  currentProvidedType: string;
  currentProvidedFlatCents: number | null;
  currentDeductiblePct: number | null;
  currentIndustries: Industry[];
  currentSalesRepId: string | null;
  reps: { id: string; name: string }[];
  currentManagerId: string | null;
  managers: { id: string; name: string }[];
  roles: { value: string; label: string }[];
  isSuperAdmin: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [role, setRole] = React.useState(currentRole);
  const [title, setTitle] = React.useState(currentTitle ?? "");
  const [status, setStatus] = React.useState(currentStatus);
  const [split, setSplit] = React.useState(currentSplitPct == null ? "" : String(currentSplitPct));
  const [providedSplit, setProvidedSplit] = React.useState(currentProvidedSplitPct == null ? "" : String(currentProvidedSplitPct));
  const [providedType, setProvidedType] = React.useState(currentProvidedType || "percentage");
  const [providedFlat, setProvidedFlat] = React.useState(currentProvidedFlatCents == null ? "" : String(currentProvidedFlatCents / 100));
  const [deductible, setDeductible] = React.useState(currentDeductiblePct == null ? "" : String(currentDeductiblePct));
  const [industries, setIndustries] = React.useState<Industry[]>(
    currentIndustries.length ? currentIndustries : [...INDUSTRIES]
  );
  const [salesRepId, setSalesRepId] = React.useState(currentSalesRepId ?? "none");
  const [managerId, setManagerId] = React.useState(currentManagerId ?? "none");
  const [busy, setBusy] = React.useState(false);

  function toggleIndustry(ind: Industry) {
    setIndustries((cur) => (cur.includes(ind) ? cur.filter((x) => x !== ind) : [...cur, ind]));
  }
  const industriesKey = (a: Industry[]) => [...a].sort().join(",");

  const selectableRoles = roles.filter((r) => isSuperAdmin || r.value !== "super_admin");
  const showSplit = SPLIT_ROLES.includes(role);
  const showCanvasserRep = role === "canvasser";
  const showRepManager = role === "sales_rep";
  const dirty =
    role !== currentRole ||
    title !== (currentTitle ?? "") ||
    status !== currentStatus ||
    split !== (currentSplitPct == null ? "" : String(currentSplitPct)) ||
    providedSplit !== (currentProvidedSplitPct == null ? "" : String(currentProvidedSplitPct)) ||
    providedType !== (currentProvidedType || "percentage") ||
    providedFlat !== (currentProvidedFlatCents == null ? "" : String(currentProvidedFlatCents / 100)) ||
    deductible !== (currentDeductiblePct == null ? "" : String(currentDeductiblePct)) ||
    salesRepId !== (currentSalesRepId ?? "none") ||
    managerId !== (currentManagerId ?? "none") ||
    (isSuperAdmin && industriesKey(industries) !== industriesKey(currentIndustries.length ? currentIndustries : [...INDUSTRIES]));

  async function save() {
    let commissionSplitPct: number | null = null;
    let providedLeadSplitPct: number | null = null;
    let providedLeadFlatCents: number | null = null;
    let deductiblePct: number | null = null;
    const providedLeadType: "percentage" | "flat" = providedType === "flat" ? "flat" : "percentage";
    if (showSplit) {
      if (split.trim() !== "") {
        const n = parseFloat(split);
        if (!(n >= 0 && n <= 100)) return toast.error("Self-gen split must be 0–100.");
        commissionSplitPct = n;
      }
      if (providedSplit.trim() !== "") {
        const n = parseFloat(providedSplit);
        if (!(n >= 0 && n <= 100)) return toast.error("Provided-lead split must be 0–100.");
        providedLeadSplitPct = n;
      }
      if (providedLeadType === "flat" && providedFlat.trim() !== "") {
        const f = parseFloat(providedFlat);
        if (!(f >= 0)) return toast.error("Lead fee must be a positive amount.");
        providedLeadFlatCents = Math.round(f * 100);
      }
      if (deductible.trim() !== "") {
        const n = parseFloat(deductible);
        if (!(n >= 0 && n <= 100)) return toast.error("Deductible % must be 0–100.");
        deductiblePct = n;
      }
    }
    if (isSuperAdmin && industries.length === 0) return toast.error("Grant at least one industry.");
    setBusy(true);
    const res = await updateTeamMemberAction({
      userId, role: role as never, title: title || null, status: status as never,
      commissionSplitPct, providedLeadType, providedLeadSplitPct, providedLeadFlatCents, deductiblePct,
      salesRepId: showCanvasserRep ? (salesRepId === "none" ? null : salesRepId) : null,
      managerId: showRepManager ? (managerId === "none" ? null : managerId) : null,
      ...(isSuperAdmin ? { industries } : {}),
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Member updated");
    router.refresh();
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
              {managers.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            This manager can see this rep&rsquo;s deals, canvassing, tasks, and commissions — and the canvassers under them. Managers only see their own team.
          </p>
        </div>
      )}

      {showSplit && (
        <div className="space-y-2 rounded-lg border border-gold/30 bg-gold/5 p-3">
          <Label className="text-xs">Commission splits (% of profit pool)</Label>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <span className="text-[11px] text-muted-foreground">Self-gen lead (%)</span>
              <Input type="number" inputMode="decimal" value={split} onChange={(e) => setSplit(e.target.value)} placeholder="e.g. 50" />
            </div>
            <div className="space-y-1">
              <span className="text-[11px] text-muted-foreground">Company-provided lead</span>
              <div className="flex gap-1">
                <Select value={providedType} onValueChange={setProvidedType}>
                  <SelectTrigger className="w-[68px] shrink-0 px-2"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">%</SelectItem>
                    <SelectItem value="flat">Flat $</SelectItem>
                  </SelectContent>
                </Select>
                {providedType === "flat" ? (
                  <Input type="number" inputMode="decimal" value={providedFlat} onChange={(e) => setProvidedFlat(e.target.value)} placeholder="$ 250" />
                ) : (
                  <Input type="number" inputMode="decimal" value={providedSplit} onChange={(e) => setProvidedSplit(e.target.value)} placeholder="e.g. 35" />
                )}
              </div>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Self-gen applies when the {role === "manager" ? "manager" : "rep"} sources the lead. For a company-provided lead, either a lower split %{" "}
            <strong>or</strong> a flat lead fee deducted from their self-gen commission.
          </p>
          <div className="space-y-1 border-t border-gold/20 pt-2">
            <span className="text-[11px] text-muted-foreground">Deductible the {role === "manager" ? "manager" : "rep"} gets (% of the customer-paid deductible)</span>
            <div className="flex items-center gap-2">
              <Input type="number" inputMode="decimal" value={deductible} onChange={(e) => setDeductible(e.target.value)} placeholder="e.g. 10" className="w-28" />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
            <p className="text-[11px] text-muted-foreground">Paid as a separate line on each deal&rsquo;s deductible. Leave blank if they don&rsquo;t get it.</p>
          </div>
        </div>
      )}

      {/* Industry access — only the Super Admin decides who sees which workspace. */}
      {isSuperAdmin && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <Label className="text-xs">Industry access</Label>
          <div className="flex flex-col gap-1.5">
            {INDUSTRIES.map((ind) => (
              <label key={ind} className="flex items-center gap-2 text-sm">
                <Checkbox checked={industries.includes(ind)} onCheckedChange={() => toggleIndustry(ind)} />
                {INDUSTRY_LABEL[ind]}
              </label>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Which workspaces this person can open and switch between. Grant at least one.
          </p>
        </div>
      )}

      <Button size="sm" onClick={save} disabled={busy || !dirty} className="bg-gold text-gold-foreground hover:bg-gold/90">
        {busy && <Loader2 className="size-4 animate-spin" />} Save changes
      </Button>
    </div>
  );
}
