"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2, TriangleAlert, CircleAlert, Sun, ImageUp, Trash2, BadgeCheck, ExternalLink,
} from "lucide-react";
import type { FinanceProduct, MountType } from "@prisma/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  builderStepFromHref,
  groupIssues,
  type BuilderStep,
  type ValidationIssue,
} from "@/lib/solar-validation";
import { panelCount, type LayoutBlock } from "@/lib/solar-layout";
import { SolarLayoutDesigner } from "@/components/portal/solar-layout-designer";
import {
  loanPaymentCents,
  grossPpwFromNet,
  leaseMonthlyCents,
  type YieldAssumptions,
} from "@/lib/solar-money";
import { lenderProductLabel } from "@/lib/solar-lender-product";
import { factorQuote, factorMonthlyCents, hasPaymentFactor, formatFactor } from "@/lib/solar-loan";
import {
  saveSolarDesignAction,
  saveSolarFinanceAction,
  validateSolarDealAction,
} from "@/server/modules/solar/actions";
import {
  generateSolarProposalAction,
  markProposalSentAction,
  uploadPanelLayoutAction,
  removePanelLayoutAction,
  setLayoutApprovalAction,
} from "@/server/modules/solar/proposal-actions";

/**
 * Attach the panel layout drawn in an external design tool.
 *
 * Interim by design: Anexa has no roof designer yet, and a proposal that cannot
 * show a homeowner where the panels go is a weaker document. Explicitly NOT the
 * aerial property photo — a satellite view with no array on it is a picture of a
 * roof, and presenting it as a design is something the customer discovers at the
 * site survey.
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
          No layout attached. The proposal will not show the customer where the panels go — it
          omits the section rather than showing a placeholder.
        </p>
      )}

      {canEdit && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Design tool (optional)"
              value={meta.provider}
              placeholder="e.g. Aurora"
              onChange={(v) => setMeta((m) => ({ ...m, provider: v }))}
            />
            <TextField
              label="Design reference (optional)"
              value={meta.externalRef}
              placeholder="Provider's project id"
              onChange={(v) => setMeta((m) => ({ ...m, externalRef: v }))}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
        </>
      )}
    </section>
  );
}


export type SolarDesignView = {
  utilityProvider: string | null;
  annualUsageKwh: number | null;
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
  dealerFeePct: number;
  adderTotalCents: number;
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

const PRODUCTS: { value: FinanceProduct; label: string; blurb: string }[] = [
  { value: "cash", label: "Cash", blurb: "Priced per watt. No lender, so no dealer fee." },
  { value: "loan", label: "Loan", blurb: "Priced per watt. The dealer fee is embedded in the gross price." },
  { value: "lease", label: "Lease", blurb: "Fixed monthly payment with an annual escalator. No system price." },
  { value: "ppa", label: "PPA", blurb: "Priced per kWh produced, with an annual escalator. No system price." },
];

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
  moduleMm,
  moduleRatingW,
  initialBlocks,
  assumptions,
}: {
  leadId: string;
  design: SolarDesignView;
  canEdit: boolean;
  /** Resolved server-side: the file row AND its bytes both exist. */
  layoutAvailable: boolean;
  canApproveLayout: boolean;
  lat: number | null;
  moduleMm: { widthMm: number; heightMm: number };
  moduleRatingW: number | null;
  initialBlocks: LayoutBlock[];
  /** The company's yield and derate, so the live preview matches the save. */
  assumptions: YieldAssumptions;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({
    mountType: (design?.mountType ?? "roof") as MountType,
  });

  const setMountType = (v: MountType) => setForm({ mountType: v });

  // Counted from the geometry, the same way the server counts it on save —
  // never read back off `design.moduleQty`, which is only ever a cached copy.
  const drawnPanels = panelCount(initialBlocks);
  const staleCount = (design?.moduleQty ?? 0) > 0 && drawnPanels === 0;

  async function save() {
    setBusy(true);
    const res = await saveSolarDesignAction({
      leadId,
      mountType: form.mountType,
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
          Site
        </h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Mount type</Label>
            <select
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={form.mountType}
              disabled={!canEdit}
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
        <p className="text-sm">
          <span className="font-display text-lg font-semibold">{drawnPanels}</span>{" "}
          {drawnPanels === 1 ? "panel" : "panels"}
          <span className="text-muted-foreground"> · drawn on the roof below</span>
        </p>

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

      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Panel layout
        </h4>
        <SolarLayoutDesigner
          leadId={leadId}
          lat={lat}
          moduleMm={moduleMm}
          moduleRatingW={moduleRatingW}
          initialBlocks={initialBlocks}
          assumptions={assumptions}
          canEdit={canEdit}
        />
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

      {canEdit && (
        <Button onClick={save} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />} Save design
        </Button>
      )}
    </div>
  );
}

