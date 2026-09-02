"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Archive, RotateCcw, Pencil, BatteryCharging } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { formatFactor } from "@/lib/solar-loan";
import {
  lenderProductLabel,
  LENDER_PRODUCT_KINDS,
  PRODUCT_LABEL,
  type LenderProductKind,
} from "@/lib/solar-lender-product";
import {
  upsertSolarLenderProductAction,
  setSolarLenderProductActiveAction,
  deleteSolarLenderProductAction,
} from "@/server/modules/solar/lender-product-actions";
import type { LenderProduct, LenderRow } from "./types";
import { floatOrNull, intOrNull, str } from "./types";
import { Hint, NumField, Pill, TextField } from "./fields";

/**
 * What one lender will finance, and on what terms.
 *
 * Was a section of its own at the bottom of the page, repeated per lender —
 * so setting a partner up meant scrolling past everybody else's rate sheet to
 * find theirs. It is a tab on that partner now, which is where somebody
 * configuring them is already standing.
 */
export function RateSheetPanel({
  lender,
  canEdit,
  targetNetPpwCents,
}: {
  lender: LenderRow;
  canEdit: boolean;
  /** From Solar Settings. Null = the sticker is not derived from a dealer fee. */
  targetNetPpwCents: number | null;
}) {
  const router = useRouter();
  const [adding, setAdding] = React.useState<LenderProductKind | null>(null);
  const [editing, setEditing] = React.useState<string | null>(null);

  const live = lender.products.filter((p) => p.isActive);
  const retired = lender.products.filter((p) => !p.isActive);
  const done = () => {
    setAdding(null);
    setEditing(null);
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">Programmes</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          A rep picks one of these on a deal and the payment is quoted from it — the APR, term and
          dealer fee come from here, never from the deal screen.{" "}
          {targetNetPpwCents == null ? (
            <>
              No target net $/W is set, so the sticker price stays exactly as a rep types it. Set one
              in{" "}
              <Link href="/portal/settings/solar" className="underline underline-offset-2">
                Solar Settings
              </Link>{" "}
              and it is derived from each programme&rsquo;s dealer fee instead, so cheaper money
              raises the price rather than costing you margin.
            </>
          ) : (
            <>
              Target net{" "}
              <span className="font-medium text-foreground tabular-nums">
                ${(targetNetPpwCents / 100).toFixed(2)}/W
              </span>
              , so the sticker is derived from the chosen programme&rsquo;s dealer fee.
            </>
          )}
        </p>

        {canEdit && !adding && (
          <div className="mt-3 flex flex-wrap gap-2">
            {LENDER_PRODUCT_KINDS.map((k) => (
              <Button key={k} size="sm" variant="outline" onClick={() => setAdding(k)}>
                <Plus className="size-4" /> {PRODUCT_LABEL[k]}
              </Button>
            ))}
          </div>
        )}
      </div>

      {canEdit && adding && (
        <div className="rounded-xl border border-gold/40 bg-gold/[0.04] p-4">
          <h4 className="mb-3 text-sm font-semibold">New {PRODUCT_LABEL[adding].toLowerCase()}</h4>
          <ProductForm lenderId={lender.id} kind={adding} onDone={done} />
        </div>
      )}

      {live.length === 0 && !adding ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nothing on {lender.name}&rsquo;s rate sheet yet. A deal cannot be quoted on a partner with
          no programmes — add the loan, lease or PPA terms it publishes.
        </p>
      ) : (
        LENDER_PRODUCT_KINDS.map((kind) => {
          const rows = live.filter((p) => p.product === kind);
          if (rows.length === 0) return null;
          return (
            <div key={kind} className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {PRODUCT_LABEL[kind]}
              </div>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {rows.map((p) =>
                  editing === p.id ? (
                    <li key={p.id} className="bg-gold/[0.04] p-4">
                      <ProductForm lenderId={lender.id} kind={kind} existing={p} onDone={done} />
                    </li>
                  ) : (
                    <ProductRow key={p.id} product={p} canEdit={canEdit} onEdit={() => setEditing(p.id)} />
                  )
                )}
              </ul>
            </div>
          );
        })
      )}

      {retired.length > 0 && (
        <details className="rounded-xl border border-dashed border-border">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">
            {retired.length} retired
          </summary>
          <ul className="divide-y divide-border border-t border-border">
            {retired.map((p) =>
              editing === p.id ? (
                <li key={p.id} className="p-4">
                  <ProductForm
                    lenderId={lender.id}
                    kind={p.product as LenderProductKind}
                    existing={p}
                    onDone={done}
                  />
                </li>
              ) : (
                <ProductRow key={p.id} product={p} canEdit={canEdit} onEdit={() => setEditing(p.id)} />
              )
            )}
          </ul>
        </details>
      )}
    </div>
  );
}

