"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, TriangleAlert, CircleAlert, Sun, Info } from "lucide-react";
import type { FinanceProduct, MountType } from "@prisma/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ValidationIssue } from "@/lib/solar-validation";
import {
  saveSolarDesignAction,
  saveSolarFinanceAction,
  validateSolarDealAction,
} from "@/server/modules/solar/actions";

type EquipmentOption = { id: string; label: string; ratingW: number | null };

export type SolarDesignView = {
  utilityProvider: string | null;
  ratePlan: string | null;
  utilityAccountNo: string | null;
  meterNo: string | null;
  netMeteringProgram: string | null;
  annualUsageKwh: number | null;
  avgMonthlyBillCents: number | null;
  mountType: MountType;
  tsrfPct: number | null;
  moduleId: string | null;
  moduleQty: number;
  inverterId: string | null;
  batteryId: string | null;
  systemSizeKwDc: number;
  year1ProductionKwh: number;
  offsetPct: number;
} | null;

export type SolarFinanceView = {
  product: FinanceProduct;
  grossPpwCents: number;
  dealerFeePct: number;
  adderTotalCents: number;
  contractPriceCents: number;
  itcEstimateCents: number;
  rateMillsPerKwh: number | null;
  monthlyPaymentCents: number | null;
  escalatorPct: number | null;
  termYears: number | null;
} | null;

const PRODUCTS: { value: FinanceProduct; label: string; blurb: string }[] = [
  { value: "cash", label: "Cash", blurb: "Priced per watt. No lender, so no dealer fee." },
  { value: "loan", label: "Loan", blurb: "Priced per watt. The dealer fee is embedded in the gross price." },
  { value: "lease", label: "Lease", blurb: "Fixed monthly payment with an annual escalator. No system price." },
  { value: "ppa", label: "PPA", blurb: "Priced per kWh produced, with an annual escalator. No system price." },
];

