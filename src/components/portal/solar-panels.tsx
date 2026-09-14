"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2, TriangleAlert, CircleAlert, Sun, ImageUp, Trash2, BadgeCheck, ExternalLink, Maximize2,
  ChevronDown, Send,
} from "lucide-react";
import type { FinanceProduct, MountType } from "@prisma/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LenderMark } from "@/components/ui/lender-mark";
import {
  builderStepFromHref,
  groupIssues,
  type BuilderStep,
  type ValidationIssue,
} from "@/lib/solar-validation";
import { panelCount, type LayoutBlock } from "@/lib/solar-layout";
import { effectiveUsageKwh } from "@/lib/solar-energy";
import { adderTotals } from "@/lib/solar-adders";
import {
  SolarAddersPanel,
  type AdderOption,
  type DealAdderLine,
} from "@/components/portal/solar-adders-panel";
import { systemTotals } from "@/lib/solar-arrays";
import {
  loanPaymentCents,
  grossPpwFromNet,
  leaseMonthlyCents,
  priceStoredPurchase,
  priceStorageStored,
  batteryChargeCents,
  type YieldAssumptions,
  type FinalPpwMode,
  type PriceBasis,
} from "@/lib/solar-money";
import { SystemPriceCard, StoragePriceCard } from "@/components/portal/solar/system-price";
import { CreditClaimsCard } from "@/components/portal/solar/credit-claims";
import { resolveSignToday, type SignTodayMode } from "@/lib/solar-sign-today";
import {
  buildCreditLadder,
  type CreditClaims,
  type CreditRates,
} from "@/lib/solar-credit-ladder";
import { lenderProductLabel } from "@/lib/solar-lender-product";
import { proposalVersionStanding } from "@/lib/solar-proposal-state";
import { CASH_OFFER_ID, type CompareBasis, type CompareRow, type OfferProduct } from "@/lib/solar-compare";
import { FinanceOffers } from "@/components/portal/solar-finance-offers";
import { SolarSharePanel } from "@/components/portal/solar-share-panel";
import {
  factorQuote,
  factorMonthlyCents,
  hasPaymentFactor,
  formatFactor,
  programmeMonthlyCents,
} from "@/lib/solar-loan";
import {
  saveSolarDesignAction,
  saveSolarFinanceAction,
  setSolarDealLenderAction,
  validateSolarDealAction,
} from "@/server/modules/solar/actions";
import {
  generateSolarProposalAction,
  markProposalSentAction,
  setProposalApprovalAction,
  uploadPanelLayoutAction,
  removePanelLayoutAction,
  setLayoutApprovalAction,
} from "@/server/modules/solar/proposal-actions";

/**
 * The layout the proposal shows the customer, and the escape hatch that feeds
 * it from somewhere else.
 *
 * Anexa draws the roof itself now, and saving in the designer attaches the
 * drawing here automatically — so this panel's normal state is "showing what
 * was drawn", not "asking a rep which tool they used". The upload is kept, and
 * kept FOLDED AWAY, for the two cases that still need it: a plan set from an
 * engineer, and a deal whose design was done elsewhere before the customer ever
 * reached us. A tool that is itself the design tool should not lead with a box
 * asking for the name of the design tool.
 *
 * Explicitly NOT the aerial property photo — a satellite view with no array on
 * it is a picture of a roof, and presenting it as a design is something the
 * customer discovers at the site survey.
 */
