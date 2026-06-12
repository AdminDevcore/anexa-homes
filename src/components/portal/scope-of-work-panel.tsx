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
  LayoutTemplate,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  rollup,
  lineInsuranceCents,
  lineCostCents,
  lineProfitCents,
  lineSupplementCents,
  formatScopeCents,
  SCOPE_UNITS,
} from "@/lib/scope";
import type { ScopeDTO, ScopeLineDTO } from "@/server/modules/scope/queries";
import {
  addScopeLineAction,
  updateScopeLineAction,
  deleteScopeLineAction,
  importFromClaimAction,
  loadScopeTemplateAction,
  uploadScopePdfAction,
  deleteScopePdfAction,
  updateScopePaFeePctAction,
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

export function ScopeOfWorkPanel({
  leadId,
  scope,
  canEdit,
  canSeeCosts,
  hasClaimLines,
  hasTemplate,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const lines = scope?.lines ?? [];

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(key);
    const res = await fn();
    setBusy(null);
    if (!res.ok) return toast.error(res.error ?? "Something went wrong.");
    router.refresh();
  }

  const paFeePct = scope?.paFeePct ?? 0;
  const totals = rollup(
    lines.map((l) => ({
      category: l.category,
      quantity: l.quantity,
      insuranceUnitPrice: l.insuranceUnitPrice,
      costUnitPrice: l.costUnitPrice ?? 0,
      supplementUnitPrice: l.supplementUnitPrice,
    })),
    paFeePct
  );

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
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === "pdf-del"}
                  onClick={() => run("pdf-del", () => deleteScopePdfAction(leadId))}
                >
                  {busy === "pdf-del" ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
                  Remove
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

      {/* Toolbar */}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy === "add"} onClick={() => run("add", () => addScopeLineAction({ leadId }))}>
            <Plus className="size-4" /> Add line
          </Button>
          {hasClaimLines && (
            <Button size="sm" variant="outline" disabled={busy === "import"} onClick={() => run("import", () => importFromClaimAction(leadId))}>
              <DownloadCloud className="size-4" /> Import from claim
            </Button>
          )}
          {canSeeCosts && hasTemplate && (
            <Button size="sm" variant="outline" disabled={busy === "tpl"} onClick={() => run("tpl", () => loadScopeTemplateAction(leadId))}>
              <LayoutTemplate className="size-4" /> Load template
            </Button>
          )}
        </div>
      )}

      {/* Spreadsheet */}
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 font-medium">Unit</th>
              <th className="px-3 py-2 text-right font-medium">Ins $/u</th>
              <th className="px-3 py-2 text-right font-medium">Suppl $/u</th>
              {canSeeCosts && <th className="px-3 py-2 text-right font-medium">Cost $/u</th>}
              <th className="px-3 py-2 text-right font-medium">Allowed</th>
              <th className="px-3 py-2 text-right font-medium">Supplemented</th>
              {canSeeCosts && <th className="px-3 py-2 text-right font-medium">Cost</th>}
              {canSeeCosts && <th className="px-3 py-2 text-right font-medium">Profit</th>}
              {canEdit && <th className="w-8 px-2 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {lines.length === 0 && (
              <tr>
                <td colSpan={canSeeCosts ? 12 : 9} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No line items yet. {canEdit && "Add a line, import from the claim, or load your template to start costing this job."}
                </td>
              </tr>
            )}
            {lines.map((line) => (
              <ScopeRow
                key={line.id}
                leadId={leadId}
                line={line}
                canEdit={canEdit}
                canSeeCosts={canSeeCosts}
                onDeleted={() => router.refresh()}
              />
            ))}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td className="px-3 py-3" colSpan={canSeeCosts ? 7 : 6}>
                  Totals
                </td>
                <td className="px-3 py-3 text-right">{formatScopeCents(totals.insuranceCents)}</td>
                <td className="px-3 py-3 text-right">{formatScopeCents(totals.supplementCents)}</td>
                {canSeeCosts && <td className="px-3 py-3 text-right">{formatScopeCents(totals.costCents)}</td>}
                {canSeeCosts && (
                  <td className={cn("px-3 py-3 text-right", totals.profitCents < 0 ? "text-destructive" : "text-emerald-600")}>
                    {formatScopeCents(totals.profitCents)}
                  </td>
                )}
                {canEdit && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Profit summary */}
      {canSeeCosts && lines.length > 0 && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Insurance allowed" value={formatScopeCents(totals.insuranceCents)} />
            <Stat label="Our cost" value={formatScopeCents(totals.costCents)} />
            <Stat
              label="Profit (no supplement)"
              value={`${formatScopeCents(totals.profitCents)} · ${totals.marginPct.toFixed(1)}%`}
              accent={totals.profitCents >= 0 ? "good" : "bad"}
            />
          </div>
          <SupplementSummary leadId={leadId} totals={totals} paFeePct={paFeePct} canEdit={canEdit} />
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: "good" | "bad" }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-0.5 text-base font-semibold tabular-nums",
          accent === "good" && "text-emerald-600",
          accent === "bad" && "text-destructive"
        )}
      >
        {value}
      </div>
    </div>
  );
}

/** "If we supplement with a public adjuster" scenario: supplemented revenue minus
 *  cost minus the PA's cut, and the net gain over not supplementing. */
