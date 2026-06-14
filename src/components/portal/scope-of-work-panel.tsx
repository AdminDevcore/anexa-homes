"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  FileText,
  Upload,
  Trash2,
  Plus,
  Loader2,
  Download,
  DownloadCloud,
  LayoutGrid,
  Eye,
  EyeOff,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { computeScope, formatScopeDollars, SCOPE_UNITS } from "@/lib/scope";
import type { ScopeDTO, ScopeLineDTO } from "@/server/modules/scope/queries";
import {
  addScopeLineAction,
  updateScopeLineAction,
  deleteScopeLineAction,
  importFromClaimAction,
  loadFromCatalogAction,
  uploadScopePdfAction,
  deleteScopePdfAction,
  updateScopePaFeePctAction,
  updateScopeDeductibleAction,
  updateScopeTemplatesAction,
} from "@/server/modules/scope/actions";

type Props = {
  leadId: string;
  scope: ScopeDTO | null;
  canEdit: boolean;
  canSeeCosts: boolean;
  hasClaimLines: boolean;
  hasTemplate: boolean;
};

const cell =
  "w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm hover:border-border focus:border-ring focus:outline-none disabled:opacity-60";

/** Cost & supplement per unit come from the selected templates (by catalog item).
 *  Legacy free-text lines (no catalogItemId) keep their inline cost; no supplement. */
function resolveUnitPrices(line: ScopeLineDTO, scope: ScopeDTO) {
  const costPerUnit = line.catalogItemId
    ? scope.costPrices[line.catalogItemId] ?? 0
    : line.costUnitPrice ?? 0;
  const supplementPerUnit = line.catalogItemId ? scope.supplementPrices[line.catalogItemId] ?? 0 : 0;
  return { costPerUnit, supplementPerUnit };
}

