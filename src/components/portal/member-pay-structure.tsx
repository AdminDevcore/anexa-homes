"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Percent, Zap, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { VERTICAL_ACCENT, type ActiveVertical } from "@/lib/vertical";
import { pricePurchase, grossPpwFromNet } from "@/lib/solar-money";
import { solarRepPayCents, centsPerWattLabel, millsPerWattLabel } from "@/lib/solar-pay";
import { updateMemberPayAction } from "@/server/modules/team/actions";

/**
 * One member's pay terms, both verticals, side by side.
 *
 * Moved out of the "Manage member" rail because it does not belong there: role,
 * status and workspace access are access-control decisions, pay is a contract,
 * and stacking a third box of commission inputs into a 320px column produced a
 * form nobody could read at a glance. This is also the only place the two models
 * can be seen next to each other, which is the point — they are genuinely
 * different, and a rep who works both sides is paid two different ways.
 *
 * Panels render only for verticals the member is actually granted, and the card
 * is read UNFILTERED by the active workspace: an admin standing in Solar still
 * needs to see this person's roofing terms.
 */

export type MemberPay = {
  commissionSplitPct: number | null;
  providedLeadType: string;
  providedLeadSplitPct: number | null;
  providedLeadFlatCents: number | null;
  deductiblePct: number | null;
  solarRedlineCentsPerWatt: number | null;
  solarPerWattMills: number | null;
  solarRedlinePerBatteryCents: number | null;
  solarPerBatteryFlatCents: number | null;
  /** Which of the two per-battery rates this rep is actually paid on. */
  solarBatteryPayPlan: "margin" | "flat" | null;
  /** Which company-lead adjustment applies. Never inferred from the amounts. */
  solarLeadAdjustMode: "none" | "percentage" | "flat";
  solarCompanyLeadTakePct: number | null;
  solarCompanyLeadFlatCents: number | null;
};

/** The illustrative deal the solar worked example prices. */
const EXAMPLE_KW = 10;

/**
 * And the illustrative BATTERY-ONLY job beside it.
 *
 * Stated rather than derived, unlike the array above: a battery's price comes
 * off the equipment catalogue per deal, so there is no company-wide default
 * this could be priced from. Both figures are named in the heading of the
 * example, so nothing about it is implied.
 */
const EXAMPLE_BATTERIES = 2;
const EXAMPLE_BATTERY_BASE_CENTS = 23_000_00;

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** "" for null, so an empty box means "not set" rather than zero. */
const str = (n: number | null) => (n == null ? "" : String(n));
/** A number field back to a number, or null when the box is empty. */
const num = (v: string): number | null => {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

function PanelHeader({ vertical, label, icon: Icon }: { vertical: ActiveVertical; label: string; icon: typeof Percent }) {
  return (
    <div className="flex items-center gap-2 border-b border-border/70 pb-2">
      <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: VERTICAL_ACCENT[vertical] }} />
      <Icon className="size-4 text-muted-foreground" />
      <h4 className="text-sm font-semibold">{label}</h4>
    </div>
  );
}

