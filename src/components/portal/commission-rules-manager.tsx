"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createCommissionRuleAction,
  updateCommissionRuleAction,
  deleteCommissionRuleAction,
  toggleCommissionRuleAction,
} from "@/server/modules/payroll/actions";
import { formatCents } from "@/lib/format";

type Rule = {
  id: string;
  name: string;
  role: string;
  type: string;
  percent: number;
  flatAmount: number;
  projectType: string | null;
  active: boolean;
};

// Commission rule categories (NOT user roles). "project_manager" pays the
// project's assigned manager (Project.managerId).
const ROLES = ["sales_rep", "manager", "project_manager", "installer"] as const;
const RULE_ROLE_LABELS: Record<string, string> = {
  sales_rep: "Sales Rep",
  manager: "Manager",
  project_manager: "Project Manager",
  installer: "Installer / Crew",
};
const ruleRoleLabel = (r: string) => RULE_ROLE_LABELS[r] ?? r;

export function CommissionRulesManager({ rules }: { rules: Rule[] }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <RuleDialog />
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card divide-y divide-border">
        {rules.length === 0 && (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">No rules yet.</div>
        )}
        {rules.map((r) => (
          <RuleRow key={r.id} rule={r} />
        ))}
      </div>
    </div>
  );
}

function RuleRow({ rule }: { rule: Rule }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function toggle(active: boolean) {
    setBusy(true);
    const res = await toggleCommissionRuleAction(rule.id, active);
    setBusy(false);
    if (res.ok) router.refresh();
    else toast.error(res.error);
  }

  async function remove() {
    if (!confirm("Delete this rule?")) return;
    setBusy(true);
    const res = await deleteCommissionRuleAction(rule.id);
    setBusy(false);
    if (res.ok) {
      toast.success("Rule deleted");
      router.refresh();
    } else toast.error(res.error);
  }

  const value =
    rule.type === "flat" ? formatCents(rule.flatAmount) : `${rule.percent}%`;

  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3.5">
      <div className="min-w-0">
        <div className="font-medium">{rule.name}</div>
        <div className="text-xs text-muted-foreground">
          {ruleRoleLabel(rule.role)} · {rule.type.replace(/_/g, " ")} · {value}
          {rule.projectType ? ` · ${rule.projectType}` : ""}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={rule.active} onCheckedChange={toggle} disabled={busy} />
        <RuleDialog rule={rule} trigger={<Button variant="ghost" size="icon"><Pencil className="size-4" /></Button>} />
        <Button variant="ghost" size="icon" onClick={remove} disabled={busy}>
          <Trash2 className="size-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
}

function RuleDialog({ rule, trigger }: { rule?: Rule; trigger?: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(rule?.name ?? "");
  const [role, setRole] = React.useState<string>(rule?.role ?? "sales_rep");
  const [type, setType] = React.useState<string>(rule?.type ?? "percentage");
  const [percent, setPercent] = React.useState<string>(rule ? String(rule.percent) : "10");
  const [flatDollars, setFlatDollars] = React.useState<string>(rule ? String(rule.flatAmount / 100) : "0");
  const [projectType, setProjectType] = React.useState(rule?.projectType ?? "");
  const [pending, setPending] = React.useState(false);

  async function save() {
    if (!name.trim()) {
      toast.error("Name is required.");
      return;
    }
    setPending(true);
    const payload = {
      name,
      role: role as "sales_rep" | "manager" | "project_manager" | "installer",
      type: type as "percentage" | "flat" | "job_cost",
      percent: Number(percent) || 0,
      flatAmount: Math.round((Number(flatDollars) || 0) * 100),
      projectType: projectType || "",
    };
    const res = rule
      ? await updateCommissionRuleAction(rule.id, payload)
      : await createCommissionRuleAction(payload);
    setPending(false);
    if (res.ok) {
      toast.success(rule ? "Rule updated" : "Rule created");
      setOpen(false);
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button className="bg-gold text-gold-foreground hover:bg-gold/90">
            <Plus className="size-4" /> Add Rule
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{rule ? "Edit" : "New"} Commission Rule</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sales Rep — 10%" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Applies to role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{ruleRoleLabel(r)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Percentage</SelectItem>
                  <SelectItem value="flat">Flat amount</SelectItem>
                  <SelectItem value="job_cost">Job-cost %</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {type === "flat" ? (
            <div className="space-y-1.5">
              <Label>Flat amount (USD)</Label>
              <Input type="number" value={flatDollars} onChange={(e) => setFlatDollars(e.target.value)} />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Percent (%)</Label>
              <Input type="number" value={percent} onChange={(e) => setPercent(e.target.value)} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Project type filter (optional)</Label>
            <Input value={projectType} onChange={(e) => setProjectType(e.target.value)} placeholder="e.g. Shingle" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={pending} className="bg-gold text-gold-foreground hover:bg-gold/90">
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {rule ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
