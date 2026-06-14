"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Trash2, Loader2, PlusCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CostTemplateLine, SupplementTemplateLine } from "@/server/modules/scope/template-queries";
import {
  updateCostTemplateAction,
  updateCostTemplateItemAction,
  addMissingCostTemplateItemsAction,
  deleteCostTemplateAction,
  updateSupplementTemplateAction,
  updateSupplementTemplateItemAction,
  addMissingSupplementTemplateItemsAction,
  deleteSupplementTemplateAction,
} from "@/server/modules/scope/template-actions";

type Kind = "cost" | "supplement";
type Line = CostTemplateLine | SupplementTemplateLine;

const cell =
  "w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm hover:border-border focus:border-ring focus:outline-none";

export function ScopeTemplateEditor({
  kind,
  template,
}: {
  kind: Kind;
  template: { id: string; name: string; description: string | null; effectiveDate: string; isActive: boolean; lines: Line[] };
}) {
  const router = useRouter();
  const isCost = kind === "cost";
  const listPath = isCost ? "/portal/settings/scope-cost-templates" : "/portal/settings/scope-supplement-templates";
  const [busy, setBusy] = React.useState(false);

  const updateMeta = isCost ? updateCostTemplateAction : updateSupplementTemplateAction;
  const addMissing = isCost ? addMissingCostTemplateItemsAction : addMissingSupplementTemplateItemsAction;
  const remove = isCost ? deleteCostTemplateAction : deleteSupplementTemplateAction;

  async function saveMeta(patch: Record<string, unknown>) {
    const res = await updateMeta({ id: template.id, ...patch });
    if (!res.ok) toast.error(res.error);
    else router.refresh();
  }
  async function onAddMissing() {
    setBusy(true);
    const res = await addMissing(template.id);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Added catalog items.");
    router.refresh();
  }
  async function onDelete() {
    if (!confirm(`Delete template “${template.name}”? This removes its saved prices (the catalog is untouched).`)) return;
    setBusy(true);
    const res = await remove(template.id);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Template deleted.");
    router.push(listPath);
  }

  return (
    <div className="space-y-6">
      <Link href={listPath} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to {isCost ? "cost" : "supplement"} templates
      </Link>

      {/* Metadata */}
      <div className="space-y-4 rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-display text-xl font-semibold tracking-tight">{template.name || "Untitled template"}</h1>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onDelete} className="text-muted-foreground hover:text-destructive">
            <Trash2 className="size-4" /> Delete
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Name">
            <Input defaultValue={template.name} onBlur={(e) => e.target.value !== template.name && saveMeta({ name: e.target.value })} />
          </Field>
          <Field label="Effective date">
            <Input type="date" defaultValue={template.effectiveDate.slice(0, 10)} onBlur={(e) => e.target.value !== template.effectiveDate.slice(0, 10) && saveMeta({ effectiveDate: e.target.value })} />
          </Field>
          <Field label="Status">
            <label className="flex h-9 items-center gap-2 text-sm">
              <input type="checkbox" defaultChecked={template.isActive} onChange={(e) => saveMeta({ isActive: e.target.checked })} className="size-4 rounded border-border" />
              Active
            </label>
          </Field>
          <Field label="Description">
            <Input defaultValue={template.description ?? ""} placeholder="Optional" onBlur={(e) => e.target.value !== (template.description ?? "") && saveMeta({ description: e.target.value })} />
          </Field>
        </div>
      </div>

      {/* Priced catalog */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {template.lines.length} line{template.lines.length === 1 ? "" : "s"} from the catalog · prices here don&rsquo;t change the master catalog.
        </p>
        <Button size="sm" variant="outline" disabled={busy} onClick={onAddMissing}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <PlusCircle className="size-4" />} Add missing items
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">Subcategory</th>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 font-medium">Unit</th>
              <th className="px-3 py-2 text-right font-medium">{isCost ? "Cost $/u" : "Suppl. $/u"}</th>
              {!isCost && <th className="px-3 py-2 font-medium">Reason</th>}
              {!isCost && <th className="px-3 py-2 font-medium">Required evidence</th>}
              {!isCost && <th className="px-3 py-2 font-medium">Notes</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {template.lines.length === 0 && (
              <tr>
                <td colSpan={isCost ? 5 : 8} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No catalog items yet. Add items to the catalog, then “Add missing items.”
                </td>
              </tr>
            )}
            {template.lines.map((line) => (
              <Row key={line.id} kind={kind} line={line} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ kind, line }: { kind: Kind; line: Line }) {
  const router = useRouter();
  const isCost = kind === "cost";

  async function savePrice(cents: number) {
    const res = isCost
      ? await updateCostTemplateItemAction({ id: line.id, costPerUnitCents: cents })
      : await updateSupplementTemplateItemAction({ id: line.id, supplementPerUnitCents: cents });
    if (!res.ok) toast.error(res.error);
    else router.refresh();
  }
  async function saveText(patch: { reason?: string; requiredEvidence?: string; notes?: string }) {
    const res = await updateSupplementTemplateItemAction({ id: line.id, ...patch });
    if (!res.ok) toast.error(res.error);
    else router.refresh();
  }

  const priceCents = isCost ? (line as CostTemplateLine).costPerUnitCents : (line as SupplementTemplateLine).supplementPerUnitCents;
  const s = !isCost ? (line as SupplementTemplateLine) : null;

  return (
    <tr className="align-middle">
      <td className="px-3 py-1.5 text-muted-foreground">{line.category}</td>
      <td className="px-3 py-1.5 text-muted-foreground">{line.subcategory || "—"}</td>
      <td className="px-3 py-1.5">{line.description}</td>
      <td className="px-3 py-1.5 text-muted-foreground">{line.unit}</td>
      <td className="px-2 py-1 text-right">
        <input
          type="number"
          step="0.01"
          defaultValue={priceCents ? priceCents / 100 : ""}
          onBlur={(e) => {
            const v = parseFloat(e.target.value);
            const cents = Number.isFinite(v) ? Math.round(v * 100) : 0;
            if (cents !== priceCents) savePrice(cents);
          }}
          className={cn(cell, "w-24 text-right")}
          placeholder="0.00"
        />
      </td>
      {!isCost && s && (
        <>
          <td className="px-2 py-1">
            <Input defaultValue={s.reason ?? ""} placeholder="—" onBlur={(e) => e.target.value !== (s.reason ?? "") && saveText({ reason: e.target.value })} className="h-8 min-w-[9rem] text-sm" />
          </td>
          <td className="px-2 py-1">
            <Input defaultValue={s.requiredEvidence ?? ""} placeholder="—" onBlur={(e) => e.target.value !== (s.requiredEvidence ?? "") && saveText({ requiredEvidence: e.target.value })} className="h-8 min-w-[9rem] text-sm" />
          </td>
          <td className="px-2 py-1">
            <Textarea defaultValue={s.notes ?? ""} rows={1} placeholder="—" onBlur={(e) => e.target.value !== (s.notes ?? "") && saveText({ notes: e.target.value })} className="min-h-8 min-w-[10rem] text-sm" />
          </td>
        </>
      )}
    </tr>
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