function ProductRow({
  product,
  canEdit,
  onEdit,
}: {
  product: LenderProduct;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const act = async (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    // A refusal here explains a data consequence — "12 deals were quoted from
    // this" — so it gets long enough to read.
    if (!res.ok) return toast.error(res.error, { duration: 9000 });
    toast.success(res.message ?? "Updated");
    router.refresh();
  };

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
      <span className={cn("font-medium", !product.isActive && "text-muted-foreground line-through")}>
        {lenderProductLabel(product)}
      </span>
      {product.name && (
        <span className="text-xs text-muted-foreground">
          {lenderProductLabel({ ...product, name: null })}
        </span>
      )}
      {/* A factor-priced row prices differently from an amortised one, so the
          sheet has to show which this is at a glance. */}
      {product.factorWithPaydownMicros != null && (
        <span className="text-xs tabular-nums text-muted-foreground">
          factor {formatFactor(product.factorWithPaydownMicros)}
          {product.factorWithoutPaydownMicros != null &&
            ` / ${formatFactor(product.factorWithoutPaydownMicros)}`}
          {product.paydownPct != null && ` · ${product.paydownPct}% by mo ${product.paydownMonths}`}
        </span>
      )}
      {product.financesStorageOnly && (
        <Pill tone="solar">
          <BatteryCharging className="size-3" /> storage-only
        </Pill>
      )}
      {canEdit && (
        <div className="ml-auto flex items-center gap-0.5">
          <Button size="icon-sm" variant="ghost" onClick={onEdit} disabled={busy} title="Edit these terms">
            <Pencil className="size-3.5" />
            <span className="sr-only">Edit {lenderProductLabel(product)}</span>
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={busy}
            title={
              product.isActive
                ? "Retire — deals already quoted from it keep their terms"
                : "Offer it again"
            }
            onClick={() => act(() => setSolarLenderProductActiveAction(product.id, !product.isActive))}
          >
            {product.isActive ? <Archive className="size-3.5" /> : <RotateCcw className="size-3.5" />}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={busy}
            title="Delete — refused if any deal was quoted from it"
            onClick={() => act(() => deleteSolarLenderProductAction(product.id))}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * One product's terms.
 *
 * Which fields it asks for is decided by the kind, because a loan and a PPA
 * share nothing but a term. One form of every field would invite an APR onto a
 * PPA — the same defect the deal side already guards against, one level up.
 */
function ProductForm({
  lenderId,
  kind,
  existing,
  onDone,
}: {
  lenderId: string;
  kind: LenderProductKind;
  existing?: LenderProduct;
  onDone: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({
    name: existing?.name ?? "",
    aprPct: str(existing?.aprPct),
    termMonths: str(existing?.termMonths),
    dealerFeePct: str(existing?.dealerFeePct),
    leaseRate: str(existing?.leaseRateCentsPerKwMonth, 100),
    rate: str(existing?.rateMillsPerKwh, 1000),
    escalatorPct: str(existing?.escalatorPct),
    termYears: str(existing?.termYears),
    factorWithPaydown: formatFactor(existing?.factorWithPaydownMicros),
    factorWithoutPaydown: formatFactor(existing?.factorWithoutPaydownMicros),
    paydownPct: str(existing?.paydownPct),
    paydownMonths: str(existing?.paydownMonths),
  });
  const [financesStorageOnly, setFinancesStorageOnly] = React.useState(
    existing?.financesStorageOnly ?? false
  );
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setBusy(true);
    const res = await upsertSolarLenderProductAction(existing?.id ?? null, {
      lenderId,
      product: kind,
      name: form.name.trim() || null,
      aprPct: floatOrNull(form.aprPct),
      termMonths: intOrNull(form.termMonths),
      dealerFeePct: floatOrNull(form.dealerFeePct),
      leaseRateCentsPerKwMonth: intOrNull(form.leaseRate, 100),
      rateMillsPerKwh: intOrNull(form.rate, 1000),
      escalatorPct: floatOrNull(form.escalatorPct),
      termYears: intOrNull(form.termYears),
      factorWithPaydown: floatOrNull(form.factorWithPaydown),
      factorWithoutPaydown: floatOrNull(form.factorWithoutPaydown),
      paydownPct: floatOrNull(form.paydownPct),
      paydownMonths: intOrNull(form.paydownMonths),
      financesStorageOnly,
    });
    setBusy(false);
    // The action names the missing field, so the message is worth showing.
    if (!res.ok) return toast.error(res.error, { duration: 9000 });
    toast.success(existing ? "Product updated" : "Product added");
    onDone();
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kind === "loan" && (
          <>
            <NumField label="APR %" step="0.01" value={form.aprPct} onChange={(v) => set("aprPct", v)} />
            <NumField label="Term (months)" value={form.termMonths} onChange={(v) => set("termMonths", v)} />
            <NumField
              label="Dealer fee %"
              step="0.1"
              value={form.dealerFeePct}
              onChange={(v) => set("dealerFeePct", v)}
            />
          </>
        )}
        {kind === "lease" && (
          <NumField
            label="$/kW per month"
            step="0.01"
            value={form.leaseRate}
            onChange={(v) => set("leaseRate", v)}
          />
        )}
        {kind === "ppa" && (
          <NumField label="$/kWh" step="0.001" value={form.rate} onChange={(v) => set("rate", v)} />
        )}
        {kind !== "loan" && (
          <>
            <NumField
              label="Escalator %/yr"
              step="0.1"
              value={form.escalatorPct}
              onChange={(v) => set("escalatorPct", v)}
            />
            <NumField label="Term (years)" value={form.termYears} onChange={(v) => set("termYears", v)} />
          </>
        )}
        <TextField
          label="Name (optional)"
          value={form.name}
          placeholder="falls back to the terms"
          onChange={(v) => set("name", v)}
        />
      </div>

      {/* The sheet's own payment arithmetic. A factor is NOT the amortised
          figure — it bakes in the fee and the promotional structure — so where
          one exists it outranks anything derived from the APR. Leave these
          blank and the payment is amortised from APR and term as before. */}
      {kind === "loan" && (
        <div className="space-y-3 rounded-lg border border-border bg-background p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Payment factors (optional)
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <NumField
              label="PMT factor — with paydown"
              step="0.000001"
              value={form.factorWithPaydown}
              onChange={(v) => set("factorWithPaydown", v)}
            />
            <NumField
              label="PMT factor — without paydown"
              step="0.000001"
              value={form.factorWithoutPaydown}
              onChange={(v) => set("factorWithoutPaydown", v)}
            />
            <NumField
              label="Paydown %"
              step="0.01"
              value={form.paydownPct}
              onChange={(v) => set("paydownPct", v)}
            />
            <NumField
              label="Paydown due by month"
              value={form.paydownMonths}
              onChange={(v) => set("paydownMonths", v)}
            />
          </div>
          <Hint>
            Monthly payment = amount financed × factor, exactly as the rate sheet prints it. Both are
            shown on the deal, so a customer sees what the payment becomes if the paydown is never
            applied.
          </Hint>
        </div>
      )}

      {/* Storage-only eligibility. Off by default and per PRODUCT rather than
          per lender: a bank with one storage programme and three PV-only ones
          would otherwise read as funding batteries on all four, and the rep
          finds out at submission.

          Loans only. Cash has no lender paper to be eligible or not — a
          customer writing a cheque for a battery needs nobody's approval. */}
      {kind === "loan" && (
        <label className="flex items-start gap-2.5 rounded-lg border border-border bg-background p-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-gold"
            checked={financesStorageOnly}
            onChange={(e) => setFinancesStorageOnly(e.target.checked)}
          />
          <span>
            Funds storage-only deals
            <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
              Tick only if this paper funds a battery with no array on the roof. Storage deals are
              offered nothing else.
            </span>
          </span>
        </label>
      )}

      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {existing ? "Save product" : "Add product"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