export function ScopeOfWorkPanel({ leadId, scope, canEdit, canSeeCosts, hasClaimLines, hasTemplate }: Props) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [showAll, setShowAll] = React.useState(false);
  const lines = scope?.lines ?? [];
  const paFeePct = scope?.paFeePct ?? 0;
  const overheadPct = scope?.overheadPct ?? 0;
  const estDeductibleCents = scope?.estDeductibleCents ?? 0;

  // A catalog line counts as "empty" until it has a quantity or an insurance price.
  // Custom (non-catalog) lines were added by hand, so they always stay visible.
  const isFilled = (l: ScopeLineDTO) => !l.catalogItemId || l.quantity > 0 || l.insuranceUnitPrice > 0;
  const visibleLines = showAll ? lines : lines.filter(isFilled);
  const hiddenCount = lines.length - visibleLines.length;

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(key);
    const res = await fn();
    setBusy(null);
    if (!res.ok) return toast.error(res.error ?? "Something went wrong.");
    router.refresh();
  }

  const calc = scope
    ? computeScope(
        lines.map((l) => {
          const { costPerUnit, supplementPerUnit } = resolveUnitPrices(l, scope);
          return {
            quantity: l.quantity,
            insuranceUnitPriceCents: l.insuranceUnitPrice,
            costPerUnitCents: costPerUnit,
            supplementPerUnitCents: supplementPerUnit,
          };
        }),
        { paFeePct, overheadPct: scope.overheadPct }
      )
    : null;

  return (
    <div className="space-y-5">
      {/* Carrier scope PDF */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-5 py-4">
        <div className="flex items-center gap-2 text-sm">
          <FileText className="size-4 text-muted-foreground" />
          <span className="font-medium">Carrier scope PDF</span>
        </div>
        <div className="flex items-center gap-2">
          {scope?.pdfFileId ? (
            <>
              <Button asChild size="sm" variant="outline">
                <a href={`/portal/scope/${scope.id}/pdf`} target="_blank" rel="noopener noreferrer">
                  <Download className="size-4" /> View scope
                </a>
              </Button>
              {canEdit && (
                <Button size="sm" variant="ghost" disabled={busy === "pdf-del"} onClick={() => run("pdf-del", () => deleteScopePdfAction(leadId))}>
                  {busy === "pdf-del" ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />} Remove
                </Button>
              )}
            </>
          ) : canEdit ? (
            <PdfUpload leadId={leadId} onDone={() => router.refresh()} />
          ) : (
            <span className="text-sm text-muted-foreground">Not uploaded</span>
          )}
        </div>
      </div>

      {/* Template pickers */}
      {scope && canEdit && (
        <div className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-card px-5 py-4">
          {canSeeCosts && (
            <Picker
              label="Cost template"
              value={scope.costTemplateId ?? ""}
              options={scope.costTemplates}
              emptyHint={scope.costTemplates.length === 0 ? "None yet — create one in Settings" : "— none —"}
              onChange={(v) => run("cost-tpl", () => updateScopeTemplatesAction({ leadId, costTemplateId: v || null }))}
            />
          )}
          <Picker
            label="Supplement template"
            value={scope.supplementTemplateId ?? ""}
            options={scope.supplementTemplates}
            emptyHint={scope.supplementTemplates.length === 0 ? "None yet — create one in Settings" : "— none —"}
            onChange={(v) => run("supp-tpl", () => updateScopeTemplatesAction({ leadId, supplementTemplateId: v || null }))}
          />
          <p className="text-xs text-muted-foreground">
            Cost &amp; supplement per unit come from these templates, matched by catalog item.
          </p>
        </div>
      )}

      {/* Toolbar */}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy === "catalog"} onClick={() => run("catalog", () => loadFromCatalogAction(leadId))}>
            {busy === "catalog" ? <Loader2 className="size-4 animate-spin" /> : <LayoutGrid className="size-4" />} Load from catalog
          </Button>
          <Button size="sm" variant="outline" disabled={busy === "add"} onClick={() => run("add", () => addScopeLineAction({ leadId }))}>
            <Plus className="size-4" /> Add custom line
          </Button>
          {hasClaimLines && (
            <Button size="sm" variant="outline" disabled={busy === "import"} onClick={() => run("import", () => importFromClaimAction(leadId))}>
              <DownloadCloud className="size-4" /> Import from claim
            </Button>
          )}
        </div>
      )}

      {/* Show/hide empty catalog rows */}
      {lines.length > 0 && (hiddenCount > 0 || showAll) && (
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">
            {showAll
              ? `Showing all ${lines.length} catalog items.`
              : `Showing ${visibleLines.length} filled-in ${visibleLines.length === 1 ? "line" : "lines"} · ${hiddenCount} empty hidden.`}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setShowAll((s) => !s)}>
            {showAll ? <><EyeOff className="size-4" /> Hide empty</> : <><Eye className="size-4" /> Show all catalog items</>}
          </Button>
        </div>
      )}

      {/* Spreadsheet */}
      <div className="max-h-[70vh] overflow-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground shadow-[inset_0_-1px_0_0_var(--border)]">
              <th className="bg-card px-3 py-2 font-medium">Category</th>
              <th className="bg-card px-3 py-2 font-medium">Description</th>
              <th className="bg-card px-3 py-2 text-right font-medium">Qty</th>
              <th className="bg-card px-3 py-2 font-medium">Unit</th>
              <th className="bg-card px-3 py-2 text-right font-medium">Ins $/u</th>
              {canSeeCosts && <th className="bg-card px-3 py-2 text-right font-medium">Cost $/u</th>}
              <th className="bg-card px-3 py-2 text-right font-medium">Suppl $/u</th>
              <th className="bg-card px-3 py-2 text-right font-medium">Insurance RCV</th>
              {canSeeCosts && <th className="bg-card px-3 py-2 text-right font-medium">Cost</th>}
              <th className="bg-card px-3 py-2 text-right font-medium">Supplement</th>
              {canEdit && <th className="w-8 bg-card px-2 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {lines.length === 0 && (
              <tr>
                <td colSpan={canSeeCosts ? 11 : 9} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No line items yet. {canEdit && "“Load from catalog” to pull every catalog item, then set Qty and Ins $/u."}
                </td>
              </tr>
            )}
            {lines.length > 0 && visibleLines.length === 0 && (
              <tr>
                <td colSpan={canSeeCosts ? 11 : 9} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No filled-in lines yet. {canEdit && "Use “Show all catalog items” above to pick an item and set its Qty."}
                </td>
              </tr>
            )}
            {scope &&
              visibleLines.map((line) => {
                const { costPerUnit, supplementPerUnit } = resolveUnitPrices(line, scope);
                return (
                  <ScopeRow
                    key={line.id}
                    leadId={leadId}
                    line={line}
                    costPerUnit={costPerUnit}
                    supplementPerUnit={supplementPerUnit}
                    canEdit={canEdit}
                    canSeeCosts={canSeeCosts}
                    onDeleted={() => router.refresh()}
                  />
                );
              })}
          </tbody>
          {calc && lines.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td className="px-3 py-3" colSpan={canSeeCosts ? 7 : 6}>Totals</td>
                <td className="px-3 py-3 text-right">{formatScopeDollars(calc.insuranceRcvCents)}</td>
                {canSeeCosts && <td className="px-3 py-3 text-right">{formatScopeDollars(calc.internalCostCents)}</td>}
                <td className="px-3 py-3 text-right text-gold-muted">{formatScopeDollars(calc.supplementedRevenueCents)}</td>
                {canEdit && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Summary */}
      {calc && canSeeCosts && lines.length > 0 && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Insurance allowed (RCV)" value={formatScopeDollars(calc.insuranceRcvCents)} />
            <Stat label="Our cost" value={formatScopeDollars(calc.internalCostCents)} />
            <Stat label={`Company overhead (${overheadPct}%)`} value={`-${formatScopeDollars(calc.currentOverheadCents)}`} />
            <Stat
              label="Profit pool (no supplement)"
              value={`${formatScopeDollars(calc.currentProfitCents)} · ${calc.currentMarginPct.toFixed(1)}%`}
              accent={calc.currentProfitCents >= 0 ? "good" : "bad"}
            />
          </div>
          <DeductibleSplit
            leadId={leadId}
            rcvCents={calc.insuranceRcvCents}
            estDeductibleCents={estDeductibleCents}
            canEdit={canEdit}
          />
          <SupplementSummary leadId={leadId} calc={calc} paFeePct={paFeePct} overheadPct={overheadPct} canEdit={canEdit} />
        </div>
      )}
    </div>
  );
}

