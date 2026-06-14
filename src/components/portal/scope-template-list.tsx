"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Loader2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/portal/ui";
import { FileSpreadsheet } from "lucide-react";
import type { TemplateSummary } from "@/server/modules/scope/template-queries";
import {
  createCostTemplateAction,
  createSupplementTemplateAction,
} from "@/server/modules/scope/template-actions";

type Kind = "cost" | "supplement";

export function ScopeTemplateList({
  kind,
  basePath,
  templates,
}: {
  kind: Kind;
  basePath: string;
  templates: TemplateSummary[];
}) {
  const router = useRouter();
  const label = kind === "cost" ? "Cost" : "Supplement";
  const [open, setOpen] = React.useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" /> Create New {label} Template
        </Button>
      </div>

      {templates.length === 0 ? (
        <EmptyState
          icon={FileSpreadsheet}
          title={`No ${label.toLowerCase()} templates yet`}
          description={`Create a ${label.toLowerCase()} template to price the catalog. It loads every active catalog item so you can set ${kind === "cost" ? "your cost" : "the expected supplement price"} per unit.`}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Effective</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 text-right font-medium">Items</th>
                <th className="w-8 px-2 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {templates.map((t) => (
                <tr key={t.id} className="hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <Link href={`${basePath}/${t.id}`} className="font-medium hover:text-gold-muted">
                      {t.name}
                    </Link>
                    {t.description && <p className="truncate text-xs text-muted-foreground">{t.description}</p>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(t.effectiveDate).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={t.isActive ? "default" : "outline"} className={t.isActive ? "" : "text-muted-foreground"}>
                      {t.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{t.itemCount}</td>
                  <td className="px-2 py-3 text-right">
                    <Link href={`${basePath}/${t.id}`} className="inline-flex text-muted-foreground hover:text-foreground" aria-label="Open">
                      <ChevronRight className="size-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <CreateDialog
          kind={kind}
          onClose={() => setOpen(false)}
          onCreated={(id) => router.push(`${basePath}/${id}`)}
        />
      )}
    </div>
  );
}

function CreateDialog({ kind, onClose, onCreated }: { kind: Kind; onClose: () => void; onCreated: (id: string) => void }) {
  const label = kind === "cost" ? "Cost" : "Supplement";
  const today = new Date().toISOString().slice(0, 10);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [effectiveDate, setEffectiveDate] = React.useState(today);
  const [isActive, setIsActive] = React.useState(true);
  const [busy, setBusy] = React.useState(false);

  async function create() {
    if (!name.trim()) return toast.error("Enter a template name.");
    setBusy(true);
    const fn = kind === "cost" ? createCostTemplateAction : createSupplementTemplateAction;
    const res = await fn({ name, description, effectiveDate, isActive });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(`${label} template created — loaded the catalog.`);
    onCreated(res.id);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New {label.toLowerCase()} template</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Template name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`e.g. ${kind === "cost" ? "2026 Crew Costs" : "2026 Supplement Targets"}`} autoFocus />
          </Field>
          <Field label="Description (optional)">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What this version is for" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Effective date">
              <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
            </Field>
            <Field label="Status">
              <label className="flex h-9 items-center gap-2 text-sm">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="size-4 rounded border-border" />
                Active
              </label>
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">
            Creating loads every active catalog item into this template at $0 — you set the prices next.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={create} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}