function SupplementSummary({
  leadId,
  totals,
  paFeePct,
  canEdit,
}: {
  leadId: string;
  totals: ReturnType<typeof rollup>;
  paFeePct: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const supplemented = totals.supplementDeltaCents > 0;

  return (
    <div className="rounded-xl border border-gold/30 bg-gold/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-semibold text-gold-muted">Supplement scenario (public adjuster)</span>
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
              updateScopePaFeePctAction({ leadId, paFeePct: v }).then((r) =>
                r.ok ? router.refresh() : toast.error(r.error)
              );
            }}
            className="w-16 rounded-md border border-border bg-background px-2 py-1 text-right text-sm disabled:opacity-60"
          />
          %
        </label>
      </div>

      {supplemented ? (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <MiniStat label="Supplemented total" value={formatScopeCents(totals.supplementCents)} />
            <MiniStat label="Extra recovered" value={formatScopeCents(totals.supplementDeltaCents)} />
            <MiniStat label={`PA fee (${paFeePct}%)`} value={`-${formatScopeCents(totals.paFeeCents)}`} />
            <MiniStat
              label="Profit if supplemented"
              value={formatScopeCents(totals.supplementProfitCents)}
              accent={totals.supplementProfitCents >= 0 ? "good" : "bad"}
            />
          </div>
          <p className="mt-3 text-sm">
            <span className="font-semibold text-emerald-600">{formatScopeCents(totals.supplementGainCents)}</span>{" "}
            <span className="text-muted-foreground">
              extra profit vs. not supplementing (net of the {paFeePct}% PA fee).
            </span>
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Enter a “Suppl $/u” on any line to model the supplemented price and see the upside after the public
          adjuster’s cut.
        </p>
      )}
    </div>
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

function ScopeRow({
  leadId,
  line,
  canEdit,
  canSeeCosts,
  onDeleted,
}: {
  leadId: string;
  line: ScopeLineDTO;
  canEdit: boolean;
  canSeeCosts: boolean;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const calc = {
    quantity: line.quantity,
    insuranceUnitPrice: line.insuranceUnitPrice,
    costUnitPrice: line.costUnitPrice ?? 0,
    supplementUnitPrice: line.supplementUnitPrice,
  };

  async function save(patch: Record<string, unknown>) {
    const res = await updateScopeLineAction({ id: line.id, leadId, ...patch });
    if (!res.ok) toast.error(res.error);
    else router.refresh();
  }

  return (
    <tr className="align-middle">
      <td className="px-2 py-1">
        <input
          defaultValue={line.category}
          disabled={!canEdit}
          onBlur={(e) => e.target.value !== line.category && save({ category: e.target.value })}
          className={cn(cell, "w-28")}
        />
      </td>
      <td className="px-2 py-1">
        <input
          defaultValue={line.description}
          disabled={!canEdit}
          onBlur={(e) => e.target.value !== line.description && save({ description: e.target.value })}
          placeholder="Description"
          className={cn(cell, "min-w-[10rem]")}
        />
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
        <input
          list="scope-units"
          defaultValue={line.unit ?? ""}
          disabled={!canEdit}
          onBlur={(e) => e.target.value !== (line.unit ?? "") && save({ unit: e.target.value })}
          className={cn(cell, "w-16")}
          placeholder="—"
        />
        <datalist id="scope-units">
          {SCOPE_UNITS.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
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
      <td className="px-2 py-1 text-right">
        <input
          type="number"
          step="0.01"
          defaultValue={line.supplementUnitPrice ? line.supplementUnitPrice / 100 : ""}
          disabled={!canEdit}
          onBlur={(e) => {
            const v = parseFloat(e.target.value);
            save({ supplementUnitPriceCents: Number.isFinite(v) ? Math.round(v * 100) : 0 });
          }}
          className={cn(cell, "w-20 text-right")}
          placeholder="—"
          title="Supplemented price per unit (with a public adjuster). Leave blank if not supplementing this line."
        />
      </td>
      {canSeeCosts && (
        <td className="px-2 py-1 text-right">
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
        </td>
      )}
      <td className="px-3 py-1 text-right tabular-nums">{formatScopeCents(lineInsuranceCents(calc))}</td>
      <td
        className={cn(
          "px-3 py-1 text-right tabular-nums",
          lineSupplementCents(calc) > lineInsuranceCents(calc) ? "font-medium text-gold-muted" : "text-muted-foreground"
        )}
      >
        {formatScopeCents(lineSupplementCents(calc))}
      </td>
      {canSeeCosts && (
        <td className="px-3 py-1 text-right tabular-nums text-muted-foreground">{formatScopeCents(lineCostCents(calc))}</td>
      )}
      {canSeeCosts && (
        <td className={cn("px-3 py-1 text-right tabular-nums font-medium", lineProfitCents(calc) < 0 ? "text-destructive" : "text-emerald-600")}>
          {formatScopeCents(lineProfitCents(calc))}
        </td>
      )}
      {canEdit && (
        <td className="px-1 py-1 text-center">
          <button
            onClick={() => deleteScopeLineAction({ id: line.id, leadId }).then((r) => (r.ok ? onDeleted() : toast.error(r.error)))}
            className="text-muted-foreground hover:text-destructive"
            aria-label="Delete line"
          >
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
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        Upload PDF
      </Button>
    </>
  );
}