export type LenderProductOption = {
  id: string;
  product: FinanceProduct;
  name: string | null;
  aprPct: number | null;
  termMonths: number | null;
  dealerFeePct: number | null;
  leaseRateCentsPerKwMonth: number | null;
  rateMillsPerKwh: number | null;
  escalatorPct: number | null;
  termYears: number | null;
  /** Payment factors in millionths. Loan only; null when the sheet quotes none. */
  factorWithPaydownMicros: number | null;
  factorWithoutPaydownMicros: number | null;
  paydownPct: number | null;
  paydownMonths: number | null;
  isActive: boolean;
};

/**
 * A blank box is "not set"; a typed 0 is a real zero. Module scope so the live
 * quote can use the same rule as the save path — two readings of "0" is how a
 * 0% escalator becomes an empty column.
 */
const numOrNullPure = (s: string, scale = 1) =>
  s.trim() === "" ? null : Number.isFinite(Number(s)) ? Math.round(Number(s) * scale) : null;

/**
 * Which of the lender's terms this deal is quoted on.
 *
 * The lender itself is chosen in step 1, where it also decides what equipment
 * the design may use. Offering a second lender control here would be two
 * controls writing one field, and a rep could quote Credit Human's money
 * against panels only Sunlight approves.
 */
function LenderProductPicker({
  leadId,
  lenderName,
  products,
  value,
  onChange,
  canEdit,
}: {
  leadId: string;
  lenderName: string | null;
  products: LenderProductOption[];
  value: string;
  onChange: (v: string) => void;
  canEdit: boolean;
}) {
  const id = React.useId();

  if (!lenderName) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        No lender chosen yet, so there are no terms to quote. Pick one on the deal — it also decides
        which equipment this system can use.{" "}
        <Link href={`/portal/leads/${leadId}`} className="font-medium underline underline-offset-2">
          Open the deal →
        </Link>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        {lenderName} has no products of this type on its rate sheet. Add them in{" "}
        <a className="font-medium underline underline-offset-2" href="/portal/settings/solar-lenders">
          Settings › Lenders
        </a>
        , or keep entering the terms by hand below.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {lenderName} product
      </Label>
      <select
        id={id}
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
        value={value}
        disabled={!canEdit}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">— none —</option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {lenderProductLabel(p)}
            {p.isActive ? "" : " · retired"}
          </option>
        ))}
      </select>
      <p className="text-[11px] text-muted-foreground">
        Its terms are the terms: APR, term and dealer fee come from the rate sheet, not from this
        screen.
      </p>
    </div>
  );
}