function PanelLayoutPanel({
  leadId,
  fileId,
  available,
  approved,
  canApprove,
  provider,
  externalRef,
  uploadedAt,
  canEdit,
}: {
  leadId: string;
  fileId: string | null;
  /** The file row AND its bytes both resolved server-side. */
  available: boolean;
  approved: boolean;
  canApprove: boolean;
  provider: string | null;
  externalRef: string | null;
  uploadedAt: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [meta, setMeta] = React.useState({ provider: provider ?? "", externalRef: externalRef ?? "" });
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    const fd = new FormData();
    fd.set("leadId", leadId);
    fd.set("file", file);
    fd.set("designProvider", meta.provider);
    fd.set("designExternalRef", meta.externalRef);
    const res = await uploadPanelLayoutAction(fd);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Panel layout attached");
    router.refresh();
  }

  async function remove() {
    setBusy(true);
    const res = await removePanelLayoutAction(leadId);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    // Detaches the reference only. The uploaded file stays on the deal.
    toast.success("Layout removed from the proposal");
    router.refresh();
  }

  async function approve(next: boolean) {
    setBusy(true);
    const res = await setLayoutApprovalAction(leadId, next);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(next ? "Layout marked final" : "Layout back to preliminary");
    router.refresh();
  }

  return (
    <section className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Panel layout
      </h4>

      {fileId && available ? (
        <div className="space-y-2">
          {/* object-contain in an auto-height box: the uploaded drawing is
              rendered exactly as designed, never cropped or stretched. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/portal/files/${fileId}`}
            alt="Panel layout"
            className="h-auto w-full rounded-lg border border-border bg-muted/30 object-contain"
          />
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                approved ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
              )}
            >
              {approved ? "Final design" : "Preliminary design"}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {approved
                ? "The proposal drops the may-change caveat."
                : "The proposal tells the customer this may change at the site survey."}
              {uploadedAt ? ` Attached ${new Date(uploadedAt).toLocaleDateString()}.` : ""}
            </span>
          </div>
          {canApprove && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => approve(!approved)}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <BadgeCheck className="size-4" />}
              {approved ? "Mark preliminary again" : "Mark this layout final"}
            </Button>
          )}
        </div>
      ) : fileId && !available ? (
        // The design still references a drawing, but the file or its bytes are
        // gone. The customer's copy omits the section entirely; this is the
        // rep's cue to fix it before that matters.
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
          The panel-layout image is unavailable. Upload or replace it before sending.
        </p>
      ) : (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
          Nothing drawn yet. The proposal omits the layout section rather than showing the customer
          a placeholder — open the designer above and lay the array on the roof.
        </p>
      )}

      {canEdit && (
        <details className="rounded-lg border border-border bg-muted/20 p-3">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            Use a drawing from somewhere else instead
          </summary>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Only for a plan set from an engineer, or a design done before this deal reached us.
            Drawing it here is what keeps the panel count, the system size and the offset tied to
            the same geometry — an uploaded picture is a picture, and none of those numbers come
            off it.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <TextField
              label="Design tool"
              value={meta.provider}
              placeholder="e.g. Aurora"
              onChange={(v) => setMeta((m) => ({ ...m, provider: v }))}
            />
            <TextField
              label="Design reference"
              value={meta.externalRef}
              placeholder="Provider's project id"
              onChange={(v) => setMeta((m) => ({ ...m, externalRef: v }))}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = "";
              }}
            />
            <Button variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ImageUp className="size-4" />}
              {fileId ? "Replace layout" : "Upload layout"}
            </Button>
            {fileId && (
              <Button variant="ghost" size="sm" disabled={busy} onClick={remove}>
                <Trash2 className="size-4" /> Remove
              </Button>
            )}
            <span className="text-[11px] text-muted-foreground">JPG, PNG or WebP · max 15MB</span>
          </div>
        </details>
      )}
    </section>
  );
}


export type SolarDesignView = {
  utilityProvider: string | null;
  annualUsageKwh: number | null;
  /** What this deal's adders add to that — an EV charger, a pool pump. */
  usageAdjustmentKwh: number;
  avgMonthlyBillCents: number | null;
  mountType: MountType;
  moduleQty: number;
  systemSizeKwDc: number;
  year1ProductionKwh: number;
  offsetPct: number;
  layoutImageFileId: string | null;
  layoutImageUploadedAt: string | null;
  designProvider: string | null;
  designExternalRef: string | null;
  layoutApproved: boolean;
} | null;

export type SolarFinanceView = {
  product: FinanceProduct;
  grossPpwCents: number;
  /** The storage sticker, per battery. Zero on every PV deal. */
  stickerPricePerBatteryCents: number;
  dealerFeePct: number;
  adderTotalCents: number;
  onTopAdderTotalCents: number;
  contractPriceCents: number;
  itcEstimateCents: number;
  rateMillsPerKwh: number | null;
  monthlyPaymentCents: number | null;
  escalatorPct: number | null;
  termYears: number | null;
  aprPct: number | null;
  loanTermMonths: number | null;
  downPaymentCents: number | null;
  loanMonthlyPaymentCents: number | null;
  /// Which rate-sheet row this was quoted from. Provenance: the terms above are
  /// copies taken when the rep chose it.
  lenderProductId: string | null;
} | null;

function money(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/**
 * Seed a text input from a stored figure, keeping ZERO distinct from "unset".
 *
 * `x ? fmt(x) : ""` looks harmless and is not: a stored 0 is falsy, so a $0 down
 * payment or a 0% escalator came back as an EMPTY box, and the next save then
 * wrote null over a value the rep had deliberately entered. Only null/undefined
 * mean "nothing here".
 */
const num = (v: number | null | undefined, scale = 1, digits?: number): string => {
  if (v == null) return "";
  const n = v / scale;
  return digits == null ? n.toString() : n.toFixed(digits);
};

/** Module scope on purpose — react-hooks/static-components is an error here. */
function TextField({
  label, value, onChange, disabled, type = "text", step, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  type?: string;
  step?: string;
  placeholder?: string;
}) {
  // Associate the label with the input: it makes the label clickable, lets a
  // screen reader announce the field, and is why getByLabel works in tests.
  const id = React.useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input
        id={id}
        type={type}
        step={step}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/**
 * The readiness report: blocking issues stop generation, warnings must be seen
 * but can be accepted.
 *
 * Grouped by the screen that fixes them, and every finding carries a link to
 * that screen. A flat list of twelve sentences is a puzzle; "Utility: 2 things,
 * here they are, click to go and fix them" is a task list.
 *
 * `onOpenStep` is what makes those links work from inside the builder. This
 * report is rendered on the builder's third step, so "Open system design" is a
 * link to the page the rep is already standing on: the route does not change,
 * the builder never remounts, and the step it seeded once from the URL never
 * moves — the rep clicks and nothing happens. Given the callback, a finding
 * that points at another step of THIS builder switches to it directly; links
 * that genuinely lead elsewhere stay links.
 */
export function ValidationList({
  issues,
  onOpenStep,
}: {
  issues: ValidationIssue[];
  onOpenStep?: (step: BuilderStep) => void;
}) {
  if (issues.length === 0) return null;
  const groups = groupIssues(issues);
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.group} className="space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {g.label}
          </div>
          <ul className="space-y-1.5">
            {g.issues.map((i, n) => (
              <li
                key={`${i.code}-${n}`}
                data-issue-code={i.code}
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
                <span className="flex-1">
                  {i.message}
                  {i.action && <IssueAction action={i.action} onOpenStep={onOpenStep} />}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * The "take me there" affordance on one finding — a step switch when it points
 * back into this builder, a real link when it points anywhere else.
 */
function IssueAction({
  action,
  onOpenStep,
}: {
  action: NonNullable<ValidationIssue["action"]>;
  onOpenStep?: (step: BuilderStep) => void;
}) {
  const className = "whitespace-nowrap font-medium underline underline-offset-2";
  const step = onOpenStep ? builderStepFromHref(action.href) : null;

  if (step && onOpenStep) {
    return (
      <>
        {" "}
        <button type="button" className={className} onClick={() => onOpenStep(step)}>
          {action.label} →
        </button>
      </>
    );
  }

  return (
    <>
      {" "}
      <Link href={action.href} className={className}>
        {action.label} →
      </Link>
    </>
  );
}

export function SolarDesignPanel({
  leadId,
  design,
  canEdit,
  layoutAvailable,
  canApproveLayout,
  lat,
  moduleRatingW,
  initialBlocks,
  assumptions,
  measuredYields,
}: {
  leadId: string;
  design: SolarDesignView;
  canEdit: boolean;
  /** Resolved server-side: the file row AND its bytes both exist. */
  layoutAvailable: boolean;
  canApproveLayout: boolean;
  lat: number | null;
  moduleRatingW: number | null;
  initialBlocks: LayoutBlock[];
  /** The company's yield and derate, so the live preview matches the save. */
  assumptions: YieldAssumptions;
  /**
   * What NREL has already said about the planes on this roof, keyed by pitch
   * and facing — read from the cache on the server, exactly as the designer
   * reads it. Without it this summary prices the roof on the company's flat
   * market average while the designer, the save and the customer's document
   * price it on the simulation, and the three disagree by a sixth.
   */
  measuredYields: Record<string, number>;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [mountType, showMountType] = React.useState<MountType>(
    (design?.mountType ?? "roof") as MountType
  );

  /**
   * The mount type saves ITSELF, and there is no Save button on this step.
   *
   * There was one, and it was the last surviving control on a form whose every
   * other figure is derived: it sent the mount type and nothing else. But
   * pressing it also recomputed the production, so it was the one button on the
   * screen that could change what a customer is quoted — and for a while it did,
   * on a worse model. A control whose visible job is a dropdown must not be the
   * thing that decides a homeowner's kWh.
   *
   * So the dropdown writes on change and the button is gone. Nothing on this
   * step is now a thing a rep can forget to press.
   *
   * The select shows the new value immediately and rolls back if the write
   * fails — a picker that snaps back for the length of a round trip reads as a
   * broken control, and one that keeps a value the server rejected is a lie.
   * `busy` is cleared in a `finally`: a throw that left it latched would freeze
   * the picker with no way out.
   */
  async function setMountType(next: MountType) {
    if (next === mountType) return;
    const previous = mountType;
    showMountType(next);
    setBusy(true);
    try {
      const res = await saveSolarDesignAction({ leadId, mountType: next });
      if (!res.ok) {
        showMountType(previous);
        return void toast.error(res.error);
      }
      // Worth saying out loud: this is a repricing, not a label. PVWatts
      // simulates an open rack differently from a roof, so the kWh on the
      // screen is about to move.
      toast.success(
        next === "ground" ? "Ground mount — the array is repriced." : "Roof mount — the array is repriced."
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // Counted from the geometry, the same way the server counts it on save —
  // never read back off `design.moduleQty`, which is only ever a cached copy.
  const drawnPanels = panelCount(initialBlocks);
  // And sized the same way, from the same function the designer and the save
  // action call, so the summary here cannot disagree with either of them.
  const live = React.useMemo(
    () =>
      systemTotals(initialBlocks, {
        lat,
        moduleRatingW,
        assumptions,
        planeYield: ({ tiltDeg, azimuthDeg }) =>
          tiltDeg == null || azimuthDeg == null
            ? null
            : (measuredYields[`${tiltDeg}|${azimuthDeg}`] ?? null),
      }),
    [initialBlocks, lat, moduleRatingW, assumptions, measuredYields]
  );
  // Against the usage the system actually has to cover — the bill figure PLUS
  // whatever the adders on this deal add to it. The same rule the server
  // applies, so the live figure here and the stored one cannot disagree.
  const coverKwh = effectiveUsageKwh(design?.annualUsageKwh, design?.usageAdjustmentKwh);
  const liveOffsetPct = coverKwh > 0 ? (live.year1ProductionKwh / coverKwh) * 100 : null;
  const staleCount = (design?.moduleQty ?? 0) > 0 && drawnPanels === 0;

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Site
        </h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Mount type</Label>
            <select
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={mountType}
              disabled={!canEdit || busy}
              onChange={(e) => setMountType(e.target.value as MountType)}
            >
              <option value="roof">Roof</option>
              <option value="ground">Ground</option>
            </select>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          System
        </h4>
        {/* Equipment is no longer chosen here. A rep sells a system; the
            approved-vendor list decides which panel it is built from, and the
            inverter and battery are settled when the job is built — both live
            on the deal's Operations card now, with the lender whose list gates
            them.

            The module count is not typed either: it is how many panels were
            drawn on the roof below, which is the only way to know how many fit. */}

        {/* The drawing is the source of truth; `moduleQty` is a copy of it that
            the save action refreshes. They disagree in exactly one situation,
            and it is not a rare one: a design created before the designer
            existed carries a count that was typed into a box with no geometry
            behind it. Showing that stale number next to an empty roof read as
            "the tool has lost my array", which is the opposite of what had
            happened — nothing was ever drawn. */}
        {staleCount ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
            The figures below were built on <strong>{design?.moduleQty} panels</strong> entered
            before this deal had a drawing. Nothing is on the roof yet, so they no longer describe
            anything. Draw the array and press <strong>Save layout</strong> to replace them.
          </p>
        ) : null}

        {/* Without a panel in the catalogue there is no wattage, so kW,
            production and offset are all structurally zero — and the old UI
            said so in grey type at the end of a sentence. It is the single
            thing standing between this deal and a quote. */}
        {!moduleRatingW ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-900">
            <strong>No default panel in the equipment catalogue.</strong> Every figure below stays
            at zero until there is one, because a panel count without a wattage is not a system
            size.{" "}
            <Link href="/portal/settings/solar-equipment" className="font-medium underline">
              Add a module in Settings → Solar equipment
            </Link>{" "}
            and star it as the default. Give it a width and length too — that is what the roof
            below draws panels at.
          </p>
        ) : null}

        {/* Computed from module count × rating and the company's assumptions —
            never typed in, so it cannot be faked.

            Read off the GEOMETRY rather than off the saved columns, for the
            same reason the panel count is: the columns are a cache the save
            action refreshes, and a design opened after a drawing was changed
            elsewhere would otherwise show the figures from the drawing before
            it. Offset is the one that needs a second input — a system makes the
            same kWh whatever the house uses — so it stays blank rather than
            reading 0% when nobody has recorded the usage. */}
        <div className="grid grid-cols-3 gap-3 rounded-lg border border-border bg-muted/30 p-3 text-center">
          <div>
            <div className="font-display text-lg font-semibold">{live.systemSizeKwDc.toFixed(2)}</div>
            <div className="text-[11px] text-muted-foreground">kW-DC</div>
          </div>
          <div>
            <div className="font-display text-lg font-semibold">
              {live.year1ProductionKwh.toLocaleString()}
            </div>
            <div className="text-[11px] text-muted-foreground">yr-1 kWh</div>
          </div>
          <div>
            <div className="font-display text-lg font-semibold">
              {liveOffsetPct == null ? "—" : `${liveOffsetPct.toFixed(0)}%`}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {liveOffsetPct == null
                ? "no usage yet"
                : (design?.usageAdjustmentKwh ?? 0) > 0
                  ? `offset · incl. +${design!.usageAdjustmentKwh.toLocaleString()} kWh`
                  : "offset"}
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          The array
        </h4>

        {/* The designer is a screen of its own, not a box on this form. A roof
            is landscape and a form is a column, and the judgement being made
            here — does this module clear the vent, is that oak over this bank —
            needs the picture as big as the screen goes. */}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/30 p-4">
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg font-semibold">
              {drawnPanels} {drawnPanels === 1 ? "panel" : "panels"}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                {live.systemSizeKwDc > 0
                  ? `· ${live.systemSizeKwDc.toFixed(2)} kW-DC · ${live.year1ProductionKwh.toLocaleString()} kWh yr-1`
                  : "· nothing drawn on the roof yet"}
              </span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {lat == null
                ? "This deal has no rooftop coordinate, so the roof cannot be shown — fix the address first."
                : live.unorientedArrays > 0
                  ? `${live.unorientedArrays} ${live.unorientedArrays === 1 ? "array still needs" : "arrays still need"} a facing and a pitch — until then they earn the generic market yield.`
                  : "Setbacks, tilt, shading and the live offset are all in the designer."}
            </p>
          </div>
          <Button asChild size="lg" disabled={lat == null}>
            <Link href={`/portal/leads/${leadId}/solar-proposal/design`}>
              <Maximize2 className="size-4" />
              {drawnPanels > 0 ? "Open the designer" : "Draw the array"}
            </Link>
          </Button>
        </div>
      </section>

      <PanelLayoutPanel
        leadId={leadId}
        fileId={design?.layoutImageFileId ?? null}
        available={layoutAvailable}
        approved={design?.layoutApproved ?? false}
        canApprove={canApproveLayout}
        provider={design?.designProvider ?? null}
        externalRef={design?.designExternalRef ?? null}
        uploadedAt={design?.layoutImageUploadedAt ?? null}
        canEdit={canEdit}
      />
    </div>
  );
}

export type LenderOption = {
  id: string;
  name: string;
  isActive: boolean;
  /** Dealer portal, rep-facing. Never the customer application link. */
  portalUrl: string | null;
  creditInstructions: string | null;
  /** The partner's mark. Null falls back to a monogram, never to nothing. */
  logoUrl: string | null;
  /**
   * This partner's stated price per watt to a homeowner, fee and adders
   * included, cents. Null — nearly every lender — means the ordinary
   * base-times-fee pricing, unchanged.
   */
  maxFinalPpwCents: number | null;
  /**
   * How this partner's SIGN TODAY CREDIT is arrived at, and its figure. `none`
   * — every lender until somebody sets a rule — leaves the credit to the rep,
   * typed on the deal. See `solar-sign-today`.
   */
  signTodayMode: SignTodayMode;
  signTodayFixedCents: number | null;
  signTodayCapPpwCents: number | null;
  /**
   * The same two rules over BATTERIES, for a deal with no watts. Null means no
   * rule, which is every lender until somebody sets one.
   */
  maxFinalPricePerBatteryCents: number | null;
  minBasePricePerBatteryCents: number | null;
  finalBatteryPriceMode: "cap" | "flat";
  /**
   * Whether that figure is a CEILING or the PRICE. A flat partner sells at one
   * number whatever the base and whatever the adders; see SolarFinalPpwMode.
   */
  finalPpwMode: FinalPpwMode;
  /**
   * The least this partner's deals may leave the company per watt, before its
   * cut, cents. Null — nearly every lender — means no floor.
   */
  minBasePpwCents: number | null;
};

export type LenderProductOption = {
  id: string;
  /** Whose sheet this row is off. The panel holds every lender's rate sheet so
   *  changing lender re-offers terms without a round trip, so each row has to
   *  say which one it belongs to. */
  lenderId: string;
  product: FinanceProduct;
  name: string | null;
  aprPct: number | null;
  termMonths: number | null;
  dealerFeePct: number | null;
  leaseRateCentsPerKwMonth: number | null;
  /** Whether this paper funds a battery with no array. Loans only. */
  financesStorageOnly: boolean;
  rateMillsPerKwh: number | null;
  escalatorPct: number | null;
  termYears: number | null;
  /** Payment factors in millionths. Loan only; null when the sheet quotes none. */
  factorWithPaydownMicros: number | null;
  factorWithoutPaydownMicros: number | null;
  paydownPct: number | null;
  paydownMonths: number | null;
  isActive: boolean;
  /**
   * Which price the partner's $/W and $/battery fix on THIS programme — see
   * SolarPriceBasis. Read off the chosen programme, beside the partner's own
   * figure: one partner's $5.50 is the gross on one product and the base on
   * another.
   */
  ppwBasis: PriceBasis;
  batteryPriceBasis: PriceBasis;
};

export function SolarFinancePanel({
  leadId,
  finance,
  canEdit,
  lenders,
  lenderId: initialLenderId,
  products,
  defaultBasePpwCents,
  systemType,
  batteryQty,
  batteryLabel,
  batteryUnitPriceCents,
  adderCatalogue,
  adderLines,
  systemSizeKwDc,
  year1ProductionKwh,
  annualDegradationPct,
  creditRates,
  creditClaims,
  signTodayCreditCents,
  onOpenDesign,
}: {
  leadId: string;
  finance: SolarFinanceView;
  canEdit: boolean;
  /** The company's federal-credit percentages, from Settings → Solar. */
  creditRates: CreditRates;
  /** Which of them this job earns, as last saved on the finance row. */
  creditClaims: CreditClaims;
  /** The closing credit typed on this deal, cents. Zero on nearly all. */
  signTodayCreditCents: number;
  /** Every lender the company works with, retired ones included — a deal that
   *  already names one must keep showing it rather than falling back to none. */
  lenders: LenderOption[];
  /** The lender on the design. Null when nobody has chosen one yet. */
  lenderId: string | null;
  /** Every lender's rate sheet: sellable rows, plus whatever this deal quotes.
   *  Held whole so switching lender re-offers terms without a round trip. */
  products: LenderProductOption[];
  /** The company's base price per watt, which a fresh deal opens on. */
  defaultBasePpwCents: number | null;
  /** The company's guard rails. A price outside them warns; it never blocks. */
  /**
   * What this deal sells. On `storage` every rate on this screen is per
   * BATTERY, not per watt: there is no array for a $/W figure to be per, and
   * pricing one through the watt path multiplies by zero.
   */
  systemType: "pv" | "pv_storage" | "storage";
  batteryQty: number;
  /** What the storage on this deal is, for the line that charges for it. */
  batteryLabel: string | null;
  /**
   * What the catalogue sells ONE of them for.
   *
   * On a deal with an array this is a PRICE ON THE CONTRACT: a rate per watt is
   * a price for an array and cannot charge for a battery, so the storage rides
   * on top at this figure — see `batteryChargeCents`. On a storage-only deal it
   * is nothing of the kind: there the battery is the system, and the price per
   * battery is the box the rep types in below.
   */
  batteryUnitPriceCents: number;
  /** The adders this company sells, for the rep to pick from. */
  adderCatalogue: AdderOption[];
  /** The lines already on this deal. The total is derived from them. */
  adderLines: DealAdderLine[];
  /** Needed to price a lease, which is quoted per kW-month. */
  systemSizeKwDc: number;
  /** A PPA is paid per kWh produced, so its term costs what the roof makes. */
  year1ProductionKwh: number;
  /** Output decays, so a 25-year total is not year one multiplied by 25. */
  annualDegradationPct: number;
  /** Sends the rep to the step that gives this one a system to price. */
  onOpenDesign?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [product, setProduct] = React.useState<FinanceProduct>(finance?.product ?? "cash");
  const [lenderId, setLenderId] = React.useState<string>(initialLenderId ?? "");
  const [lenderBusy, setLenderBusy] = React.useState(false);
  const [lenderProductId, setLenderProductId] = React.useState<string>(finance?.lenderProductId ?? "");
  const lender = lenders.find((l) => l.id === lenderId) ?? null;
  const seed = (f: SolarFinanceView) => ({
    dealerFeePct: num(f?.dealerFeePct),
    rate: num(f?.rateMillsPerKwh, 1000, 3),
    monthly: num(f?.monthlyPaymentCents, 100),
    escalatorPct: num(f?.escalatorPct),
    termYears: num(f?.termYears),
    aprPct: num(f?.aprPct),
    loanTermMonths: num(f?.loanTermMonths),
  });
  // Carried, not typed into. Every figure here is published on the rate sheet
  // and arrives by quoting a programme; the state exists so the save path
  // posts back what the row already holds rather than nulling it.
  const [form, setForm] = React.useState(() => seed(finance));
  const isPurchase = product === "cash" || product === "loan";
  /**
   * A deal with no array. Every rate on this screen is per battery, the
   * lender's guardrails are the per-battery pair, and only paper flagged as
   * funding storage is offered.
   */
  const isStorage = systemType === "storage";
  const isLoan = product === "loan";
  const isCash = product === "cash";

  const chosen = products.find((p) => p.id === lenderProductId) ?? null;

  /**
   * The partner whose paper this deal is written on, resolved ONCE.
   *
   * Everything on this screen that has to respect a price rule — the price
   * card's ceiling, its floor, the flat rate on the terms line, and the live
   * pricing below — reads it from here rather than doing its own `find`. Five
   * lookups of the same lender is five chances for one of them to be spelled
   * differently, and the one that was spelled differently is how the strip came
   * to quote a payment the shelf of cards above it disagreed with.
   *
   * Cash has no lender and therefore no rule, which is the line every other
   * file draws in the same place.
   */
  const quotedLender = chosen && !isCash ? (lenders.find((x) => x.id === chosen.lenderId) ?? null) : null;

  /**
   * The chosen partner's flat rate, if it sells at one.
   *
   * Named on the terms line because on such a lender it IS the deal: the
   * homeowner's price is not derived from anything on this screen, and a rep
   * reading the terms is entitled to see the number their paper carries.
   * Null on a partner that prices the ordinary way.
   */
  const quotedFlatPpwCents =
    quotedLender?.finalPpwMode === "flat" ? quotedLender.maxFinalPpwCents : null;

  /**
   * The deal's base price per watt — what Anexa charges before a lender's cut.
   *
   * Recovered from the stored row rather than kept in a column of its own:
   * `grossPpwCents` is the sticker the deal was quoted at and `dealerFeePct` is
   * the cut that was taken out of it, so the base is `gross × (1 − fee)` — the
   * exact inverse of `grossPpwFromNet`, which is what put the sticker there.
   *
   * That inverse is what keeps an already-quoted deal on its own number: a deal
   * quoted on a 28% loan recovers the base that regrosses to the same sticker,
   * and a cash deal (fee zero) recovers its price unchanged. A deal nobody has
   * priced yet opens on the company figure.
   */
  const [basePpwCents, setBasePpwCents] = React.useState<number | null>(() => {
    // On storage the stored sticker is in its own column, and there is no
    // sensible company default for a price per battery — the catalogue has not
    // been asked for one — so an unpriced storage deal opens EMPTY rather than
    // on a $/W figure that would read as $3.50 a Powerwall.
    const stored = systemType === "storage"
      ? (finance?.stickerPricePerBatteryCents ?? 0)
      : (finance?.grossPpwCents ?? 0);
    if (stored > 0) return Math.round(stored * (1 - (finance?.dealerFeePct ?? 0) / 100));
    return systemType === "storage" ? null : defaultBasePpwCents;
  });

  /**
   * WHAT THE STORAGE ADDS TO THIS CONTRACT, live.
   *
   * The deal's own per-battery price where somebody typed one, else the
   * catalogue's — the same resolver the save and the proposal use, so the
   * figure on this screen is the figure that gets written. Zero on a
   * storage-only deal, where the battery is the system priced in the box above.
   */
  const batteryPriceCents = batteryChargeCents({
    systemType,
    batteryQty,
    dealPerBatteryCents: finance?.stickerPricePerBatteryCents,
    cataloguePerBatteryCents: batteryUnitPriceCents,
  });

  /**
   * What the adders come to, derived from the lines exactly as the server
   * derives it.
   *
   * Mirrors `recomputeAdderTotal`, including the legacy branch: a deal priced
   * before adders were itemised carries a typed total and no lines, and
   * recomputing that from an empty list would show a homeowner's quote dropping
   * by the price of their re-roof. The moment there is one line, the lines win.
   */
  const adderSplit = React.useMemo(() => {
    if (adderLines.length === 0) {
      return {
        adderTotalCents: finance?.adderTotalCents ?? 0,
        onTopAdderTotalCents: finance?.onTopAdderTotalCents ?? 0,
      };
    }
    const t = adderTotals(adderLines, Math.round(systemSizeKwDc * 1000));
    return { adderTotalCents: t.financedInCents, onTopAdderTotalCents: t.onTopCents };
  }, [
    adderLines, finance?.adderTotalCents, finance?.onTopAdderTotalCents, systemSizeKwDc,
  ]);
  const { adderTotalCents, onTopAdderTotalCents } = adderSplit;

  /**
   * The fee this deal is quoted under, and the sticker the base grosses up to.
   *
   * The fee is read off the RATE SHEET whenever a programme is quoted, because
   * that is where the save action reads it from too — a typed fee that the
   * server is going to overwrite is a number on screen that does not survive
   * Save. Cash carries no fee by definition; a hand-quoted loan with no
   * programme behind it falls back to the typed box.
   */
  const feePct = isCash
    ? 0
    : (chosen?.dealerFeePct ?? (form.dealerFeePct.trim() === "" ? null : Number(form.dealerFeePct)) ?? 0);
  const stickerPpwCents =
    basePpwCents == null ? null : grossPpwFromNet(basePpwCents, Number.isFinite(feePct) ? feePct : 0);

  /**
   * Choosing a programme copies its terms into the boxes.
   *
   * The boxes have to show what will be saved. Leaving the previous
   * programme's 28% fee and 3.99% APR on screen under a card that says 38% and
   * 0% is the screen lying about what Save will write. The PRICE is not touched:
   * the base belongs to the deal, and each programme grosses it up by its own
   * fee — switching lender changes what the customer pays, not what we charge.
   */
  const applyProductFrom = (p: LenderProductOption) => {
    setLenderProductId(p.id);
    setForm((f) => ({
      ...f,
      dealerFeePct: num(p.dealerFeePct),
      aprPct: p.product === "loan" ? num(p.aprPct) : "",
      loanTermMonths: p.product === "loan" ? num(p.termMonths) : "",
      rate: p.product === "ppa" ? num(p.rateMillsPerKwh, 1000, 3) : "",
      monthly:
        p.product === "lease" && p.leaseRateCentsPerKwMonth != null
          ? num(leaseMonthlyCents(p.leaseRateCentsPerKwMonth, systemSizeKwDc), 100)
          : "",
      escalatorPct: p.product === "loan" ? "" : num(p.escalatorPct),
      termYears: p.product === "loan" ? "" : num(p.termYears),
    }));
  };

  /**
   * Every programme on the shelf, told who published it.
   *
   * The comparison prices by lender fee, so a row that cannot name its lender
   * cannot be priced; a product whose lender has been deleted is dropped rather
   * than shown under a blank heading.
   */
  const offers: OfferProduct[] = React.useMemo(
    () =>
      products.flatMap((p) => {
        // On a storage deal, only paper that funds one. Offering a homeowner a
        // programme the lender will reject is a decline they discover after
        // signing, and the flag is off until somebody has checked.
        if (isStorage && p.product === "loan" && !p.financesStorageOnly) return [];
        const l = lenders.find((x) => x.id === p.lenderId);
        // The ceiling lives on the partner and is merged in here, because the
        // comparison prices a PROGRAMME and should not have to hold a second
        // collection to find out what its publisher will fund.
        return l
          ? [
              {
                ...p,
                lenderName: l.name,
                label: lenderProductLabel(p),
                maxFinalPpwCents: l.maxFinalPpwCents,
                finalPpwMode: l.finalPpwMode,
                // Same reason as the ceiling above: the shelf prices a
                // programme, and each column's closing credit is its own
                // partner's to decide.
                signTodayMode: l.signTodayMode,
                signTodayFixedCents: l.signTodayFixedCents,
                signTodayCapPpwCents: l.signTodayCapPpwCents,
              },
            ]
          : [];
      }),
    [products, lenders, isStorage]
  );

  /**
   * Which programmes are on the table, and which one the deal is quoted on.
   *
   * The shortlist is a working set, not a saved one — a rep shows a homeowner
   * four ways to pay and one of them wins. It opens holding whatever the deal
   * already quotes so the comparison is never empty on a deal already priced.
   */
  const quotedId = lenderProductId || (product === "cash" ? CASH_OFFER_ID : null);
  const [shortlist, setShortlist] = React.useState<string[]>(() =>
    finance?.lenderProductId
      ? [finance.lenderProductId]
      : (finance?.product ?? "cash") === "cash"
        ? [CASH_OFFER_ID]
        : []
  );
  const toggleShortlist = (id: string) =>
    setShortlist((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  /**
   * The one basis every column is priced on.
   *
   * Read live off the price card and the adder lines rather than off the saved
   * row: a rep who has just moved the price ten cents expects every card and
   * column to move with it, and a table still quoting the saved figures is
   * worse than no table.
   */
  const basis: CompareBasis = {
    systemSizeKwDc,
    year1ProductionKwh,
    adderTotalCents,
    onTopAdderTotalCents,
    // The same battery on every column: it is the same house whichever partner
    // funds it, and a strip that charged for storage on one card and not the
    // next would be comparing two different jobs.
    batteryPriceCents,
    // Always nothing down. Solar here is sold financed in full — see the
    // financing section below for why a down-payment box no longer exists.
    downPaymentCents: 0,
    basePpwCents,
    annualDegradationPct,
    // What this job earns, live off the tick-boxes above — so unticking the
    // domestic-content bonus moves every card's after-credit payment on the
    // spot, exactly as it moves the ladder it was unticked on.
    credits: {
      rates: creditRates,
      claims: creditClaims,
      // What the REP typed. Each column resolves its own partner's rule over
      // it, so this only reaches a card whose lender has no rule of its own.
      signTodayTypedCents: signTodayCreditCents,
    },
  };

  /**
   * Moving the deal onto a lender is saved on the spot, not held for the Save
   * button.
   *
   * The lender gates the approved-vendor list as well as the terms, so letting
   * the design still say Amos while the screen quotes Climate First's sheet is
   * how a deal gets saved on money nobody approved. Returns false when the
   * write failed, so the caller can leave the quote where it was.
   */
  async function moveToLender(id: string) {
    if (id === lenderId) return true;
    const prev = lenderId;
    setLenderId(id);
    setLenderBusy(true);
    const res = await setSolarDealLenderAction({ leadId, lenderId: id || null });
    setLenderBusy(false);
    if (!res.ok) {
      setLenderId(prev);
      toast.error(res.error);
      return false;
    }
    router.refresh();
    return true;
  }

  /**
   * Commit the deal to one column of the comparison.
   *
   * Deliberately separate from shortlisting: checking a card is a question, and
   * this is the answer. It writes the lender first — everything else on the
   * screen belongs to that lender — then the product type and the programme.
   */
  async function quoteOffer(row: CompareRow) {
    if (row.id === CASH_OFFER_ID) {
      setProduct("cash");
      setLenderProductId("");
      toast.success("Quoting cash. Save to keep it.");
      return;
    }
    const p = products.find((x) => x.id === row.id);
    if (!p) return;
    if (!(await moveToLender(p.lenderId))) return;
    setProduct(p.product);
    applyProductFrom(p);
    toast.success(`Quoting ${row.lenderName ?? "this lender"} · ${row.label}. Save to keep it.`);
  }

  /**
   * What the customer would sign at the figures currently on screen, HELD TO
   * THE PARTNER'S RULE.
   *
   * Priced through `priceStoredPurchase`, which is `capStickerToFinalPpw` and
   * then `pricePurchase`, for two reasons that are easy to lose separately.
   *
   * Through `pricePurchase` at all, rather than multiplied out by hand: the
   * adders carry the dealer fee too, so `sticker × watts + adders` is short by
   * the lender's cut on the extra work, and a payment quoted off a short
   * principal is a payment the customer is not going to be held to.
   *
   * Through the CAP, rather than the raw sticker: a capped or flat partner
   * funds its own number whatever a rep typed, and this screen already knows
   * that everywhere else. The shelf of cards prices each column through
   * `compareOffers`, which caps; the price card at the top caps; the server
   * caps at save and again at generation. These two figures did not, so on
   * Amos Capital Fund — $5.50/W flat, fee and adders included — adding a $2,550
   * trenching adder to an 11 kW deal moved the strip's payment from $168.13 to
   * $188.60 while the Amos card six inches above it went on saying $168.13, and
   * the banner offered to save a $67,896 contract the server was only ever
   * going to write as $60,526. Under a flat partner extra work comes out of the
   * company's side and the homeowner's payment does not move at all, which is
   * the whole reason a rep quotes one.
   *
   * Same inputs as the matching column in `compareOffers`, deliberately: one
   * base, one fee off the same rate-sheet row, one adder total, one partner
   * rule. That is what makes the strip and the card agree by construction
   * rather than by coincidence.
   */
  const livePrice = React.useMemo(() => {
    if (!isPurchase || stickerPpwCents == null) return null;

    // Same ladder, a different unit. `stickerPpwCents` holds a rate per unit
    // either way — the state is unit-agnostic because the conversion helpers
    // are, and one price box beats two that can disagree.
    if (isStorage) {
      if (!(batteryQty > 0)) return null;
      return priceStorageStored({
        product,
        batteryQty,
        stickerPricePerBatteryCents: stickerPpwCents,
        dealerFeePct: Number.isFinite(feePct) ? feePct : 0,
        adderTotalCents,
        onTopAdderTotalCents,
        maxFinalPricePerBatteryCents: quotedLender?.maxFinalPricePerBatteryCents ?? null,
        finalBatteryPriceMode: quotedLender?.finalBatteryPriceMode ?? "cap",
        batteryPriceBasis: chosen?.batteryPriceBasis,
      });
    }

    if (!(systemSizeKwDc > 0)) return null;
    return priceStoredPurchase({
      product,
      systemSizeKwDc,
      stickerPpwCents,
      dealerFeePct: Number.isFinite(feePct) ? feePct : 0,
      adderTotalCents,
      onTopAdderTotalCents,
      batteryPriceCents,
      maxFinalPpwCents: quotedLender?.maxFinalPpwCents ?? null,
      finalPpwMode: quotedLender?.finalPpwMode ?? "cap",
      ppwBasis: chosen?.ppwBasis,
    });
  }, [
    isPurchase, isStorage, batteryQty, product, systemSizeKwDc, stickerPpwCents, feePct,
    adderTotalCents, onTopAdderTotalCents, batteryPriceCents,
    quotedLender?.maxFinalPpwCents, quotedLender?.finalPpwMode,
    quotedLender?.maxFinalPricePerBatteryCents, quotedLender?.finalBatteryPriceMode,
    chosen?.ppwBasis, chosen?.batteryPriceBasis,
  ]);

  /**
   * What this deal costs a month, live, before anything is saved.
   *
   * Mirrors the server rather than reading a stored figure: the rep moves the
   * price, the payment moves with it, and Save then writes the same numbers
   * because both sides compute them the same way.
   */
  /**
   * THE PRICE THE DOCUMENT WILL QUOTE.
   *
   * The same figure `priceOption` arrives at during generation, read here so
   * the strip in front of a rep cannot disagree with the proposal. The last
   * time this screen priced a partner's deal by its own arithmetic instead of
   * the server's it quoted $67,896 under a shelf of cards saying $60,500 — see
   * `livePrice` above, which exists because of exactly that.
   */
  const documentPriceCents = livePrice?.breakdown.contractPriceCents ?? null;

  /**
   * THE CREDITS THIS DEAL EARNS, as the card below and the document both draw
   * them — resolved here because the strip now quotes a payment off the bottom
   * of them.
   *
   * Same call, same inputs as `CreditClaimsCard`: one ladder on the screen, so
   * the strip's second payment cannot be quoted on a net cost the card next to
   * it is not showing.
   */
  /**
   * THE CLOSING CREDIT ON THE DEAL'S OWN PARTNER, resolved once here and
   * handed to both the ladder and the card, so the two cannot differ.
   *
   * The rep's typed figure only survives on a partner with no rule; a fixed
   * partner gives its own figure, and one that gives away everything over a
   * cap derives it from the system price as it stands this second — which is
   * why this sits with the live price rather than on the server.
   */
  const arrayPrice =
    livePrice && "systemWatts" in livePrice.breakdown ? livePrice.breakdown : null;

  const signToday = resolveSignToday({
    rule: quotedLender
      ? {
          mode: quotedLender.signTodayMode,
          fixedCents: quotedLender.signTodayFixedCents,
          capPpwCents: quotedLender.signTodayCapPpwCents,
        }
      : null,
    // A storage-only deal is priced per battery and has no installed watts at
    // all, so there is no system price for a per-watt cap to be measured over.
    // The resolver answers "nothing" to that, which is the right answer: a
    // Powerwall order is hardware at catalogue price, not margin.
    systemPriceCents: arrayPrice?.baseStickerCents ?? 0,
    // Storage counts: the household signs for it, and a per-watt promise that
    // steps around it is not a promise about the figure they land on.
    batteryPriceCents: arrayPrice?.batteryPriceCents ?? 0,
    systemWatts: arrayPrice?.systemWatts ?? 0,
    // The live tick-boxes, so the figure moves the moment a rep unticks a
    // bonus this job does not earn.
    creditRates,
    creditClaims,
    typedCents: signTodayCreditCents,
  });

  const liveLadder =
    isPurchase && livePrice
      ? buildCreditLadder({
          contractValueCents: livePrice.breakdown.contractPriceCents,
          quotedPriceCents: livePrice.breakdown.contractPriceCents,
          rates: creditRates,
          claims: creditClaims,
          signTodayCreditCents: signToday.cents,
        })
      : null;

  const quote = React.useMemo(() => {
    const contractNow = chosen ? documentPriceCents : null;

    // The whole contract is financed. Nothing on this screen takes money off
    // the top, so the principal IS the price — see the note where the approved
    // loan terms used to be.
    const factors =
      isLoan && chosen && contractNow != null && hasPaymentFactor(chosen)
        ? factorQuote(chosen, Math.round(contractNow))
        : null;

    if (!chosen) return null;

    if (product === "lease" && chosen.leaseRateCentsPerKwMonth != null) {
      return {
        monthlyCents: leaseMonthlyCents(chosen.leaseRateCentsPerKwMonth, systemSizeKwDc),
        fromFactor: false,
        factors: null,
        // A lease never owns the array, so it never claims a credit on one.
        withoutCreditsMonthlyCents: null,
        netCostAfterCreditsCents: null,
      };
    }
    if (product === "ppa") return null; // priced per kWh produced, not per month
    if (!isLoan || contractNow == null) return null;

    // A PUBLISHED payment factor outranks our amortisation. The factor already
    // carries the fee and whatever promotional structure the program has, so it
    // does not equal `loanPaymentCents` for the same APR and term — and quoting
    // the derived figure when the lender printed a factor misquotes the
    // customer. Programs with no factor on file fall through unchanged.
    const contractMonthlyCents =
      (factors && factorMonthlyCents(factors)) ??
      loanPaymentCents({
        principalCents: contractNow,
        aprPct: chosen.aprPct,
        termMonths: chosen.termMonths,
      });
    if (contractMonthlyCents == null) return null;

    /**
     * The same terms, asked about what is left once the household claims its
     * credits — and THIS is the payment the deal quotes, because the credits
     * come off the price and what the household finances is the remainder.
     *
     * Dropped where it is not BELOW the contract payment: on a partner
     * programme the ladder hands the remainder back and lands exactly on the
     * price that payment already came off, and the same number twice under two
     * names reads as a second, different loan.
     */
    const netMonthly =
      liveLadder != null ? programmeMonthlyCents(chosen, liveLadder.netCostCents) : null;
    const creditsApply = netMonthly != null && netMonthly < contractMonthlyCents;

    /**
     * THE FACTOR ROWS FOLLOW THE PRINCIPAL THE HEADLINE CAME OFF.
     *
     * "With paydown / If the paydown is skipped" are the published factors read
     * against the money being borrowed. Left on the whole contract while the
     * headline moved to the net, they would put two payments on one strip that
     * no single principal explains — the exact failure `monthlyReconciles`
     * exists to catch on the document.
     */
    const quotedFactors =
      creditsApply && hasPaymentFactor(chosen)
        ? factorQuote(chosen, Math.round(liveLadder!.netCostCents))
        : factors;

    return {
      monthlyCents: creditsApply ? netMonthly : contractMonthlyCents,
      /** True when the figure came off the sheet rather than out of a formula. */
      fromFactor: quotedFactors != null && factorMonthlyCents(quotedFactors) != null,
      factors: quotedFactors,
      /** The deal with no credit ever claimed — printed under the quote. */
      withoutCreditsMonthlyCents: creditsApply ? contractMonthlyCents : null,
      netCostAfterCreditsCents: creditsApply ? liveLadder!.netCostCents : null,
    };
  }, [chosen, product, isLoan, systemSizeKwDc, documentPriceCents, liveLadder]);

  /**
   * What the boxes above currently add up to. Purchase only — see solar-money.
   *
   * The SAME capped figure the payment is quoted off, because this one is
   * compared against the stored contract to decide whether the deal has
   * unsaved changes. Priced without the partner's rule it could never equal
   * what the server writes — `financeRowForProduct` caps on the way in — so on
   * a flat partner "Saved at $60,500, this quote comes to $67,896" stayed on
   * the screen through every save, and the one signal a rep has that the price
   * has moved became a permanent fixture.
   */
  const liveContractCents = livePrice?.breakdown.contractPriceCents ?? null;

  // A blank box means "not set" (null); a typed "0" is a real zero and is sent
  // as one. `form.x ? … : null` is safe here ONLY because these are STRINGS —
  // "0" is truthy — which is exactly why the read side above needs its own
  // null-vs-zero helper rather than the same-looking ternary.
  const numOrNull = (s: string, scale = 1) =>
    s.trim() === "" ? null : Math.round(Number(s) * scale);
  const rawOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

  async function save() {
    // Catch a non-numeric entry here rather than posting NaN and getting the
    // generic "Invalid financing." back with no idea which box was wrong.
    const bad = Object.entries(form).find(
      ([, v]) => v.trim() !== "" && !Number.isFinite(Number(v))
    );
    if (bad) return toast.error(`"${bad[1]}" is not a number.`);

    // An empty price box is not a price of zero, and it must not be saved as
    // one: sending no sticker lets the server fall back to the company default,
    // which would quietly write $3.50/W over a rep who had just cleared the
    // field on purpose.
    if (isPurchase && stickerPpwCents == null) {
      return toast.error("Set a base price for the system before saving.");
    }

    setBusy(true);
    const res = await saveSolarFinanceAction({
      leadId,
      product,
      // The STICKER, not the base: `grossPpwCents` is what the customer is
      // quoted, and the base is recovered from it and the fee on the way back
      // in. Sent explicitly so the server keeps this price rather than deriving
      // the company default over the top of it.
      // A storage deal's rate is per BATTERY, and it has its own column: one
      // sticker in grossPpwCents would be read back as $/W by every screen and
      // every payroll run that prices a saved deal.
      grossPpwCents: isStorage ? undefined : (stickerPpwCents ?? undefined),
      stickerPricePerBatteryCents: isStorage ? (stickerPpwCents ?? undefined) : undefined,
      // Zeroed rather than left stale: pricePurchase ignores a cash deal's
      // fee, but the row should not carry one a lender never charged.
      dealerFeePct: isCash ? 0 : rawOrNull(form.dealerFeePct) ?? undefined,
      rateMillsPerKwh: numOrNull(form.rate, 1000),
      monthlyPaymentCents: numOrNull(form.monthly, 100),
      escalatorPct: rawOrNull(form.escalatorPct),
      termYears: rawOrNull(form.termYears),
      aprPct: rawOrNull(form.aprPct),
      loanTermMonths: rawOrNull(form.loanTermMonths),
      // Down payment and the lender's own monthly are deliberately NOT sent,
      // which CLEARS them on the row: nothing on this screen — or any other —
      // sets either any more, and a figure no interface can reach quietly
      // steering the customer's payment is exactly what was removed. Neither
      // has ever been filled in on a real deal, so there is nothing to lose;
      // saving a row written before the form went is what clears it.
      lenderProductId: lenderProductId || null,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    // Re-seed from what was actually STORED, not from what we hoped we sent.
    // A field the server gated off for this product (a lease has no APR) empties
    // here immediately, instead of looking saved until the next hard reload.
    if ("finance" in res && res.finance) {
      setForm(seed(res.finance));
      setProduct(res.finance.product);
      setLenderProductId(res.finance.lenderProductId ?? "");
      const storedSticker = isStorage
        ? res.finance.stickerPricePerBatteryCents
        : res.finance.grossPpwCents;
      if (storedSticker > 0) {
        setBasePpwCents(
          Math.round(storedSticker * (1 - (res.finance.dealerFeePct ?? 0) / 100))
        );
      }
    }
    toast.success("Financing saved");
    router.refresh();
  }

  const dirty = finance != null && liveContractCents != null && finance.contractPriceCents !== liveContractCents;

  return (
    <div className="space-y-6">
      {/* DIRECT SUBMISSION USED TO SIT HERE, as a "Send to <lender>" card above
          the price. It moved onto the customer's proposal, behind the Qualify
          button — a credit application is the household's own act, and every
          partner issues its own API key, so this was never a card about one
          lender. See `components/proposal/qualify-button.tsx`. The rep still
          sees why a deal cannot be applied to, on the proposal preview. */}

      {/* WHAT WE CHARGE, first, above everything derived from it. The step used
          to open on a shelf of lender cards and put the price below the
          comparison — a rep scrolled past every figure derived from the price
          before reaching the price itself. */}
      {isStorage ? (
        <StoragePriceCard
          batteryQty={batteryQty}
          basePerBatteryCents={basePpwCents}
          quotedFeePct={chosen && !isCash ? chosen.dealerFeePct : null}
          quotedMaxFinalPerBatteryCents={quotedLender?.maxFinalPricePerBatteryCents ?? null}
          quotedFinalBatteryPriceMode={quotedLender?.finalBatteryPriceMode ?? "cap"}
          quotedBatteryPriceBasis={chosen?.batteryPriceBasis ?? "final"}
          quotedMinBasePerBatteryCents={isCash ? null : (quotedLender?.minBasePricePerBatteryCents ?? null)}
          quotedLabel={quotedLender?.name ?? null}
          adderTotalCents={adderTotalCents}
          onTopAdderTotalCents={onTopAdderTotalCents}
          canEdit={canEdit}
          onChange={setBasePpwCents}
        />
      ) : (
      <SystemPriceCard
        systemSizeKwDc={systemSizeKwDc}
        basePpwCents={basePpwCents}
        defaultPpwCents={defaultBasePpwCents}
        adderTotalCents={adderTotalCents}
        onTopAdderTotalCents={onTopAdderTotalCents}
        batteryPriceCents={batteryPriceCents}
        batteryLabel={batteryLabel}
        batteryQty={batteryQty}
        quotedFeePct={chosen && !isCash ? chosen.dealerFeePct : null}
        // The ceiling belongs to the partner, so it is read off the LENDER the
        // chosen programme was published by — never off the programme row — and
        // off the one `quotedLender` already resolved, so this card and the
        // payment below it cannot be holding two different partners' rules.
        quotedMaxFinalPpwCents={quotedLender?.maxFinalPpwCents ?? null}
        // Read the same way and from the same row: a mode without its figure
        // is not a pricing rule, and the two arriving from different places is
        // how one of them goes stale.
        quotedFinalPpwMode={quotedLender?.finalPpwMode ?? "cap"}
        // Which price that figure fixes is the chosen PROGRAMME's to say.
        quotedPpwBasis={chosen?.ppwBasis ?? "final"}
        // The floor is the partner's too, and read the same way. Cash has no
        // lender and therefore no floor — the company band is all that guards
        // it, which is what "no lender" has always meant here.
        quotedMinBasePpwCents={quotedLender?.minBasePpwCents ?? null}
        quotedLabel={
          chosen ? [lender?.name, chosen.name].filter(Boolean).join(" · ") || lenderProductLabel(chosen) : null
        }
        canEdit={canEdit}
        onChange={setBasePpwCents}
      />
      )}

      {/* WHAT THIS PROPOSAL CLAIMS ON THE HOUSEHOLD'S TAX RETURN. Directly
          under the price, because the credits come off the price — and on
          every purchase deal, because every purchase deal makes the claim. */}
      {isPurchase && livePrice && (
        <CreditClaimsCard
          leadId={leadId}
          customerContractCents={livePrice.breakdown.contractPriceCents}
          creditRates={creditRates}
          claims={creditClaims}
          signTodayCreditCents={signTodayCreditCents}
          signToday={signToday}
          lenderName={quotedLender?.name ?? null}
          canEdit={canEdit}
        />
      )}

      {/* Adders are LINES, not a box. The old "Adders $" field could not say
          what the money was for and went stale every time the array changed —
          see SolarAddersPanel. Directly under the price because they are the
          other half of the contract total the card above prints. */}
      <SolarAddersPanel
        leadId={leadId}
        canEdit={canEdit}
        catalogue={adderCatalogue}
        lines={adderLines}
        systemWatts={Math.round(systemSizeKwDc * 1000)}
        storedTotalCents={(finance?.adderTotalCents ?? 0) + (finance?.onTopAdderTotalCents ?? 0)}
      />

      {/* The rate sheets ARE the interface. Four abstract product types used to
          sit here instead, which put the actual offers two dropdowns deep and
          made "which of these is cheaper" a question the screen could not
          answer. */}
      {/* Only the "lenders exist, but none of them has a rate sheet" case.
          FinanceOffers carries its own note for having no lenders at all, and
          two amber boxes stacked saying almost the same thing reads as two
          separate problems. */}
      {lenders.length > 0 && offers.length === 0 && (
        <Notice tone="warn">
          <strong>No lender programmes are loaded yet</strong>, so there is nothing to compare
          against cash. Adding each partner&apos;s terms once turns this step into a shelf of
          every programme priced against this system, side by side, with the monthly payment
          on each.{" "}
          <Link
            href="/portal/settings/solar-lenders"
            className="font-medium underline underline-offset-2"
          >
            Add a lender and its rate sheet
          </Link>
          .
        </Notice>
      )}

      <FinanceOffers
        lenders={lenders}
        products={offers}
        basis={basis}
        shortlist={shortlist}
        onToggle={toggleShortlist}
        quotedId={quotedId}
        onQuote={quoteOffer}
        canEdit={canEdit || lenderBusy}
        onOpenDesign={onOpenDesign}
      />

      {/* What the deal is quoted on right now, in one strip: the programme, its
          terms, the payment, and — when the sheet publishes factors — both
          versions of it, never just the flattering one. */}
      {quote && (
        <section className="rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              {lender && <LenderMark name={lender.name} logoUrl={lender.logoUrl} size="sm" />}
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">
                  {chosen ? lenderProductLabel(chosen) : "Cash"}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {quote.fromFactor
                    ? "From the rate sheet's payment factor, the lender's own published figure."
                    : "Amortised from the programme's APR and term."}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Monthly
              </div>
              <div className="font-display text-2xl font-semibold tabular-nums">
                ${(quote.monthlyCents / 100).toFixed(2)}
              </div>
              {/* Both payments, in the order the customer's own document says
                  them: what they are quoted — the credits this job earns
                  already against the loan — and what it costs if they never
                  claim them. Muted, because the second figure is the higher
                  one. */}
              {quote.withoutCreditsMonthlyCents != null && (
                <div className="text-[11px] tabular-nums text-muted-foreground">
                  ${(quote.withoutCreditsMonthlyCents / 100).toFixed(2)}/mo without the tax credit
                </div>
              )}
            </div>
          </div>

          {/* The terms this payment came off, stated, with the dealer portal on
              the same line: they belong to the rate sheet and are not set here
              — see where the "Approved loan terms" form used to be. Running
              credit is the next thing a rep does once a programme is quoted,
              so it sits on the programme rather than in a card of its own. */}
          {chosen && isLoan && (
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-border/70 px-4 py-2 text-[11px] text-muted-foreground">
              <span>
                {[
                  chosen.aprPct != null ? `${chosen.aprPct}% APR` : null,
                  chosen.termMonths ? `${chosen.termMonths} months` : null,
                  chosen.dealerFeePct != null ? `${chosen.dealerFeePct}% dealer fee` : null,
                  quotedFlatPpwCents != null
                    ? `$${(quotedFlatPpwCents / 100).toFixed(2)}/W flat`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              {lender?.portalUrl && (
                <a
                  href={lender.portalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
                >
                  Run credit at {lender.name} <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          )}

          {/* Both payments: the low figure is conditional on a paydown the
              customer has to actually make, and a customer who never applies
              the credit finds out from a bank statement. */}
          {quote.factors && (
            <dl className="grid gap-x-6 gap-y-1 border-t border-border/70 bg-muted/20 px-4 py-2.5 text-[11px] sm:grid-cols-3">
              {quote.factors.withPaydownMonthlyCents != null && (
                <FactorLine
                  label="With paydown"
                  sub={`× ${formatFactor(chosen?.factorWithPaydownMicros)}`}
                  value={`$${(quote.factors.withPaydownMonthlyCents / 100).toFixed(2)}/mo`}
                />
              )}
              {quote.factors.withoutPaydownMonthlyCents != null && (
                <FactorLine
                  label="Without paydown"
                  sub={`× ${formatFactor(chosen?.factorWithoutPaydownMicros)}`}
                  value={`$${(quote.factors.withoutPaydownMonthlyCents / 100).toFixed(2)}/mo`}
                />
              )}
              {quote.factors.paydownCents != null && quote.factors.paydownMonths != null && (
                <FactorLine
                  label={`Paydown due by month ${quote.factors.paydownMonths}`}
                  sub={`${quote.factors.paydownPct}% of the loan`}
                  value={money(quote.factors.paydownCents)}
                />
              )}
            </dl>
          )}

          {/* Folded, because it is a procedure a rep reads once and then knows,
              and an open block of it would push the payment off the screen. */}
          {isLoan && lender?.creditInstructions && (
            <details className="border-t border-border/70 px-4 py-2">
              <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
                How to run credit at {lender.name}
              </summary>
              <p className="mt-1.5 whitespace-pre-wrap text-[11px] text-muted-foreground">
                {lender.creditInstructions}
              </p>
            </details>
          )}
        </section>
      )}

      {/* A LOAN'S TERMS ARE NOT SET HERE, so there is no form for them.

          A five-box "Approved loan terms" card used to sit at this point: the
          dealer fee, the APR and the term, then a down payment and the
          lender's own monthly from the approval. Every one of the first three
          came off the rate-sheet row and was overwritten on save whatever a
          rep typed, so they were reduced to a statement — and the statement now
          rides on the quoted strip above, where the payment it explains is.

          The last two went with them. Nobody had ever filled either in: solar
          is sold financed in full, so there is no down payment, and the
          payment a customer is quoted comes from the lender's own published
          factor, which is the lender's figure already. A pair of empty boxes
          asking a rep to re-key an approval that never arrives is not a
          safeguard, it is a form nobody can finish.

          What was genuinely only reachable from that card — the dealer portal
          and how to run credit at this partner — moves to the strip above,
          next to the programme it belongs to. */}

      {/* A lease's monthly, its escalator, its term and a PPA's $/kWh used to be
          four boxes here for a rep to type into. They are not this screen's to
          set: every one of them is published on the lender's rate sheet, is
          filled in by quoting the programme, and is what the customer signs.
          Leaving them editable meant a proposal could go out on an escalator no
          lender had ever issued. Change the terms on the rate sheet; the quote
          follows. */}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />} Save financing
          </Button>
          {dirty && (
            <p className="text-[11px] text-muted-foreground">
              Saved at {money(finance!.contractPriceCents)} — this quote comes to{" "}
              <span className="font-medium tabular-nums text-foreground">
                {money(liveContractCents!)}
              </span>
              .
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** One published factor and what it makes the payment. */
function FactorLine({ label, sub, value }: { label: string; sub: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 sm:block">
      <dt className="text-muted-foreground">
        {label} <span className="opacity-70">{sub}</span>
      </dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * A coloured aside. One component so amber never drifts between two shades and
 * the dark-mode pairing is written once rather than in every call site.
 */
function Notice({ tone, children }: { tone: "warn" | "info"; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "max-w-3xl rounded-lg border px-3 py-2.5 text-sm",
        tone === "warn"
          ? "border-amber-300/70 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
          : "border-border bg-muted/40 text-muted-foreground"
      )}
    >
      {children}
    </p>
  );
}

/**
 * The gate between a design and a customer-facing proposal.
 *
 * Phase 5 builds the proposal itself; what matters here is that generation is
 * already blocked on the validation rules, so the builder inherits the guard
 * rails rather than bolting them on afterwards.
 */
/**
 * IS THIS APPROVED VERSION MISSING A COPY IT IS SUPPOSED TO HAVE?
 *
 * One copy on an ordinary document, two on one that earns federal credits — the
 * deal with them applied, and the same signature on the deal at par. The pair
 * is filed atomically, so a missing first half means the render failed and a
 * missing second half means this version was approved before par copies
 * existed. Both read the same way to a rep: the folder does not yet hold what
 * this row says it does.
 */
function incompleteCopies(v: ProposalVersion): boolean {
  if (!v.approvedFileId) return true;
  return !!v.hasCreditSwitch && !v.approvedParFileId;
}

export type ProposalVersion = {
  id: string;
  leadId: string;
  version: number;
  status: string;
  /** NULL until the proposal is sent — an unsent one has no public link. */
  publicToken: string | null;
  /** The name the customer signed under, for the row. Null until signed. */
  signerName: string | null;
  supersededAt: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  signedAt: string | null;
  createdAt: string;
  /** Whether the customer's copy carries the year-by-year comparison. */
  showComparison: boolean;
  /** Set on the ONE version this deal sold. See setProposalApprovalAction. */
  approvedAt: string | null;
  /** Who approved it, for the badge. Null when nobody has. */
  approvedByName: string | null;
  /**
   * The PDF filed into the deal's Proposal folder. Null on an unapproved
   * version — and also on an approved one whose render failed, which is the
   * state the retry affordance reads.
   */
  approvedFileId: string | null;
  /**
   * The SECOND filed copy — the same signed document read at par, with none of
   * the federal credits applied. Null on a version with nothing to claim, which
   * files one copy, and on every version approved before both were filed.
   */
  approvedParFileId?: string | null;
  /**
   * Whether this version's document has two readings to file: the option it
   * opens on carries a credits-applied scenario beside the one at par.
   */
  hasCreditSwitch?: boolean;
  /**
   * WHETHER THIS VERSION WENT TO THE LENDER, and how they answered.
   *
   * Absent on a version nobody has submitted, and also on one submitted before
   * attempts recorded which document they spoke for — see the `proposalId`
   * column on SolarLenderSubmission. Both read the same way here: no badge,
   * which claims nothing rather than claiming the wrong thing.
   */
  lender?: {
    name: string;
    ok: boolean;
    at: string;
    referenceNumber: string | null;
    message: string | null;
  } | null;
};

export function SolarProposalGate({
  leadId,
  customerEmail,
  customerPhone,
  versions,
  canEdit,
  canApprove = false,
  onOpenStep,
}: {
  leadId: string;
  /** Where the proposal can be sent. Null means nowhere. */
  customerEmail: string | null;
  customerPhone: string | null;
  versions: ProposalVersion[];
  canEdit: boolean;
  /** Whether this user may declare which version the deal sold. Admins only. */
  canApprove?: boolean;
  /** Sends the rep to the builder step that fixes a finding. See ValidationList. */
  onOpenStep?: (step: BuilderStep) => void;
}) {
  const [issues, setIssues] = React.useState<ValidationIssue[] | null>(null);
  const [canGen, setCanGen] = React.useState<boolean | null>(null);
  const [busy, setBusy] = React.useState(false);
  const router = useRouter();

  // Versions arrive newest-first, so the first one still standing is the one
  // this deal is actually quoting.
  const current = versions.find((v) => !v.supersededAt) ?? null;

  async function generate() {
    setBusy(true);
    const res = await generateSolarProposalAction(leadId);
    setBusy(false);
    if (!res.ok) {
      // Blocking issues are surfaced inline rather than as a bare toast — the
      // rep needs to know WHAT to fix, not just that it failed.
      if ("issues" in res && res.issues) {
        setIssues(res.issues);
        setCanGen(false);
      }
      return toast.error(res.error);
    }
    toast.success(`Proposal v${res.version} generated`);
    router.refresh();
  }

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
      {/* "Generate" said nothing about what it produced or who saw it. What this
          step actually does is freeze the design, the usage and the money into a
          numbered version with its own link — which is the sentence a rep needs
          before pressing it, not after. */}
      <p className="text-sm text-muted-foreground">
        This takes everything set on the four steps above — the array, the usage, the lender and
        the price — and freezes it into a numbered version with its own customer link. Later edits
        do not change a version that has gone out; they make the next one.
      </p>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={check} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Sun className="size-4" />}
          Check it is ready
        </Button>
        {canGen === true && <span className="text-xs text-emerald-600">Ready to generate</span>}
        {canGen === false && <span className="text-xs text-red-600">Blocked — fix the issues below</span>}
      </div>
      {issues && <ValidationList issues={issues} onOpenStep={onOpenStep} />}
      {issues && issues.length === 0 && (
        <p className="text-xs text-muted-foreground">No issues found.</p>
      )}

      {canEdit && (
        <Button size="sm" onClick={generate} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Sun className="size-4" />}
          Create the customer&apos;s proposal
        </Button>
      )}

      {/* Share the CURRENT version — the newest one that has not been replaced.
          A superseded version is not offerable: sending an old quote to a
          homeowner is the one thing versioning exists to prevent. */}
      {current && (
        <SolarSharePanel
          proposalId={current.id}
          leadId={leadId}
          version={current.version}
          customerEmail={customerEmail}
          customerPhone={customerPhone}
          publicToken={current.publicToken}
          sentAt={current.sentAt}
          viewedAt={current.viewedAt}
          signedAt={current.signedAt}
          showComparison={current.showComparison}
          canEdit={canEdit}
        />
      )}

      <ProposalVersionList versions={versions} canEdit={canEdit} canApprove={canApprove} />
    </div>
  );
}

/**
 * The versions of a proposal, and the three things you can still do to one:
 * open it as the customer sees it, record that it went out, and say which one
 * this deal actually sold.
 *
 * Shared with the deal page's Proposal card — generating a proposal happens in
 * the builder, but READING one is exactly what you want from the deal, and two
 * copies of this list would drift.
 */
export function ProposalVersionList({
  versions,
  canEdit,
  canApprove = false,
}: {
  versions: ProposalVersion[];
  canEdit: boolean;
  /**
   * Whether this user may declare the final version. Admins only — the same
   * authority that marks a panel layout final.
   *
   * Everyone still SEES the approved badge. Which proposal the company sold is
   * not privileged information; deciding it is.
   */
  canApprove?: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = React.useState<string | null>(null);

  /** The one version this deal sold, once that has been decided. */
  const approved = versions.find((v) => v.approvedAt);

  /**
   * A deal that has been re-priced a dozen times has a dozen versions, and the
   * list is read for at most two of them: the one being quoted now and the one
   * that sold. The rest are history, so they start folded away.
   */
  const [expanded, setExpanded] = React.useState(false);

  /**
   * File the approved copy that has none — without anybody pressing Retry.
   *
   * An approved version with no `approvedFileId` is a deal whose Proposal
   * folder is empty, and there are now two ordinary ways to arrive there. The
   * customer SIGNING approves their version and cannot render a PDF while they
   * wait (the renderer boots a browser; the signature must not queue behind
   * it), and a render that failed leaves the same state. Both used to sit there
   * until an admin noticed the amber line and pressed Retry. Nobody was ever
   * going to.
   *
   * So the first person who opens the deal WITH THE AUTHORITY TO APPROVE
   * renders it. Same route, same permission, same failure path as the button —
   * this only removes the press. Gated on `canApprove` because the route
   * refuses anyone else, and once per mount by the ref so a render that fails
   * costs one attempt per page rather than a loop.
   */
  const autoFiled = React.useRef<string | null>(null);
  React.useEffect(() => {
    // A PAIR is incomplete until both halves are there. That also self-heals
    // the versions approved before the par copy existed: the next person to
    // open the deal files the missing half without pressing anything.
    if (!canApprove || !approved || !incompleteCopies(approved)) return;
    if (autoFiled.current === approved.id) return;
    autoFiled.current = approved.id;
    const id = approved.id;
    setBusyId(id);
    void (async () => {
      try {
        // Silent on failure: nobody asked for this, so it must not interrupt
        // whatever they came to the deal to do. The row keeps saying "Copy not
        // filed" with its Retry, which is the honest state.
        if (!(await postFileCopy(id))) router.refresh();
      } finally {
        setBusyId((current) => (current === id ? null : current));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canApprove, approved?.id, approved?.approvedFileId, approved?.approvedParFileId]);

  // Folded, the list keeps the newest few — plus the approved version wherever
  // it fell, because "which one did we sell" is the whole reason to open this.
  const COLLAPSED = 3;
  // Folding one row away is not worth a control, so the fold only appears when
  // it actually buys something.
  const foldable = versions.length > COLLAPSED + 1;
  const shown = React.useMemo(() => {
    if (expanded || !foldable) return versions;
    const head = versions.slice(0, COLLAPSED);
    // Appended, not sorted in: versions are newest-first and anything below the
    // cut is older than everything above it, so the order still holds.
    if (approved && !head.some((v) => v.id === approved.id)) head.push(approved);
    return head;
  }, [versions, expanded, foldable, approved]);
  const hidden = versions.length - shown.length;

  if (versions.length === 0) return null;

  /**
   * Render the approved copy into the deal's Proposal folder.
   *
   * A plain POST rather than a Server Action: the render boots Chromium, and
   * that browser is 66MB traced into whichever function reaches it — as an
   * action it landed in both pages that show this list. See the route.
   *
   * Returns the error text rather than toasting, so the two callers (approve,
   * and Retry) can each say the right thing about it.
   */
  async function postFileCopy(proposalId: string): Promise<string | null> {
    try {
      const res = await fetch(`/api/solar/proposals/${proposalId}/file-copy`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !body?.ok) return body?.error || `The copy could not be rendered (${res.status}).`;
      return null;
    } catch {
      return "The copy could not be rendered — the request did not complete.";
    }
  }

  async function setApproval(v: ProposalVersion, next: boolean) {
    // Approving while another version holds the approval MOVES the filed copy
    // out of the deal's Proposal folder. That is not visible from a button
    // labelled "Approve", so it gets asked about rather than done quietly.
    if (next && approved && approved.id !== v.id) {
      const ok = window.confirm(
        `v${approved.version} is currently the approved proposal. Approving v${v.version} replaces it, and swaps the copy filed on this deal.`
      );
      if (!ok) return;
    }

    setBusyId(v.id);
    try {
      const res = await setProposalApprovalAction(v.id, next);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (!next) {
        toast.success(`v${v.version} is no longer the approved proposal`);
        router.refresh();
        return;
      }

      // Approved. The copy is a separate, slower step that is allowed to fail
      // without taking the decision down with it — so the list refreshes first
      // and the badge appears immediately, then the PDF fills in.
      router.refresh();
      const fileError = await postFileCopy(v.id);
      if (fileError) {
        // Said plainly: the folder will be empty, and a silent success would be
        // a lie about it.
        toast.warning(`v${v.version} approved, but the PDF could not be filed.`, {
          description: "Use Retry on the row to try again.",
        });
      } else {
        toast.success(
          v.hasCreditSwitch
            ? `v${v.version} approved — both PDFs are in the Proposal folder`
            : `v${v.version} approved — the PDF is in the Proposal folder`
        );
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function refile(v: ProposalVersion) {
    setBusyId(v.id);
    try {
      const fileError = await postFileCopy(v.id);
      if (fileError) return toast.error(fileError);
      toast.success(
        v.hasCreditSwitch ? "Both copies filed into Proposal" : "Filed into the Proposal folder"
      );
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Versions
          <span className="ml-1.5 font-normal normal-case tracking-normal">({versions.length})</span>
        </div>
        {foldable && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {expanded ? "Show fewer" : `Show all ${versions.length}`}
            <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
          </button>
        )}
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {shown.map((v) => {
          const isApproved = !!v.approvedAt;
          const busy = busyId === v.id;
          const standing = proposalVersionStanding(v);
          return (
            <li
              key={v.id}
              className={cn(
                "flex flex-wrap items-center gap-2 p-2.5 text-sm",
                // The approved row is the answer to the question the list is
                // read for, so it is findable without reading every row.
                isApproved && "bg-emerald-50/60"
              )}
            >
              <span className="font-medium">v{v.version}</span>
              {/* Where this document stands, in one word. The precedence — and
                  why "sent" and "viewed" both read as pending — is argued in
                  proposalVersionStanding. */}
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-medium",
                  STANDING_TONE[standing.tone]
                )}
              >
                {standing.label}
              </span>
              {v.signedAt && v.supersededAt && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  superseded
                </span>
              )}

              {/* Deliberately its own badge rather than a replacement for the
                  status one. "Approved" and "superseded" are both true of the
                  common case — the deal was sold on v7 and three scenarios were
                  run afterwards — and collapsing them would hide one. */}
              {isApproved && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
                  <BadgeCheck className="size-3" /> Approved
                </span>
              )}

              {/* WHETHER THE LENDER GOT THIS ONE. A deal re-priced four times
                  can only have been submitted at one of those prices, and
                  "sent to the lender" said of the DEAL cannot say which. Said
                  of the row, it can. Its own badge for the same reason Approved
                  is: it is a different claim from where the customer's
                  signature stands, and both are true at once on a live deal. */}
              {v.lender && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                    v.lender.ok
                      ? "bg-indigo-100 text-indigo-700"
                      : "bg-red-100 text-red-700"
                  )}
                  title={
                    v.lender.ok
                      ? `Submitted ${new Date(v.lender.at).toLocaleString()}${
                          v.lender.referenceNumber ? ` · ref ${v.lender.referenceNumber}` : ""
                        }`
                      : v.lender.message ?? "The lender did not accept this submission."
                  }
                >
                  {v.lender.ok ? <Send className="size-3" /> : <TriangleAlert className="size-3" />}
                  {v.lender.ok ? `Sent to ${v.lender.name}` : `${v.lender.name} refused it`}
                </span>
              )}

              <span className="flex-1 text-[11px] text-muted-foreground">
                {new Date(v.createdAt).toLocaleDateString()}
                {v.viewedAt ? " · viewed" : ""}
                {v.signedAt
                  ? ` · signed by ${v.signerName ?? "the customer"} ${new Date(v.signedAt).toLocaleDateString()}`
                  : ""}
                {/* No approver name on an approved version means nobody
                    pressed anything — the customer's signature approved it.
                    See ApprovalActor in proposal-approval.ts. */}
                {isApproved
                  ? v.approvedByName
                    ? ` · approved by ${v.approvedByName}`
                    : " · approved on signature"
                  : ""}
              </span>

              {/* The public link is offered ONLY once the proposal has actually
                  been sent. Before that there is no token and no public surface;
                  reviewing your own work goes through the internal preview, which
                  does not mint a customer view or handle the token. */}
              <Link
                href={`/portal/leads/${v.leadId}/solar-proposal/preview?v=${v.version}`}
                className="text-xs underline underline-offset-2"
              >
                Preview
              </Link>
              {v.publicToken && (
                <a
                  href={`/proposal/${v.publicToken}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs underline underline-offset-2"
                >
                  Customer link
                </a>
              )}

              {/* The filed copies, reachable from the row that caused them.
                  Two on a document that earns credits — the deal as the
                  conversation ended, and the same signature on the deal at par
                  — because whether the credits are ever claimed is not settled
                  on the day anybody signs. */}
              {isApproved && v.approvedFileId && (
                <a
                  href={`/portal/files/${v.approvedFileId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs underline underline-offset-2"
                >
                  PDF in Proposal
                </a>
              )}
              {isApproved && v.approvedParFileId && (
                <a
                  href={`/portal/files/${v.approvedParFileId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs underline underline-offset-2"
                  title="The same signed proposal with no tax credits applied — the larger figure."
                >
                  PDF at par
                </a>
              )}
              {isApproved && incompleteCopies(v) && (
                busy ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />{" "}
                    {v.hasCreditSwitch ? "Filing both copies…" : "Filing the copy…"}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                    <TriangleAlert className="size-3.5" />{" "}
                    {v.hasCreditSwitch && v.approvedFileId ? "Par copy not filed" : "Copy not filed"}
                    {canApprove && (
                      <button
                        className="underline underline-offset-2 disabled:opacity-50"
                        onClick={() => refile(v)}
                      >
                        Retry
                      </button>
                    )}
                  </span>
                )
              )}

              {canEdit && !v.sentAt && !v.supersededAt && (
                <button
                  className="text-xs underline underline-offset-2"
                  title="For a proposal sent some other way — this records the send without delivering anything."
                  onClick={async () => {
                    const res = await markProposalSentAction(v.id);
                    if (!res.ok) return toast.error(res.error);
                    toast.success("Marked as sent");
                    router.refresh();
                  }}
                >
                  Mark sent by hand
                </button>
              )}

              {canApprove && (
                <Button
                  size="sm"
                  variant={isApproved ? "outline" : "secondary"}
                  className="h-7 px-2 text-xs"
                  disabled={busy}
                  onClick={() => setApproval(v, !isApproved)}
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  {isApproved ? "Unapprove" : "Approve"}
                </Button>
              )}
            </li>
          );
        })}
        {hidden > 0 && (
          <li className="p-0">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="flex w-full items-center justify-center gap-1 p-2 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            >
              <ChevronDown className="size-3.5" />
              {hidden} older {hidden === 1 ? "version" : "versions"}
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

/**
 * Badge tones for a version's standing. Kept beside the list rather than
 * imported from the deal card's own map: they answer different questions —
 * that one is about the DEAL, this one about one document — and a shared table
 * would tie the two to each other's palette for no reason.
 */
const STANDING_TONE: Record<"neutral" | "progress" | "ready" | "done", string> = {
  neutral: "bg-muted text-muted-foreground",
  progress: "bg-sky-100 text-sky-700",
  ready: "bg-amber-100 text-amber-800",
  done: "bg-emerald-100 text-emerald-700",
};