function Picker({
  label,
  value,
  options,
  emptyHint,
  onChange,
}: {
  label: string;
  value: string;
  options: { id: string; name: string }[];
  emptyHint: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-[12rem] rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground"
      >
        <option value="">{emptyHint}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </label>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: "good" | "bad" }) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        accent === "good" && "border-emerald-300/60 bg-emerald-50",
        accent === "bad" && "border-destructive/40 bg-destructive/5",
        !accent && "border-border bg-card"
      )}
    >
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: "good" | "bad" }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 text-base font-semibold tabular-nums", accent === "good" && "text-emerald-600", accent === "bad" && "text-destructive")}>
        {value}
      </div>
    </div>
  );
}

/** Estimated deductible — informational split of the RCV (homeowner vs. carrier).
 *  Does NOT change the profit pool; it just shows who pays what for collections. */
function DeductibleSplit({
  leadId,
  rcvCents,
  estDeductibleCents,
  canEdit,
}: {
  leadId: string;
  rcvCents: number;
  estDeductibleCents: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const deductible = Math.min(estDeductibleCents, rcvCents);
  const insurancePays = Math.max(0, rcvCents - deductible);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-semibold">Estimated deductible</span>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          $
          <input
            type="number"
            step="0.01"
            min={0}
            defaultValue={estDeductibleCents ? estDeductibleCents / 100 : ""}
            disabled={!canEdit}
            placeholder="0.00"
            onBlur={(e) => {
              const v = parseFloat(e.target.value);
              const cents = Number.isFinite(v) ? Math.round(v * 100) : 0;
              if (cents === estDeductibleCents) return;
              updateScopeDeductibleAction({ leadId, estDeductibleCents: cents }).then((r) =>
                r.ok ? router.refresh() : toast.error(r.error)
              );
            }}
            className="w-28 rounded-md border border-border bg-background px-2 py-1 text-right text-sm disabled:opacity-60"
          />
        </label>
      </div>
      {deductible > 0 ? (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <MiniStat label="Insurance pays" value={formatScopeDollars(insurancePays)} />
            <MiniStat label="Homeowner pays (deductible)" value={formatScopeDollars(deductible)} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            The homeowner&rsquo;s deductible is part of the RCV — the carrier pays the rest. This is for collections only;
            it doesn&rsquo;t change the profit pool.
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Enter the policy deductible to see how the RCV splits between the carrier and the homeowner.
        </p>
      )}
    </div>
  );
}