function money(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/** Module scope on purpose — react-hooks/static-components is an error here. */
function TextField({
  label, value, onChange, disabled, type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  type?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type={type} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** Blocking issues stop generation; warnings must be seen but can be accepted. */
export function ValidationList({ issues }: { issues: ValidationIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {issues.map((i, n) => (
        <li
          key={`${i.field}-${n}`}
          className={cn(
            "flex items-start gap-2 rounded-lg border p-2.5 text-xs",
            i.severity === "block"
              ? "border-red-200 bg-red-50 text-red-900"
              : "border-amber-200 bg-amber-50 text-amber-900"
          )}
        >
          {i.severity === "block" ? (
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          ) : (
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          )}
          <span>{i.message}</span>
        </li>
      ))}
    </ul>
  );
}

export function SolarDesignPanel({
  leadId,
  design,
  modules,
  inverters,
  batteries,
  canEdit,
}: {
  leadId: string;
  design: SolarDesignView;
  modules: EquipmentOption[];
  inverters: EquipmentOption[];
  batteries: EquipmentOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({
    utilityProvider: design?.utilityProvider ?? "",
    ratePlan: design?.ratePlan ?? "",
    utilityAccountNo: design?.utilityAccountNo ?? "",
    meterNo: design?.meterNo ?? "",
    netMeteringProgram: design?.netMeteringProgram ?? "",
    annualUsageKwh: design?.annualUsageKwh?.toString() ?? "",
    avgMonthlyBill: design?.avgMonthlyBillCents ? (design.avgMonthlyBillCents / 100).toString() : "",
    mountType: (design?.mountType ?? "roof") as MountType,
    tsrfPct: design?.tsrfPct?.toString() ?? "",
    moduleId: design?.moduleId ?? "",
    moduleQty: design?.moduleQty?.toString() ?? "0",
    inverterId: design?.inverterId ?? "",
    batteryId: design?.batteryId ?? "",
  });

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setBusy(true);
    const res = await saveSolarDesignAction({
      leadId,
      utilityProvider: form.utilityProvider || null,
      ratePlan: form.ratePlan || null,
      utilityAccountNo: form.utilityAccountNo || null,
      meterNo: form.meterNo || null,
      netMeteringProgram: form.netMeteringProgram || null,
      annualUsageKwh: form.annualUsageKwh ? Number(form.annualUsageKwh) : null,
      avgMonthlyBillCents: form.avgMonthlyBill ? Math.round(Number(form.avgMonthlyBill) * 100) : null,
      mountType: form.mountType,
      tsrfPct: form.tsrfPct ? Number(form.tsrfPct) : null,
      moduleId: form.moduleId || null,
      moduleQty: Number(form.moduleQty) || 0,
      inverterId: form.inverterId || null,
      batteryId: form.batteryId || null,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Design saved");
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Utility &amp; usage
        </h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Utility provider" value={form.utilityProvider} disabled={!canEdit} onChange={(v) => set("utilityProvider", v)} />
          <TextField label="Rate plan / tariff" value={form.ratePlan} disabled={!canEdit} onChange={(v) => set("ratePlan", v)} />
          <TextField label="Utility account #" value={form.utilityAccountNo} disabled={!canEdit} onChange={(v) => set("utilityAccountNo", v)} />
          <TextField label="Meter #" value={form.meterNo} disabled={!canEdit} onChange={(v) => set("meterNo", v)} />
          <TextField label="Net metering programme" value={form.netMeteringProgram} disabled={!canEdit} onChange={(v) => set("netMeteringProgram", v)} />
          <TextField label="Annual usage (kWh)" value={form.annualUsageKwh} disabled={!canEdit} onChange={(v) => set("annualUsageKwh", v)} type="number" />
          <TextField label="Average monthly bill ($)" value={form.avgMonthlyBill} disabled={!canEdit} onChange={(v) => set("avgMonthlyBill", v)} type="number" />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Annual usage is the anchor for offset. Without it the offset figure is meaningless — that
          is how proposals end up quoting five-figure percentages.
        </p>
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Site
        </h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Mount type</Label>
            <select
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={form.mountType}
              disabled={!canEdit}
              onChange={(e) => set("mountType", e.target.value)}
            >
              <option value="roof">Roof</option>
              <option value="ground">Ground</option>
            </select>
          </div>
          <TextField label="TSRF %" value={form.tsrfPct} disabled={!canEdit} onChange={(v) => set("tsrfPct", v)} type="number" />
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          System
        </h4>
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            ["Module", "moduleId", modules],
            ["Inverter", "inverterId", inverters],
            ["Battery", "batteryId", batteries],
          ] as const).map(([label, key, options]) => (
            <div key={key} className="space-y-1">
              <Label className="text-xs">{label}</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={form[key] as string}
                disabled={!canEdit}
                onChange={(e) => set(key, e.target.value)}
              >
                <option value="">— none —</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>
          ))}
          <TextField label="Module quantity" value={form.moduleQty} disabled={!canEdit} onChange={(v) => set("moduleQty", v)} type="number" />
        </div>

        {/* Computed server-side from module count × rating and the company's
            assumptions — never typed in, so it cannot be faked. */}
        <div className="grid grid-cols-3 gap-3 rounded-lg border border-border bg-muted/30 p-3 text-center">
          <div>
            <div className="font-display text-lg font-semibold">{design?.systemSizeKwDc?.toFixed(2) ?? "0.00"}</div>
            <div className="text-[11px] text-muted-foreground">kW-DC</div>
          </div>
          <div>
            <div className="font-display text-lg font-semibold">
              {(design?.year1ProductionKwh ?? 0).toLocaleString()}
            </div>
            <div className="text-[11px] text-muted-foreground">yr-1 kWh</div>
          </div>
          <div>
            <div className="font-display text-lg font-semibold">{(design?.offsetPct ?? 0).toFixed(0)}%</div>
            <div className="text-[11px] text-muted-foreground">offset</div>
          </div>
        </div>
      </section>

      {canEdit && (
        <Button onClick={save} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />} Save design
        </Button>
      )}
    </div>
  );
}

export function SolarFinancePanel({
  leadId,
  finance,
  itcDisclaimer,
  federalItcPct,
  canEdit,
}: {
  leadId: string;
  finance: SolarFinanceView;
  itcDisclaimer: string;
  federalItcPct: number | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [product, setProduct] = React.useState<FinanceProduct>(finance?.product ?? "cash");
  const [form, setForm] = React.useState({
    grossPpw: finance?.grossPpwCents ? (finance.grossPpwCents / 100).toFixed(2) : "",
    dealerFeePct: finance?.dealerFeePct?.toString() ?? "",
    adderTotal: finance?.adderTotalCents ? (finance.adderTotalCents / 100).toString() : "",
    rate: finance?.rateMillsPerKwh ? (finance.rateMillsPerKwh / 1000).toFixed(3) : "",
    monthly: finance?.monthlyPaymentCents ? (finance.monthlyPaymentCents / 100).toString() : "",
    escalatorPct: finance?.escalatorPct?.toString() ?? "",
    termYears: finance?.termYears?.toString() ?? "",
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const isPurchase = product === "cash" || product === "loan";

  async function save() {
    setBusy(true);
    const res = await saveSolarFinanceAction({
      leadId,
      product,
      grossPpwCents: form.grossPpw ? Math.round(Number(form.grossPpw) * 100) : undefined,
      dealerFeePct: form.dealerFeePct ? Number(form.dealerFeePct) : undefined,
      adderTotalCents: form.adderTotal ? Math.round(Number(form.adderTotal) * 100) : undefined,
      rateMillsPerKwh: form.rate ? Math.round(Number(form.rate) * 1000) : null,
      monthlyPaymentCents: form.monthly ? Math.round(Number(form.monthly) * 100) : null,
      escalatorPct: form.escalatorPct ? Number(form.escalatorPct) : null,
      termYears: form.termYears ? Number(form.termYears) : null,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Financing saved");
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-2 sm:grid-cols-2">
        {PRODUCTS.map((p) => (
          <button
            key={p.value}
            disabled={!canEdit}
            onClick={() => setProduct(p.value)}
            className={cn(
              "rounded-lg border p-3 text-left transition-colors disabled:opacity-60",
              product === p.value ? "border-foreground bg-muted" : "border-border hover:bg-muted/50"
            )}
          >
            <div className="text-sm font-semibold">{p.label}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{p.blurb}</div>
          </button>
        ))}
      </div>

      {/* The two product families take completely different inputs. Showing the
          wrong ones is how a PPA ends up quoted with a dealer fee. */}
      {isPurchase ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-xs">Gross $/W</Label>
            <Input type="number" step="0.01" value={form.grossPpw} disabled={!canEdit} onChange={(e) => set("grossPpw", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Dealer fee %</Label>
            <Input
              type="number"
              value={product === "cash" ? "" : form.dealerFeePct}
              disabled={!canEdit || product === "cash"}
              placeholder={product === "cash" ? "n/a — no lender" : ""}
              onChange={(e) => set("dealerFeePct", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Adders $</Label>
            <Input type="number" value={form.adderTotal} disabled={!canEdit} onChange={(e) => set("adderTotal", e.target.value)} />
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-4">
          {product === "ppa" && (
            <div className="space-y-1">
              <Label className="text-xs">$/kWh</Label>
              <Input type="number" step="0.001" value={form.rate} disabled={!canEdit} onChange={(e) => set("rate", e.target.value)} />
            </div>
          )}
          {product === "lease" && (
            <div className="space-y-1">
              <Label className="text-xs">Monthly $</Label>
              <Input type="number" value={form.monthly} disabled={!canEdit} onChange={(e) => set("monthly", e.target.value)} />
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Escalator %/yr</Label>
            <Input type="number" step="0.1" value={form.escalatorPct} disabled={!canEdit} onChange={(e) => set("escalatorPct", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Term (years)</Label>
            <Input type="number" value={form.termYears} disabled={!canEdit} onChange={(e) => set("termYears", e.target.value)} />
          </div>
        </div>
      )}

      {isPurchase && finance && (
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Contract price</span>
            <span className="font-display text-lg font-semibold">{money(finance.contractPriceCents)}</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Estimated federal credit{federalItcPct ? ` (${federalItcPct}%)` : ""}
            </span>
            <span className="tabular-nums">
              {federalItcPct ? money(finance.itcEstimateCents) : "not configured"}
            </span>
          </div>
          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <Info className="mt-0.5 size-3 shrink-0" />
            {itcDisclaimer}
          </p>
        </div>
      )}

      {canEdit && (
        <Button onClick={save} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />} Save financing
        </Button>
      )}
    </div>
  );
}

/**
 * The gate between a design and a customer-facing proposal.
 *
 * Phase 5 builds the proposal itself; what matters here is that generation is
 * already blocked on the validation rules, so the builder inherits the guard
 * rails rather than bolting them on afterwards.
 */
export function SolarProposalGate({ leadId }: { leadId: string }) {
  const [issues, setIssues] = React.useState<ValidationIssue[] | null>(null);
  const [canGen, setCanGen] = React.useState<boolean | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function check() {
    setBusy(true);
    const res = await validateSolarDealAction(leadId);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    setIssues(res.issues);
    setCanGen(res.canGenerate);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={check} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Sun className="size-4" />}
          Check proposal readiness
        </Button>
        {canGen === true && <span className="text-xs text-emerald-600">Ready to generate</span>}
        {canGen === false && <span className="text-xs text-red-600">Blocked — fix the issues below</span>}
      </div>
      {issues && <ValidationList issues={issues} />}
      {issues && issues.length === 0 && (
        <p className="text-xs text-muted-foreground">No issues found.</p>
      )}
      <p className="text-[11px] text-muted-foreground">
        The customer-facing proposal builder lands in the next phase. Generation will be gated on
        exactly these checks.
      </p>
    </div>
  );
}