export function SolarFinancePanel({
  leadId,
  finance,
  canEdit,
  lenderName,
  lenderPortalUrl,
  lenderCreditInstructions,
  products,
  targetNetPpwCents,
  systemSizeKwDc,
}: {
  leadId: string;
  finance: SolarFinanceView;
  canEdit: boolean;
  /** The lender chosen in step 1. Null when the design has not picked one. */
  lenderName: string | null;
  /** Dealer portal, rep-facing. Deliberately not the customer application link. */
  lenderPortalUrl: string | null;
  lenderCreditInstructions: string | null;
  /** That lender's rate sheet: sellable rows, plus whatever this deal quotes. */
  products: LenderProductOption[];
  targetNetPpwCents: number | null;
  /** Needed to price a lease, which is quoted per kW-month. */
  systemSizeKwDc: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [product, setProduct] = React.useState<FinanceProduct>(finance?.product ?? "cash");
  const [lenderProductId, setLenderProductId] = React.useState<string>(finance?.lenderProductId ?? "");
  const seed = (f: SolarFinanceView) => ({
    grossPpw: num(f?.grossPpwCents, 100, 2),
    dealerFeePct: num(f?.dealerFeePct),
    adderTotal: num(f?.adderTotalCents, 100),
    rate: num(f?.rateMillsPerKwh, 1000, 3),
    monthly: num(f?.monthlyPaymentCents, 100),
    escalatorPct: num(f?.escalatorPct),
    termYears: num(f?.termYears),
    aprPct: num(f?.aprPct),
    loanTermMonths: num(f?.loanTermMonths),
    downPayment: num(f?.downPaymentCents, 100),
    loanMonthly: num(f?.loanMonthlyPaymentCents, 100),
  });
  const [form, setForm] = React.useState(() => seed(finance));
  const set = (k: keyof ReturnType<typeof seed>, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const isPurchase = product === "cash" || product === "loan";
  const isLoan = product === "loan";

  const chosen = products.find((p) => p.id === lenderProductId && p.product === product) ?? null;

  /**
   * Choosing a product writes the derived sticker straight into the box.
   *
   * The box has to show what will be saved. Leaving the rep's old $3.50 on
   * screen while the quote beside it prices $3.99 is two numbers for one field,
   * and only one of them survives Save. Typing over it afterwards still wins —
   * the server keeps a price it is sent and derives only when it is sent none.
   */
  const applyProduct = (id: string) => {
    setLenderProductId(id);
    const p = products.find((x) => x.id === id && x.product === product);
    if (!p || targetNetPpwCents == null || p.dealerFeePct == null) return;
    const gross = grossPpwFromNet(targetNetPpwCents, p.dealerFeePct);
    if (gross != null) setForm((f) => ({ ...f, grossPpw: (gross / 100).toFixed(2) }));
  };

  /**
   * What this deal costs a month, live, before anything is saved.
   *
   * Mirrors the server rather than reading a stored figure: the rep changes the
   * product, the sticker and the payment move with it, and Save then writes the
   * same numbers because both sides compute them the same way.
   */
  const quote = React.useMemo(() => {
    // The sheet's own factor arithmetic, computed BEFORE the approved-figure
    // short-circuit. An approval outranks it as the quoted payment, but a rep
    // still needs to see what the sheet said next to what the lender came back
    // with — hiding it the moment an approval lands is how a mismatch goes
    // unnoticed.
    const principalNow =
      isLoan && chosen
        ? (numOrNullPure(form.grossPpw, 100) ?? 0) * systemSizeKwDc * 1000 +
          (numOrNullPure(form.adderTotal, 100) ?? 0) -
          (numOrNullPure(form.downPayment, 100) ?? 0)
        : 0;
    const factors =
      isLoan && chosen && hasPaymentFactor(chosen)
        ? factorQuote(chosen, Math.round(principalNow))
        : null;

    const approvedCents = numOrNullPure(form.loanMonthly, 100);
    if (isLoan && approvedCents != null) {
      return {
        monthlyCents: approvedCents,
        approved: true,
        fromFactor: false,
        factors,
        grossPpwCents: null,
        derivedGross: false,
      };
    }
    if (!chosen) return null;

    if (product === "lease" && chosen.leaseRateCentsPerKwMonth != null) {
      return {
        monthlyCents: leaseMonthlyCents(chosen.leaseRateCentsPerKwMonth, systemSizeKwDc),
        approved: false,
        fromFactor: false,
        factors: null,
        grossPpwCents: null,
        derivedGross: false,
      };
    }
    if (product === "ppa") return null; // priced per kWh produced, not per month

    if (!isLoan) return null;

    // Read from the box, which applyProduct has already filled with the derived
    // figure. One number on screen, and it is the one that saves.
    const grossPpwCents = numOrNullPure(form.grossPpw, 100);
    if (grossPpwCents == null) return null;
    const derived =
      targetNetPpwCents != null && chosen.dealerFeePct != null
        ? grossPpwFromNet(targetNetPpwCents, chosen.dealerFeePct)
        : null;

    const contractCents =
      Math.round(systemSizeKwDc * 1000 * grossPpwCents) + (numOrNullPure(form.adderTotal, 100) ?? 0);
    const principal = contractCents - (numOrNullPure(form.downPayment, 100) ?? 0);

    // A PUBLISHED payment factor outranks our amortisation. The factor already
    // carries the fee and whatever promotional structure the program has, so it
    // does not equal `loanPaymentCents` for the same APR and term — and quoting
    // the derived figure when the lender printed a factor misquotes the
    // customer. Programs with no factor on file fall through unchanged.
    const monthlyCents =
      (factors && factorMonthlyCents(factors)) ??
      loanPaymentCents({
        principalCents: principal,
        aprPct: chosen.aprPct,
        termMonths: chosen.termMonths,
      });
    if (monthlyCents == null) return null;
    return {
      monthlyCents,
      approved: false,
      /** True when the figure came off the sheet rather than out of a formula. */
      fromFactor: factors != null && factorMonthlyCents(factors) != null,
      factors,
      grossPpwCents,
      derivedGross: derived != null && derived === grossPpwCents,
    };
  }, [
    chosen, product, isLoan, systemSizeKwDc, targetNetPpwCents,
    form.grossPpw, form.adderTotal, form.downPayment, form.loanMonthly,
  ]);

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

    setBusy(true);
    const res = await saveSolarFinanceAction({
      leadId,
      product,
      grossPpwCents: numOrNull(form.grossPpw, 100) ?? undefined,
      dealerFeePct: rawOrNull(form.dealerFeePct) ?? undefined,
      adderTotalCents: numOrNull(form.adderTotal, 100) ?? undefined,
      rateMillsPerKwh: numOrNull(form.rate, 1000),
      monthlyPaymentCents: numOrNull(form.monthly, 100),
      escalatorPct: rawOrNull(form.escalatorPct),
      termYears: rawOrNull(form.termYears),
      aprPct: rawOrNull(form.aprPct),
      loanTermMonths: rawOrNull(form.loanTermMonths),
      downPaymentCents: numOrNull(form.downPayment, 100),
      loanMonthlyPaymentCents: numOrNull(form.loanMonthly, 100),
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
    }
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

      {/* The lender's rate sheet. Only for products a lender actually finances —
          cash has none — and only for the lender step 1 designed the system for,
          because that lender already decided what equipment is on the roof. */}
      {product !== "cash" && (
        <LenderProductPicker
          leadId={leadId}
          lenderName={lenderName}
          products={products.filter((p) => p.product === product)}
          value={lenderProductId}
          onChange={applyProduct}
          canEdit={canEdit}
        />
      )}

      {quote && (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {quote.grossPpwCents != null && (
              <span className="text-xs text-muted-foreground">
                gross{" "}
                <span className="font-medium text-foreground">
                  ${(quote.grossPpwCents / 100).toFixed(2)}/W
                </span>
                {quote.derivedGross && " · derived from the net target"}
              </span>
            )}
            <span className="ml-auto">
              <span className="text-xs text-muted-foreground">
                {quote.approved ? "Monthly (approved)" : "Monthly (est.)"}
              </span>{" "}
              <span className="text-lg font-semibold tabular-nums">
                ${(quote.monthlyCents / 100).toFixed(2)}
              </span>
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {quote.approved
              ? "The lender's own figure from the approval. This is what the customer sees."
              : quote.fromFactor
                ? "From the rate sheet's payment factor — the lender's own published figure. The approved figure replaces it below."
                : "Estimated from the product's terms. The lender's approved figure replaces it below."}
          </p>

          {/* Both payments, never just the flattering one: the low figure is
              conditional on a paydown the customer has to actually make, and a
              customer who never applies the credit finds out from a bank
              statement. */}
          {quote.factors && (
            <dl className="mt-2 space-y-1 border-t border-border/60 pt-2 text-[11px]">
              {quote.factors.withPaydownMonthlyCents != null && (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">
                    With paydown
                    <span className="ml-1 opacity-70">
                      (&times;&nbsp;{formatFactor(chosen?.factorWithPaydownMicros)})
                    </span>
                  </dt>
                  <dd className="tabular-nums font-medium">
                    ${(quote.factors.withPaydownMonthlyCents / 100).toFixed(2)}/mo
                  </dd>
                </div>
              )}
              {quote.factors.withoutPaydownMonthlyCents != null && (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">
                    Without paydown
                    <span className="ml-1 opacity-70">
                      (&times;&nbsp;{formatFactor(chosen?.factorWithoutPaydownMicros)})
                    </span>
                  </dt>
                  <dd className="tabular-nums font-medium">
                    ${(quote.factors.withoutPaydownMonthlyCents / 100).toFixed(2)}/mo
                  </dd>
                </div>
              )}
              {quote.factors.paydownCents != null && quote.factors.paydownMonths != null && (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">
                    Paydown due by month {quote.factors.paydownMonths} ({quote.factors.paydownPct}%)
                  </dt>
                  <dd className="tabular-nums font-medium">
                    {money(quote.factors.paydownCents)}
                  </dd>
                </div>
              )}
            </dl>
          )}
        </div>
      )}

      {/* The two product families take completely different inputs. Showing the
          wrong ones is how a PPA ends up quoted with a dealer fee. */}
      {/* TextField throughout, not bare Label+Input: it wires htmlFor/id, so a
          screen reader announces each figure, the label is clickable, and the
          field can be addressed by name. */}
      {isPurchase ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label="Gross $/W" type="number" step="0.01" value={form.grossPpw} disabled={!canEdit} onChange={(v) => set("grossPpw", v)} />
          <TextField
            label="Dealer fee %"
            type="number"
            value={product === "cash" ? "" : form.dealerFeePct}
            disabled={!canEdit || product === "cash"}
            placeholder={product === "cash" ? "n/a — no lender" : undefined}
            onChange={(v) => set("dealerFeePct", v)}
          />
          <TextField label="Adders $" type="number" value={form.adderTotal} disabled={!canEdit} onChange={(v) => set("adderTotal", v)} />
        </div>
      ) : null}

      {/* The lender's terms, as issued. Loan only — a cash deal has no lender,
          no down payment (it is paid in full) and no monthly.
          The monthly is TYPED IN, never computed from amount + APR + term:
          promotional periods, fees and re-amortisation mean a derived figure
          can contradict the lender's real one, and the number a customer is
          quoted must be the number the lender issued. */}
      {isLoan && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Approved loan terms
            </div>
            {lenderPortalUrl && (
              <a
                href={lenderPortalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Run credit{lenderName ? ` at ${lenderName}` : ""} <ExternalLink className="size-3" />
              </a>
            )}
          </div>
          {/* TextField, not bare Label+Input: it wires htmlFor/id, so a screen
              reader announces each figure and the label is clickable. */}
          <div className="grid gap-3 sm:grid-cols-4">
            <TextField label="APR %" type="number" step="0.01" value={form.aprPct} disabled={!canEdit} onChange={(v) => set("aprPct", v)} />
            <TextField label="Term (months)" type="number" value={form.loanTermMonths} disabled={!canEdit} onChange={(v) => set("loanTermMonths", v)} />
            <TextField label="Down payment $" type="number" value={form.downPayment} disabled={!canEdit} onChange={(v) => set("downPayment", v)} />
            <TextField label="Monthly payment $" type="number" step="0.01" value={form.loanMonthly} disabled={!canEdit} onChange={(v) => set("loanMonthly", v)} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Enter the lender&rsquo;s own figures from the approval — these are never calculated here.
          </p>

          {lenderCreditInstructions && (
            <details className="rounded-lg border border-border/70 p-2">
              <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
                How to run credit{lenderName ? ` at ${lenderName}` : ""}
              </summary>
              <p className="mt-1.5 whitespace-pre-wrap text-[11px] text-muted-foreground">
                {lenderCreditInstructions}
              </p>
            </details>
          )}
        </div>
      )}

      {!isPurchase && (
        <div className="grid gap-3 sm:grid-cols-4">
          {product === "ppa" && (
            <TextField label="$/kWh" type="number" step="0.001" value={form.rate} disabled={!canEdit} onChange={(v) => set("rate", v)} />
          )}
          {product === "lease" && (
            <TextField label="Monthly $" type="number" value={form.monthly} disabled={!canEdit} onChange={(v) => set("monthly", v)} />
          )}
          <TextField label="Escalator %/yr" type="number" step="0.1" value={form.escalatorPct} disabled={!canEdit} onChange={(v) => set("escalatorPct", v)} />
          <TextField label="Term (years)" type="number" value={form.termYears} disabled={!canEdit} onChange={(v) => set("termYears", v)} />
        </div>
      )}

      {isPurchase && finance && (
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Contract price</span>
            <span className="font-display text-lg font-semibold">{money(finance.contractPriceCents)}</span>
          </div>
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
export type ProposalVersion = {
  id: string;
  leadId: string;
  version: number;
  status: string;
  /** NULL until the proposal is sent — an unsent one has no public link. */
  publicToken: string | null;
  supersededAt: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  signedAt: string | null;
  createdAt: string;
};

export function SolarProposalGate({
  leadId,
  versions,
  canEdit,
  onOpenStep,
}: {
  leadId: string;
  versions: ProposalVersion[];
  canEdit: boolean;
  /** Sends the rep to the builder step that fixes a finding. See ValidationList. */
  onOpenStep?: (step: BuilderStep) => void;
}) {
  const [issues, setIssues] = React.useState<ValidationIssue[] | null>(null);
  const [canGen, setCanGen] = React.useState<boolean | null>(null);
  const [busy, setBusy] = React.useState(false);
  const router = useRouter();

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
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={check} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Sun className="size-4" />}
          Check proposal readiness
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
          Generate proposal
        </Button>
      )}

      <ProposalVersionList versions={versions} canEdit={canEdit} />
    </div>
  );
}

/**
 * The versions of a proposal, with the two things you can still do to one:
 * open it as the customer sees it, and record that it went out.
 *
 * Shared with the deal page's Proposal card — generating a proposal now happens
 * in the builder, but READING one is exactly what you want from the deal, and
 * two copies of this list would drift.
 */
export function ProposalVersionList({
  versions,
  canEdit,
}: {
  versions: ProposalVersion[];
  canEdit: boolean;
}) {
  const router = useRouter();
  if (versions.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Versions
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {versions.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center gap-2 p-2.5 text-sm">
            <span className="font-medium">v{v.version}</span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                v.signedAt
                  ? "bg-emerald-100 text-emerald-700"
                  : v.supersededAt
                    ? "bg-muted text-muted-foreground"
                    : "bg-sky-100 text-sky-700"
              )}
            >
              {v.supersededAt ? "superseded" : v.status}
            </span>
            <span className="flex-1 text-[11px] text-muted-foreground">
              {new Date(v.createdAt).toLocaleDateString()}
              {v.viewedAt ? " · viewed" : ""}
              {v.signedAt ? ` · accepted ${new Date(v.signedAt).toLocaleDateString()}` : ""}
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
            {canEdit && !v.sentAt && !v.supersededAt && (
              <button
                className="text-xs underline underline-offset-2"
                onClick={async () => {
                  const res = await markProposalSentAction(v.id);
                  if (!res.ok) return toast.error(res.error);
                  toast.success("Marked as sent");
                  router.refresh();
                }}
              >
                Mark sent
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