/** Projected revenue/profit if we supplement (extra recovery, net of the PA fee). */
function SupplementSummary({
  leadId,
  calc,
  paFeePct,
  overheadPct,
  canEdit,
}: {
  leadId: string;
  calc: ReturnType<typeof computeScope>;
  paFeePct: number;
  overheadPct: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const hasSupplement = calc.supplementRecoveredCents > 0;
  const gain = calc.projectedProfitCents - calc.currentProfitCents;

  return (
    <div className="rounded-xl border border-gold/30 bg-gold/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-semibold text-gold-muted">If we supplement (public adjuster)</span>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          PA fee
          <input
            type="number"
            step="0.5"
            min={0}
            max={100}
            defaultValue={paFeePct}
            disabled={!canEdit}
            onBlur={(e) => {
              const v = parseFloat(e.target.value);
              if (!Number.isFinite(v) || v === paFeePct) return;
              updateScopePaFeePctAction({ leadId, paFeePct: v }).then((r) => (r.ok ? router.refresh() : toast.error(r.error)));
            }}
            className="w-16 rounded-md border border-border bg-background px-2 py-1 text-right text-sm disabled:opacity-60"
          />
          %
        </label>
      </div>

      {/* Always show the supplement projection so the rep can compare options. */}
      <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MiniStat label="Supplemented revenue" value={formatScopeDollars(calc.supplementedRevenueCents)} />
        <MiniStat label="Amount recovered" value={`+${formatScopeDollars(calc.supplementRecoveredCents)}`} />
        <MiniStat label={`PA fee (${paFeePct}%)`} value={`-${formatScopeDollars(calc.paFeeCents)}`} />
        <MiniStat label={`Overhead (${overheadPct}%)`} value={`-${formatScopeDollars(calc.projectedOverheadCents)}`} />
        <MiniStat
          label="Projected profit pool"
          value={`${formatScopeDollars(calc.projectedProfitCents)} · ${calc.projectedMarginPct.toFixed(1)}%`}
          accent={calc.projectedProfitCents >= 0 ? "good" : "bad"}
        />
      </div>
      {hasSupplement ? (
        <p className="mt-3 text-sm">
          <span className="font-semibold text-emerald-600">{formatScopeDollars(gain)}</span>{" "}
          <span className="text-muted-foreground">
            extra profit vs. not supplementing (net of the {overheadPct}% overhead and {paFeePct}% PA fee).
          </span>
        </p>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          No supplemented prices set yet — the figures above mirror the current scope. Add a supplement template or a
          per-line supplement price to project the extra recovery, net of the {overheadPct}% overhead and {paFeePct}% PA fee.
        </p>
      )}
    </div>
  );
}

function ScopeRow({
  leadId,
  line,
  costPerUnit,
  supplementPerUnit,
  canEdit,
  canSeeCosts,
  onDeleted,
}: {
  leadId: string;
  line: ScopeLineDTO;
  costPerUnit: number;
  supplementPerUnit: number;
  canEdit: boolean;
  canSeeCosts: boolean;
  onDeleted: () => void;
}) {
  const router = useRouter();
  // Catalog-linked lines take category/description/unit from the catalog (read-only).
  const fromCatalog = !!line.catalogItemId;

  async function save(patch: Record<string, unknown>) {
    const res = await updateScopeLineAction({ id: line.id, leadId, ...patch });
    if (!res.ok) toast.error(res.error);
    else router.refresh();
  }

  const rcv = Math.round(line.quantity * line.insuranceUnitPrice);
  const cost = Math.round(line.quantity * costPerUnit);
  // Supplemented line total = FULL supplemented price (or the allowed price if this
  // line isn't being supplemented).
  const isSupplemented = supplementPerUnit > 0;
  const supplemented = Math.round(line.quantity * (isSupplemented ? supplementPerUnit : line.insuranceUnitPrice));

  return (
    <tr className="align-middle">
      <td className="px-3 py-1.5">
        {fromCatalog ? (
          <span className="text-muted-foreground">{line.category}</span>
        ) : (
          <input defaultValue={line.category} disabled={!canEdit} onBlur={(e) => e.target.value !== line.category && save({ category: e.target.value })} className={cn(cell, "w-28")} />
        )}
      </td>
      <td className="px-3 py-1.5">
        {fromCatalog ? (
          line.description
        ) : (
          <input defaultValue={line.description} disabled={!canEdit} onBlur={(e) => e.target.value !== line.description && save({ description: e.target.value })} placeholder="Description" className={cn(cell, "min-w-[10rem]")} />
        )}
      </td>
      <td className="px-2 py-1 text-right">
        <input
          type="number"
          step="any"
          defaultValue={line.quantity || ""}
          disabled={!canEdit}
          onBlur={(e) => {
            const v = parseFloat(e.target.value);
            save({ quantity: Number.isFinite(v) ? v : 0 });
          }}
          className={cn(cell, "w-16 text-right")}
          placeholder="0"
        />
      </td>
      <td className="px-2 py-1">
        {fromCatalog ? (
          <span className="text-muted-foreground">{line.unit ?? "—"}</span>
        ) : (
          <>
            <input list="scope-units" defaultValue={line.unit ?? ""} disabled={!canEdit} onBlur={(e) => e.target.value !== (line.unit ?? "") && save({ unit: e.target.value })} className={cn(cell, "w-16")} placeholder="—" />
            <datalist id="scope-units">
              {SCOPE_UNITS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </>
        )}
      </td>
      <td className="px-2 py-1 text-right">
        <input
          type="number"
          step="0.01"
          defaultValue={line.insuranceUnitPrice ? line.insuranceUnitPrice / 100 : ""}
          disabled={!canEdit}
          onBlur={(e) => {
            const v = parseFloat(e.target.value);
            save({ insuranceUnitPriceCents: Number.isFinite(v) ? Math.round(v * 100) : 0 });
          }}
          className={cn(cell, "w-20 text-right")}
          placeholder="0.00"
        />
      </td>
      {canSeeCosts && (
        <td className="px-3 py-1.5 text-right tabular-nums">
          {fromCatalog ? (costPerUnit ? formatScopeDollars(costPerUnit) : <span className="text-muted-foreground">—</span>) : (
            <input
              type="number"
              step="0.01"
              defaultValue={line.costUnitPrice ? line.costUnitPrice / 100 : ""}
              disabled={!canEdit}
              onBlur={(e) => {
                const v = parseFloat(e.target.value);
                save({ costUnitPriceCents: Number.isFinite(v) ? Math.round(v * 100) : 0 });
              }}
              className={cn(cell, "w-20 text-right")}
              placeholder="0.00"
            />
          )}
        </td>
      )}
      <td className="px-3 py-1.5 text-right tabular-nums">{isSupplemented ? formatScopeDollars(supplementPerUnit) : <span className="text-muted-foreground">—</span>}</td>
      <td className="px-3 py-1.5 text-right font-medium tabular-nums">{formatScopeDollars(rcv)}</td>
      {canSeeCosts && <td className="px-3 py-1.5 text-right tabular-nums">{formatScopeDollars(cost)}</td>}
      <td className={cn("px-3 py-1.5 text-right tabular-nums", isSupplemented && "font-medium text-gold-muted")}>{formatScopeDollars(supplemented)}</td>
      {canEdit && (
        <td className="px-1 py-1 text-center">
          <button onClick={() => deleteScopeLineAction({ id: line.id, leadId }).then((r) => (r.ok ? onDeleted() : toast.error(r.error)))} className="text-muted-foreground hover:text-destructive" aria-label="Delete line">
            <Trash2 className="size-4" />
          </button>
        </td>
      )}
    </tr>
  );
}

function PdfUpload({ leadId, onDone }: { leadId: string; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const ref = React.useRef<HTMLInputElement>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    const fd = new FormData();
    fd.set("leadId", leadId);
    fd.set("file", file);
    const res = await uploadScopePdfAction(fd);
    setBusy(false);
    if (ref.current) ref.current.value = "";
    if (!res.ok) return toast.error(res.error);
    toast.success("Scope PDF uploaded.");
    onDone();
  }

  return (
    <>
      <input ref={ref} type="file" accept="application/pdf,image/*" className="hidden" onChange={onPick} />
      <Button size="sm" variant="outline" disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Upload PDF
      </Button>
    </>
  );
}