function Field({
  label,
  hint,
  suffix,
  prefix,
  ...input
}: {
  label: string;
  hint?: string;
  suffix?: string;
  prefix?: string;
} & React.ComponentProps<typeof Input>) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-1.5">
        {prefix && <span className="text-sm text-muted-foreground">{prefix}</span>}
        <Input type="number" inputMode="decimal" {...input} />
        {suffix && <span className="shrink-0 text-sm text-muted-foreground">{suffix}</span>}
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function MemberPayStructure({
  userId,
  roleLabel,
  isRep,
  verticals,
  current,
  canEdit,
  solarExample,
  perWattLenders,
}: {
  userId: string;
  roleLabel: string;
  /** Copy says "rep" or "manager" — the same terms, a different word. */
  isRep: boolean;
  verticals: ActiveVertical[];
  current: MemberPay;
  canEdit: boolean;
  /** The company's own pricing defaults, so the example is this company's deal. */
  solarExample: { basePpwCents: number; dealerFeePct: number };
  /** Lenders currently on fixed pay, so "$0.40/W" is not an unexplained number. */
  perWattLenders: string[];
}) {
  const router = useRouter();
  const showRoofing = verticals.includes("roofing");
  const showSolar = verticals.includes("solar");

  const [split, setSplit] = React.useState(str(current.commissionSplitPct));
  const [providedType, setProvidedType] = React.useState(current.providedLeadType || "percentage");
  const [providedSplit, setProvidedSplit] = React.useState(str(current.providedLeadSplitPct));
  const [providedFlat, setProvidedFlat] = React.useState(
    current.providedLeadFlatCents == null ? "" : String(current.providedLeadFlatCents / 100)
  );
  const [deductible, setDeductible] = React.useState(str(current.deductiblePct));
  // Both solar rates are typed in DOLLARS per watt and stored in smaller units —
  // cents for the redline, mills for the rate. Nobody types "$2.00/W" as 200.
  const [redline, setRedline] = React.useState(
    current.solarRedlineCentsPerWatt == null ? "" : (current.solarRedlineCentsPerWatt / 100).toFixed(2)
  );
  const [perWatt, setPerWatt] = React.useState(
    current.solarPerWattMills == null ? "" : (current.solarPerWattMills / 1000).toFixed(2)
  );
  // The per-battery pair. Whole dollars — a battery is a five-figure unit and
  // nobody sets a redline on it to the cent.
  const [battRedline, setBattRedline] = React.useState(
    current.solarRedlinePerBatteryCents == null ? "" : String(current.solarRedlinePerBatteryCents / 100)
  );
  const [battFlat, setBattFlat] = React.useState(
    current.solarPerBatteryFlatCents == null ? "" : String(current.solarPerBatteryFlatCents / 100)
  );
  // Which battery rate this rep is on. "" = no plan, which is not the same as
  // either plan set to zero: it writes no commission line at all.
  const [battPlan, setBattPlan] = React.useState<"" | "margin" | "flat">(
    current.solarBatteryPayPlan ?? ""
  );
  // The company-lead adjustment. The mode leads; only its own amount is read.
  const [leadMode, setLeadMode] = React.useState<"none" | "percentage" | "flat">(
    current.solarLeadAdjustMode
  );
  const [leadPct, setLeadPct] = React.useState(str(current.solarCompanyLeadTakePct));
  const [leadFlat, setLeadFlat] = React.useState(
    current.solarCompanyLeadFlatCents == null ? "" : String(current.solarCompanyLeadFlatCents / 100)
  );
  const [busy, setBusy] = React.useState(false);

  const dirty =
    split !== str(current.commissionSplitPct) ||
    providedType !== (current.providedLeadType || "percentage") ||
    providedSplit !== str(current.providedLeadSplitPct) ||
    providedFlat !== (current.providedLeadFlatCents == null ? "" : String(current.providedLeadFlatCents / 100)) ||
    deductible !== str(current.deductiblePct) ||
    redline !== (current.solarRedlineCentsPerWatt == null ? "" : (current.solarRedlineCentsPerWatt / 100).toFixed(2)) ||
    perWatt !== (current.solarPerWattMills == null ? "" : (current.solarPerWattMills / 1000).toFixed(2)) ||
    battRedline !== (current.solarRedlinePerBatteryCents == null ? "" : String(current.solarRedlinePerBatteryCents / 100)) ||
    battFlat !== (current.solarPerBatteryFlatCents == null ? "" : String(current.solarPerBatteryFlatCents / 100)) ||
    battPlan !== (current.solarBatteryPayPlan ?? "") ||
    leadMode !== current.solarLeadAdjustMode ||
    leadPct !== str(current.solarCompanyLeadTakePct) ||
    leadFlat !== (current.solarCompanyLeadFlatCents == null ? "" : String(current.solarCompanyLeadFlatCents / 100));

  // ── The worked example ──────────────────────────────────────────────────
  // Recomputed from the SAME functions the commission engine calls, so a number
  // shown here cannot drift from the one that eventually gets paid.
  const redlineCents = redline.trim() === "" ? null : Math.round((Number(redline) || 0) * 100);
  const perWattMills = perWatt.trim() === "" ? null : Math.round((Number(perWatt) || 0) * 1000);
  const battRedlineCents = battRedline.trim() === "" ? null : Math.round((Number(battRedline) || 0) * 100);
  const battFlatCents = battFlat.trim() === "" ? null : Math.round((Number(battFlat) || 0) * 100);

  /**
   * The company default is a BASE — what the company keeps per watt before the
   * lender's cut — so the deal describing it stickers ABOVE it. Converted once,
   * here, and used both to price the example and to headline it, so the
   * sentence and the figures underneath it cannot disagree.
   */
  const exampleStickerPpwCents =
    grossPpwFromNet(solarExample.basePpwCents, solarExample.dealerFeePct) ??
    solarExample.basePpwCents;

  const example = React.useMemo(() => {
    const priced = pricePurchase({
      product: "loan",
      systemSizeKwDc: EXAMPLE_KW,
      stickerPpwCents: exampleStickerPpwCents,
      dealerFeePct: solarExample.dealerFeePct,
      adderTotalCents: 0,
    });
    const deal = { systemWatts: priced.systemWatts, baseKeptCents: priced.baseKeptCents };
    // The storage job the two per-battery bases are shown against. No watts, by
    // definition — which is the whole reason those bases exist.
    const storage = {
      systemWatts: 0,
      baseKeptCents: EXAMPLE_BATTERY_BASE_CENTS,
      batteryQty: EXAMPLE_BATTERIES,
    };
    return {
      watts: priced.systemWatts,
      basePpwCents: Math.round(priced.basePpwCents),
      redlinePay:
        redlineCents == null
          ? null
          : solarRepPayCents(
              { basis: "redline", redlineCentsPerWatt: redlineCents, millsPerWatt: null, redlinePerBatteryCents: null, perBatteryFlatCents: null },
              deal
            ),
      perWattPay:
        perWattMills == null
          ? null
          : solarRepPayCents(
              { basis: "per_watt", redlineCentsPerWatt: null, millsPerWatt: perWattMills, redlinePerBatteryCents: null, perBatteryFlatCents: null },
              deal
            ),
      battRedlinePay:
        battRedlineCents == null
          ? null
          : solarRepPayCents(
              { basis: "battery_redline", redlineCentsPerWatt: null, millsPerWatt: null, redlinePerBatteryCents: battRedlineCents, perBatteryFlatCents: null },
              storage
            ),
      battFlatPay:
        battFlatCents == null
          ? null
          : solarRepPayCents(
              { basis: "battery_flat", redlineCentsPerWatt: null, millsPerWatt: null, redlinePerBatteryCents: null, perBatteryFlatCents: battFlatCents },
              storage
            ),
    };
  }, [redlineCents, perWattMills, battRedlineCents, battFlatCents, exampleStickerPpwCents, solarExample.dealerFeePct]);

  const who = isRep ? "rep" : "manager";

  async function save() {
    const pct = (v: string, name: string) => {
      const n = num(v);
      if (n !== null && !(n >= 0 && n <= 100)) {
        toast.error(`${name} must be 0–100.`);
        return undefined;
      }
      return n;
    };

    const payload: Parameters<typeof updateMemberPayAction>[0] = { userId };

    if (showRoofing) {
      const s = pct(split, "Self-gen split");
      if (s === undefined) return;
      const ps = pct(providedSplit, "Provided-lead split");
      if (ps === undefined) return;
      const d = pct(deductible, "Deductible %");
      if (d === undefined) return;
      const flat = num(providedFlat);
      if (flat !== null && flat < 0) return toast.error("Lead fee must be a positive amount.");
      payload.commissionSplitPct = s;
      payload.providedLeadType = providedType === "flat" ? "flat" : "percentage";
      payload.providedLeadSplitPct = ps;
      payload.providedLeadFlatCents = flat === null ? null : Math.round(flat * 100);
      payload.deductiblePct = d;
    }

    if (showSolar) {
      const r = num(redline);
      if (r !== null && !(r >= 0 && r <= 20)) return toast.error("Redline must be between $0 and $20 per watt.");
      const w = num(perWatt);
      if (w !== null && !(w >= 0 && w <= 20)) return toast.error("Fixed rate must be between $0 and $20 per watt.");
      const br = num(battRedline);
      if (br !== null && !(br >= 0 && br <= 100_000))
        return toast.error("Per-battery redline must be between $0 and $100,000.");
      const bf = num(battFlat);
      if (bf !== null && !(bf >= 0 && bf <= 100_000))
        return toast.error("Flat per-battery rate must be between $0 and $100,000.");
      payload.solarRedlineCentsPerWatt = r === null ? null : Math.round(r * 100);
      payload.solarPerWattMills = w === null ? null : Math.round(w * 1000);
      payload.solarRedlinePerBatteryCents = br === null ? null : Math.round(br * 100);
      payload.solarPerBatteryFlatCents = bf === null ? null : Math.round(bf * 100);
      payload.solarBatteryPayPlan = battPlan === "" ? null : battPlan;
      // A plan pointing at a blank rate pays nothing while looking configured,
      // which is worse than no plan at all — that at least refuses out loud.
      if (battPlan === "margin" && br === null) {
        return toast.error("Set a per-battery redline, or leave the battery plan unset.");
      }
      if (battPlan === "flat" && bf === null) {
        return toast.error("Set a flat per-battery rate, or leave the battery plan unset.");
      }

      const lp = pct(leadPct, "Company take");
      if (lp === undefined) return;
      const lf = num(leadFlat);
      if (lf !== null && lf < 0) return toast.error("Company deduction must be a positive amount.");
      if (leadMode === "percentage" && lp === null) {
        return toast.error("Enter the company's percentage, or set the lead adjustment to None.");
      }
      if (leadMode === "flat" && lf === null) {
        return toast.error("Enter the company's flat deduction, or set the lead adjustment to None.");
      }
      payload.solarLeadAdjustMode = leadMode;
      // Only the amount this mode reads is sent. The action clears the other.
      payload.solarCompanyLeadTakePct = leadMode === "percentage" ? lp : null;
      payload.solarCompanyLeadFlatCents =
        leadMode === "flat" && lf !== null ? Math.round(lf * 100) : null;
    }

    setBusy(true);
    try {
      const res = await updateMemberPayAction(payload);
      if (!res.ok) return toast.error(res.error);
      toast.success("Pay structure saved");
      router.refresh();
    } finally {
      // In a finally, so a thrown action cannot latch the form into a state
      // where every input is disabled and nothing explains why.
      setBusy(false);
    }
  }

  if (!showRoofing && !showSolar) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-lg font-semibold">Pay structure</h3>
          <p className="text-xs text-muted-foreground">
            What this {who} earns on a deal.
            {showRoofing && showSolar
              ? " Roofing and Solar pay on different models, so a person who works both sides carries both sets of terms."
              : ` They only have ${showSolar ? "Solar" : "Roofing"} access — grant the other workspace to set its terms.`}
          </p>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
          {roleLabel}
        </span>
      </div>

      <div className={`mt-4 grid gap-4 ${showRoofing && showSolar ? "lg:grid-cols-2" : ""}`}>
        {/* ── Roofing: a share of the profit pool ───────────────────────── */}
        {showRoofing && (
          <div className="space-y-3 rounded-lg border border-border/70 p-4">
            <PanelHeader vertical="roofing" label="Roofing" icon={Percent} />
            <p className="text-[11px] text-muted-foreground">
              A share of the deal&rsquo;s profit pool — contract plus supplement, less job costs,
              overhead and any PA fee.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Self-gen lead"
                suffix="%"
                value={split}
                onChange={(e) => setSplit(e.target.value)}
                placeholder="50"
                disabled={!canEdit}
              />
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Company-provided lead</Label>
                <div className="flex gap-1">
                  <Select value={providedType} onValueChange={setProvidedType} disabled={!canEdit}>
                    <SelectTrigger className="w-[72px] shrink-0 px-2"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percentage">%</SelectItem>
                      <SelectItem value="flat">Flat $</SelectItem>
                    </SelectContent>
                  </Select>
                  {providedType === "flat" ? (
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={providedFlat}
                      onChange={(e) => setProvidedFlat(e.target.value)}
                      placeholder="$ 250"
                      disabled={!canEdit}
                    />
                  ) : (
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={providedSplit}
                      onChange={(e) => setProvidedSplit(e.target.value)}
                      placeholder="35"
                      disabled={!canEdit}
                    />
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Either a lower split <strong>or</strong> a flat lead fee off their self-gen commission.
                </p>
              </div>
            </div>
            <Field
              label={`Deductible the ${who} gets`}
              suffix="% of the customer-paid deductible"
              value={deductible}
              onChange={(e) => setDeductible(e.target.value)}
              placeholder="10"
              disabled={!canEdit}
              hint="Paid as its own line on each deal. Blank if they don't get it."
            />
          </div>
        )}

        {/* ── Solar: a redline, or a flat rate per watt ─────────────────── */}
        {showSolar && (
          <div className="space-y-3 rounded-lg border border-border/70 p-4">
            <PanelHeader vertical="solar" label="Solar" icon={Zap} />
            <p className="text-[11px] text-muted-foreground">
              No profit pool. A solar deal pays one of two ways, and{" "}
              <Link href="/portal/settings/solar-lenders" className="underline underline-offset-2">
                the lender
              </Link>{" "}
              decides which.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Redline"
                prefix="$"
                suffix="/W"
                step="0.01"
                value={redline}
                onChange={(e) => setRedline(e.target.value)}
                placeholder="2.00"
                disabled={!canEdit}
                hint="Net of the lender's fee. They keep every cent above it."
              />
              <Field
                label="Fixed-pay rate"
                prefix="$"
                suffix="/W"
                step="0.01"
                value={perWatt}
                onChange={(e) => setPerWatt(e.target.value)}
                placeholder="0.40"
                disabled={!canEdit}
                hint={
                  perWattLenders.length
                    ? `Used on ${perWattLenders.join(", ")}, and on every lease/PPA.`
                    : "Used on any lender set to fixed pay, and on every lease/PPA."
                }
              />
            </div>

            {/* ── WHAT THE COMPANY KEEPS ON ITS OWN LEAD ──────────────────
                One method or none. The picker is the rule: choosing a mode is
                what decides which box below is read, and the action clears the
                other on save so a row can never hold two live figures. */}
            <div className="space-y-3 border-t border-border/70 pt-3">
              <p className="text-[11px] font-medium text-foreground">Company-provided leads</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Adjustment</Label>
                  <Select
                    value={leadMode}
                    onValueChange={(v) => setLeadMode(v as "none" | "percentage" | "flat")}
                    disabled={!canEdit}
                  >
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None — {who} keeps it all</SelectItem>
                      <SelectItem value="percentage">Company takes a %</SelectItem>
                      <SelectItem value="flat">Company deducts a flat $</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Applies only to deals marked company-provided. A self-generated deal is never
                    adjusted.
                  </p>
                </div>
                {leadMode === "percentage" && (
                  <Field
                    label="Company take"
                    suffix="%"
                    step="1"
                    value={leadPct}
                    onChange={(e) => setLeadPct(e.target.value)}
                    placeholder="40"
                    disabled={!canEdit}
                    hint={
                      leadPct.trim() === ""
                        ? "Percentage of this person's commission the company keeps."
                        : `On a ${money(10_000_00)} commission the ${who} nets ${money(Math.round(10_000_00 * (1 - Math.min(100, Math.max(0, Number(leadPct) || 0)) / 100)))}.`
                    }
                  />
                )}
                {leadMode === "flat" && (
                  <Field
                    label="Company deduction"
                    prefix="$"
                    step="100"
                    value={leadFlat}
                    onChange={(e) => setLeadFlat(e.target.value)}
                    placeholder="1,500"
                    disabled={!canEdit}
                    hint={
                      leadFlat.trim() === ""
                        ? "A fixed amount off this person's commission, per deal."
                        : `On a ${money(10_000_00)} commission the ${who} nets ${money(Math.max(0, 10_000_00 - Math.round((Number(leadFlat) || 0) * 100)))}.`
                    }
                  />
                )}
              </div>
            </div>

            {/* BOTH rates above are per WATT, and a battery-only job has none.
                These are the pair that reaches one.

                WHICH OF THE TWO APPLIES IS THIS PERSON'S PLAN, not the lender's.
                It used to be read off the lender, so two reps working the same
                lender could not be paid differently and editing a lender
                silently repriced everybody on it. */}
            <div className="space-y-3 border-t border-border/70 pt-3">
              <p className="text-[11px] font-medium text-foreground">Battery-only jobs</p>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Pay plan</Label>
                <Select
                  value={battPlan === "" ? "unset" : battPlan}
                  onValueChange={(v) => setBattPlan(v === "unset" ? "" : (v as "margin" | "flat"))}
                  disabled={!canEdit}
                >
                  <SelectTrigger className="w-full sm:w-64"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unset">Not set — pays nothing</SelectItem>
                    <SelectItem value="margin">Margin — keeps what it sells above the redline</SelectItem>
                    <SelectItem value="flat">Flat — a fixed amount per battery</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Redline"
                  prefix="$"
                  suffix="/battery"
                  step="100"
                  value={battRedline}
                  onChange={(e) => setBattRedline(e.target.value)}
                  placeholder="9,000"
                  disabled={!canEdit || battPlan === "flat"}
                  hint={
                    battPlan === "flat"
                      ? "Not used — this person is on the flat plan."
                      : "Net of the lender's fee. They keep every cent above it."
                  }
                />
                <Field
                  label="Fixed-pay rate"
                  prefix="$"
                  suffix="/battery"
                  step="100"
                  value={battFlat}
                  onChange={(e) => setBattFlat(e.target.value)}
                  placeholder="1,500"
                  disabled={!canEdit || battPlan === "margin"}
                  hint={
                    battPlan === "margin"
                      ? "Not used — this person is on the margin plan."
                      : "A flat amount per installed battery, whatever it prices at."
                  }
                />
              </div>
            </div>

            {/* The worked example. Same functions the engine calls, so what is
                shown here is what eventually gets paid. */}
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <Info className="size-3.5" /> On a {EXAMPLE_KW} kW deal at{" "}
                {centsPerWattLabel(exampleStickerPpwCents)} through a {solarExample.dealerFeePct}% lender
              </p>
              <dl className="mt-2 space-y-1.5 text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">
                    Redline{redlineCents != null && ` · nets ${centsPerWattLabel(example.basePpwCents)} vs ${centsPerWattLabel(redlineCents)}`}
                  </dt>
                  <dd className="shrink-0 font-semibold tabular-nums">
                    {example.redlinePay ? money(example.redlinePay.amountCents) : <span className="font-normal text-muted-foreground">not set</span>}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">
                    Fixed pay{perWattMills != null && ` · ${millsPerWattLabel(perWattMills)} × ${example.watts.toLocaleString("en-US")} W`}
                  </dt>
                  <dd className="shrink-0 font-semibold tabular-nums">
                    {example.perWattPay ? money(example.perWattPay.amountCents) : <span className="font-normal text-muted-foreground">not set</span>}
                  </dd>
                </div>
              </dl>

              {/* The storage job, priced separately because it shares nothing
                  with the deal above — no watts, and a base price that comes
                  off the battery catalogue rather than a $/W. */}
              <p className="mt-3 flex items-center gap-1.5 border-t border-border/60 pt-2.5 text-[11px] font-medium text-muted-foreground">
                <Info className="size-3.5" /> On a {EXAMPLE_BATTERIES}-battery storage job holding{" "}
                {money(EXAMPLE_BATTERY_BASE_CENTS)} of base price
              </p>
              <dl className="mt-2 space-y-1.5 text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">
                    Redline{battRedlineCents != null && ` · ${money(battRedlineCents)}/battery × ${EXAMPLE_BATTERIES}`}
                  </dt>
                  <dd className="shrink-0 font-semibold tabular-nums">
                    {example.battRedlinePay ? money(example.battRedlinePay.amountCents) : <span className="font-normal text-muted-foreground">not set</span>}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">
                    Fixed pay{battFlatCents != null && ` · ${money(battFlatCents)}/battery × ${EXAMPLE_BATTERIES}`}
                  </dt>
                  <dd className="shrink-0 font-semibold tabular-nums">
                    {example.battFlatPay ? money(example.battFlatPay.amountCents) : <span className="font-normal text-muted-foreground">not set</span>}
                  </dd>
                </div>
              </dl>
            </div>

            {/* A blank rate is not a zero rate — it generates no commission line
                at all. Better said here than discovered at payroll. */}
            {(redlineCents == null || perWattMills == null) && (
              <p className="rounded-lg bg-amber-50 p-2 text-[11px] text-amber-900">
                {redlineCents == null && perWattMills == null
                  ? `No solar terms set — this ${who}'s solar deals will pay nothing.`
                  : redlineCents == null
                    ? `No redline set — deals through a redline lender (and every cash deal) will pay this ${who} nothing.`
                    : `No fixed rate set — deals through a fixed-pay lender, and every lease/PPA, will pay this ${who} nothing.`}
              </p>
            )}

            {/* Said separately from the warning above rather than folded into
                it: a rep can be fully set up for arrays and still earn nothing
                on a battery-only job, and one sentence covering both reads as
                though the rates above were the problem. */}
            {(battPlan === "" ||
              (battPlan === "margin" && battRedlineCents == null) ||
              (battPlan === "flat" && battFlatCents == null)) && (
              <p className="rounded-lg bg-amber-50 p-2 text-[11px] text-amber-900">
                {battPlan === ""
                  ? `No battery pay plan chosen — a job selling storage on its own will pay this ${who} nothing, whatever the rates above say.`
                  : battPlan === "margin"
                    ? `On the margin plan with no per-battery redline set — battery-only jobs will pay this ${who} nothing.`
                    : `On the flat plan with no per-battery rate set — battery-only jobs will pay this ${who} nothing.`}
              </p>
            )}
          </div>
        )}
      </div>

      {canEdit && (
        <div className="mt-4 flex items-center gap-3">
          <Button
            size="sm"
            onClick={save}
            disabled={busy || !dirty}
            className="bg-gold text-gold-foreground hover:bg-gold/90"
          >
            {busy && <Loader2 className="size-4 animate-spin" />} Save pay structure
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Changes apply to deals whose commission hasn&rsquo;t been generated yet. Lines already on a
            deal keep the terms they were sold on.
          </p>
        </div>
      )}
    </div>
  );
}
