"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowUpRight,
  BatteryCharging,
  ChevronDown,
  ClipboardList,
  Compass,
  Cpu,
  Home,
  Landmark,
  LayoutGrid,
  Loader2,
  NotebookPen,
  PanelsTopLeft,
  PlugZap,
  Stamp,
  Sun,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LenderMark } from "@/components/ui/lender-mark";
import { compassLabel, tiltDegToPitch } from "@/lib/solar-orientation";
import { saveSolarBuildDetailsAction } from "@/server/modules/solar/actions";
import { saveProjectCustomFieldsAction } from "@/server/modules/projects/actions";

/** One array as the layout designer drew it, flattened for display. */
export type SystemArray = {
  id: string;
  panels: number;
  azimuthDeg: number | null;
  tiltDeg: number | null;
  shadePct: number | null;
};

/**
 * Where the figures below came from.
 *
 * A proposal is a frozen document; the design underneath it keeps moving. This
 * slide says which of the two it is reporting rather than showing numbers of
 * unstated provenance — `label` is built on the server so this stays free of
 * date formatting.
 */
export type SpecSource =
  | { kind: "proposal"; label: string }
  | { kind: "design"; label: string };

export type SystemSpecs = {
  module: string | null;
  moduleQty: number;
  moduleRatingW: number | null;
  inverter: string | null;
  battery: string | null;
  batteryQty: number;
  /** The financing partner as the proposal froze it. Null on a cash quote. */
  lender: string | null;
  lenderLogoUrl: string | null;
  sizeKwDc: number;
  sizeKwAc: number;
  year1Kwh: number;
  offsetPct: number;
  mountType: string;
  tsrfPct: number | null;
  yieldSource: string | null;
  yieldStation: string | null;
  annualUsageKwh: number | null;
  rateMills: number | null;
  ratePlan: string | null;
  netMeteringProgram: string | null;
  arrays: SystemArray[];
  setbackNotes: string | null;
  structuralNotes: string | null;
  electricalNotes: string | null;
};

/** One of the company's own PROJECT fields, as defined in Settings. */
export type ProjectFieldDef = {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "select" | "checkbox";
  options: string[];
  required: boolean;
};

export type SystemBuild = {
  hasDesign: boolean;
  utilityAccountNo: string | null;
  meterNo: string | null;
  ahjName: string | null;
  ahjContactName: string | null;
  ahjContactInfo: string | null;
  permitNumber: string | null;
  installerContact: string | null;
  installerTitle: string | null;
  permitNotRequired: boolean;
  ptoNotRequired: boolean;
  interconnectionNotRequired: boolean;
  otherUtilityStatus: boolean;
  otherUtilityStatusDetail: string | null;
};

/* ── The slide's own vocabulary ────────────────────────────────────────────
   Every block on this slide is one of four shapes: a headline figure, a piece
   of equipment, a stated assumption, or a note. They are defined once here so
   the four read as one card rather than as four cards that happened to land
   on the same tab. */

/** An em dash, so an unset figure reads as unset rather than as zero. */
const NOT_SET = <span className="font-normal text-muted-foreground">—</span>;

/* A panel's fold is remembered per panel, per browser: whoever folds the
   equipment list away to get at the arrays wants it still folded on the next
   deal they open. localStorage is an external store, so it is read through
   useSyncExternalStore — the server renders every panel open and the client
   picks up the stored fold without a hydration mismatch. localStorage fires
   no event for same-tab writes, hence the manual listener set. */
const FOLD_KEY = "operations-folded:";
const foldListeners = new Set<() => void>();
function subscribeFold(cb: () => void) {
  foldListeners.add(cb);
  return () => {
    foldListeners.delete(cb);
  };
}
function setFolded(title: string, folded: boolean) {
  if (folded) window.localStorage.setItem(FOLD_KEY + title, "1");
  else window.localStorage.removeItem(FOLD_KEY + title);
  foldListeners.forEach((cb) => cb());
}

/**
 * A panel: a titled surface, recessed against the slide it sits on.
 *
 * `bg-muted/30` rather than `bg-card` deliberately — this whole slide renders
 * inside the deal's card, and a card on a card is invisible in light mode and
 * muddy in dark. A recess reads as "inside" in both.
 *
 * Folds from the arrow on the right, or from anywhere on the header that is
 * not the panel's own action — a "Manage fields" link must still be a link.
 */
function Panel({
  title,
  icon: Icon,
  action,
  className,
  bodyClassName,
  children,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  const folded = React.useSyncExternalStore(
    subscribeFold,
    () => window.localStorage.getItem(FOLD_KEY + title) === "1",
    () => false
  );
  const bodyId = React.useId();
  return (
    <section className={cn("overflow-hidden rounded-xl border border-border bg-muted/30", className)}>
      <header
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a, button, input, label")) return;
          setFolded(title, !folded);
        }}
        className={cn(
          "flex min-w-0 cursor-pointer select-none flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5",
          // Folded, the header is the whole panel; a rule under it would sit on
          // the panel's own bottom border as a double line.
          !folded && "border-b border-border/70"
        )}
      >
        <h3 className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {Icon && <Icon className="size-3.5 shrink-0 text-solar" />}
          <span className="truncate">{title}</span>
        </h3>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {action}
          <button
            type="button"
            aria-expanded={!folded}
            aria-controls={bodyId}
            aria-label={`${folded ? "Expand" : "Collapse"} ${title}`}
            title={folded ? "Expand" : "Collapse"}
            onClick={() => setFolded(title, !folded)}
            className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown
              className={cn(
                "size-4 transition-transform motion-reduce:transition-none",
                folded && "-rotate-90"
              )}
            />
          </button>
        </div>
      </header>
      <div id={bodyId} hidden={folded} className={cn("p-4", bodyClassName)}>
        {children}
      </div>
    </section>
  );
}

/**
 * A headline figure.
 *
 * The four numbers a rep is asked for on the phone — how big, how many panels,
 * how much does it make, how much of the bill does that cover. They used to be
 * four of fifteen identical label/value rows; the answer to "why is this only
 * offsetting 38%?" was set in the same 13px as the rate plan.
 */
function Stat({
  label,
  value,
  unit,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  hint?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-3.5 py-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className="font-display text-xl font-semibold tabular-nums">{value}</span>
        {unit && <span className="text-[11px] font-medium text-muted-foreground">{unit}</span>}
      </div>
      {hint && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

/**
 * One piece of hardware, on its own line with its own mark.
 *
 * Right-aligned against the far edge of a two-column grid, a module part number
 * ended up a hand's width from its label with nothing but whitespace between
 * them. Equipment is a list of things, so it is laid out as one: mark, what it
 * is, and how many of it.
 */
function Kit({
  icon: Icon,
  mark,
  label,
  value,
  meta,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  /** A logo in place of the glyph — the lender brings its own. */
  mark?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  meta?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      {mark ?? (
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-solar/10 text-solar">
          {Icon && <Icon className="size-4" />}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="truncate text-sm font-medium">{value}</div>
      </div>
      {meta && (
        <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
          {meta}
        </span>
      )}
    </div>
  );
}

/** A stated assumption: small, quiet, and always the same shape. */
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-1.5 last:border-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/** A working note, set as prose. Sentences are not right-aligned figures. */
function Note({ label, body }: { label: string; body: string }) {
  return (
    <div className="border-b border-border/60 py-2 first:pt-0 last:border-0 last:pb-0">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <p className="mt-0.5 text-sm leading-relaxed">{body}</p>
    </div>
  );
}

/** A form field on a recessed panel: label over input, the one shape both forms use. */
function Field({
  id,
  label,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        className="bg-card"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/**
 * A waiver a permit or PTO packet has to state OUT LOUD.
 *
 * Unticked means nobody has checked yet, which is why none of them is worded as
 * a positive ("permit required") that a blank form would assert on its own.
 */
function Waiver({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      // Explicitly associated rather than relying on the wrapping label: the
      // box is a `button[role=checkbox]`, and an implicit association there is
      // a coin toss for anything reading the page by its accessible name.
      htmlFor={id}
      className={cn(
        "flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs",
        disabled ? "opacity-70" : "cursor-pointer"
      )}
    >
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(v) => onChange(v === true)} />
      {label}
    </label>
  );
}

/** "Recorded" once the step has what a document needs, or has been waived. */
function StepBadge({ done }: { done: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-medium",
        done
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "bg-muted text-muted-foreground"
      )}
    >
      {done ? "Recorded" : "Not recorded yet"}
    </span>
  );
}

type OpsTab = "design" | "permitting" | "interconnection" | "fields";

/**
 * The job after the sale, one step at a time: Design → Permitting →
 * Interconnection, then the company's own project fields.
 *
 * This was the "System info" slide, which stacked the design AND both ops forms
 * down one column — so the permit number, which is the chase, sat three panels
 * below an equipment list, on a tab whose name said nothing about permits. A job
 * moves through design, the jurisdiction and the utility in that order; the tabs
 * are that order. Where the time went is the Timeline slide's, not a tab here.
 *
 * Every tab stays MOUNTED and only its visibility flips, the same rule as
 * DealSlides: a half-typed permit number survives a look at the meter number.
 *
 * DESIGN is READ-ONLY, and read off the LAST PROPOSAL wherever the proposal has
 * an opinion. Modules, inverter, battery and lender used to be dropdowns here
 * as well as choices in the builder, which is one field with two owners: a rep
 * quotes a customer a Tesla inverter on a signed document and ops swaps it here
 * a fortnight later, and now the deal and the customer's copy disagree with
 * nobody informed. The proposal is the agreement, so the proposal decides; this
 * tab reports it and links back to the builder.
 *
 * PERMITTING and INTERCONNECTION are genuinely ours to fill in after the fact.
 * They are one row on SolarDesign and one server action, so each tab's Save
 * sends both halves as they stand on screen — a partial write built from the
 * last-rendered props could overwrite a save made a second earlier on the other
 * tab with a stale value.
 */
export function SolarOperations({
  leadId,
  specs,
  source,
  build,
  canEdit,
  projectFields,
  projectValues,
  hasProject,
}: {
  leadId: string;
  specs: SystemSpecs | null;
  source: SpecSource;
  build: SystemBuild;
  canEdit: boolean;
  projectFields: ProjectFieldDef[];
  projectValues: Record<string, string>;
  hasProject: boolean;
}) {
  const router = useRouter();
  const uid = React.useId();
  const [tab, setTab] = React.useState<OpsTab>("design");
  const [busy, setBusy] = React.useState<"permitting" | "interconnection" | null>(null);
  const [form, setForm] = React.useState({
    utilityAccountNo: build.utilityAccountNo ?? "",
    meterNo: build.meterNo ?? "",
    ahjName: build.ahjName ?? "",
    ahjContactName: build.ahjContactName ?? "",
    ahjContactInfo: build.ahjContactInfo ?? "",
    permitNumber: build.permitNumber ?? "",
    installerContact: build.installerContact ?? "",
    installerTitle: build.installerTitle ?? "",
    otherUtilityStatusDetail: build.otherUtilityStatusDetail ?? "",
  });
  const [flags, setFlags] = React.useState({
    permitNotRequired: build.permitNotRequired,
    ptoNotRequired: build.ptoNotRequired,
    interconnectionNotRequired: build.interconnectionNotRequired,
    otherUtilityStatus: build.otherUtilityStatus,
  });
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const setFlag = (k: keyof typeof flags) => (v: boolean) => setFlags((f) => ({ ...f, [k]: v }));

  // The company's own project fields keep their own state and their own save:
  // they are defined in Settings and can be anything, so they have no business
  // being able to fail a save of the utility's numbers.
  const [custom, setCustom] = React.useState<Record<string, string>>(projectValues);
  const [savingCustom, setSavingCustom] = React.useState(false);
  const setCustomValue = (key: string, v: string) => setCustom((c) => ({ ...c, [key]: v }));

  async function saveProjectFields() {
    setSavingCustom(true);
    try {
      const res = await saveProjectCustomFieldsAction({ leadId, values: custom });
      if (!res.ok) return toast.error(res.error ?? "Something went wrong.");
      toast.success("Project fields saved");
      router.refresh();
    } finally {
      setSavingCustom(false);
    }
  }

  async function save(step: "permitting" | "interconnection") {
    setBusy(step);
    try {
      const res = await saveSolarBuildDetailsAction({
        leadId,
        utilityAccountNo: form.utilityAccountNo.trim() || null,
        meterNo: form.meterNo.trim() || null,
        ahjName: form.ahjName.trim() || null,
        ahjContactName: form.ahjContactName.trim() || null,
        ahjContactInfo: form.ahjContactInfo.trim() || null,
        permitNumber: form.permitNumber.trim() || null,
        installerContact: form.installerContact.trim() || null,
        installerTitle: form.installerTitle.trim() || null,
        otherUtilityStatusDetail: form.otherUtilityStatusDetail.trim() || null,
        ...flags,
      });
      if (!res.ok) return toast.error(res.error ?? "Something went wrong.");
      toast.success(step === "permitting" ? "Permitting saved" : "Interconnection saved");
      router.refresh();
    } finally {
      // In a `finally`, so a thrown action leaves the form usable instead of
      // latching the button on and stranding the fields.
      setBusy(null);
    }
  }

  const proposed = source.kind === "proposal";
  const builderHref = `/portal/leads/${leadId}/solar-proposal`;

  // How much of the home's own consumption this roof covers, as a bar. Offset
  // is a RATIO and was printed as a bare percentage next to two six-figure
  // kWh totals it is derived from, which is three numbers to hold in your head
  // to picture one thing. Clamped at 100% for the fill — an over-producing
  // system still fills the bar rather than overflowing its track — while the
  // stat above keeps saying 118%.
  const usage = specs?.annualUsageKwh ?? null;
  const offsetFill = specs ? Math.max(0, Math.min(100, Math.round(specs.offsetPct))) : 0;

  // Off the SAVED values, not the form: "Recorded" is a claim about what a
  // document would autofill right now, and an unsaved keystroke is not that.
  const permitDone = build.permitNotRequired || !!(build.ahjName && build.permitNumber);
  const interconnectDone =
    build.interconnectionNotRequired || !!(build.utilityAccountNo && build.meterNo);

  const tabs: { id: OpsTab; label: string; icon: React.ComponentType<{ className?: string }>; done?: boolean }[] = [
    { id: "design", label: "Design", icon: PanelsTopLeft },
    { id: "permitting", label: "Permitting", icon: Stamp, done: build.hasDesign && permitDone },
    { id: "interconnection", label: "Interconnection", icon: PlugZap, done: build.hasDesign && interconnectDone },
    { id: "fields", label: "Project fields", icon: ClipboardList },
  ];

  /** Both ops forms hang off the design, so both say the same thing without one. */
  const noDesign = (
    <p className="text-xs text-muted-foreground">
      No system design on this deal yet. Build the proposal first and these will attach to it.
    </p>
  );

  return (
    <div className="space-y-5">
      {/* Underlined, not pills: this bar lives INSIDE a slide of the pill bar
          above it, and two rows of identical pills read as one row that
          wrapped. It wraps rather than scrolls — sideways, on a phone, Project
          fields sat past the edge with nothing to say it was there. */}
      <div
        role="tablist"
        aria-label="Operations"
        className="-mt-1 flex flex-wrap gap-1 border-b border-border"
      >
        {tabs.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`${uid}-tab-${t.id}`}
              aria-selected={on}
              aria-controls={`${uid}-panel-${t.id}`}
              onClick={() => setTab(t.id)}
              className={cn(
                "relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 pb-2.5 pt-1.5 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                "after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full",
                on
                  ? "text-foreground after:bg-solar"
                  : "text-muted-foreground after:bg-transparent hover:text-foreground"
              )}
            >
              <t.icon className={cn("size-4", on && "text-solar")} />
              {t.label}
              {t.done && (
                <span aria-hidden className="size-1.5 rounded-full bg-emerald-500" title="Recorded" />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Design ────────────────────────────────────────────────────────── */}
      <div
        role="tabpanel"
        id={`${uid}-panel-design`}
        aria-labelledby={`${uid}-tab-design`}
        hidden={tab !== "design"}
        className="space-y-5"
      >
        {/* Provenance first. Everything under this line is a report, not a form. */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={cn(
                "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                proposed
                  ? "border-solar/40 bg-solar/10 text-solar"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              )}
            >
              {proposed ? "As proposed" : "Working design"}
            </span>
            <span className="min-w-0 truncate text-xs text-muted-foreground">{source.label}</span>
          </div>
          {specs && (
            <Button asChild variant="outline" size="sm">
              <Link href={builderHref}>
                {proposed ? "Change in the proposal" : "Open the proposal builder"}
                <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
          )}
        </div>

        {specs ? (
          <>
            {/* The four figures the job is described by out loud. */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat
                label="System size"
                value={specs.sizeKwDc ? specs.sizeKwDc.toFixed(2) : "—"}
                unit={specs.sizeKwDc ? "kW DC" : undefined}
                hint={specs.sizeKwAc ? `${specs.sizeKwAc.toFixed(2)} kW AC` : undefined}
              />
              <Stat
                label="Panels"
                value={specs.moduleQty || "—"}
                hint={specs.moduleRatingW ? `${specs.moduleRatingW} W each` : undefined}
              />
              <Stat
                label="Year-1 production"
                value={specs.year1Kwh ? specs.year1Kwh.toLocaleString() : "—"}
                unit={specs.year1Kwh ? "kWh" : undefined}
                hint={specs.yieldSource ? specs.yieldSource.toUpperCase() : undefined}
              />
              <Stat
                label="Offset"
                value={specs.offsetPct ? `${Math.round(specs.offsetPct)}%` : "—"}
                hint={usage ? `of ${usage.toLocaleString()} kWh` : undefined}
              />
            </div>

            <div className="grid items-start gap-4 lg:grid-cols-2">
              <Panel title="Equipment" icon={LayoutGrid} bodyClassName="divide-y divide-border/60 p-0">
                <Kit
                  icon={LayoutGrid}
                  label="Modules"
                  value={specs.module ?? NOT_SET}
                  meta={specs.module ? `${specs.moduleQty} ×` : undefined}
                />
                <Kit icon={Cpu} label="Inverter" value={specs.inverter ?? NOT_SET} />
                <Kit
                  icon={BatteryCharging}
                  label="Battery"
                  value={specs.battery ?? <span className="font-normal text-muted-foreground">None</span>}
                  meta={specs.battery && specs.batteryQty > 1 ? `${specs.batteryQty} ×` : undefined}
                />
                <Kit
                  icon={Home}
                  label="Mount"
                  value={<span className="capitalize">{specs.mountType}</span>}
                />
                {/* The lender rides with the equipment it gates: its approved-vendor
                    list is what makes one inverter quotable and another not. */}
                <Kit
                  icon={Landmark}
                  mark={
                    specs.lender ? (
                      <LenderMark name={specs.lender} logoUrl={specs.lenderLogoUrl} size="md" />
                    ) : undefined
                  }
                  label="Lender"
                  value={specs.lender ?? NOT_SET}
                />
              </Panel>

              <Panel title="Production & assumptions" icon={Sun}>
                {/* The ratio, drawn. */}
                {usage ? (
                  <div className="mb-3">
                    <div className="flex items-baseline justify-between gap-3 text-[11px] text-muted-foreground">
                      <span>
                        Solar{" "}
                        <span className="font-medium tabular-nums text-foreground">
                          {specs.year1Kwh.toLocaleString()} kWh
                        </span>
                      </span>
                      <span>
                        Home uses{" "}
                        <span className="font-medium tabular-nums text-foreground">
                          {usage.toLocaleString()} kWh
                        </span>
                      </span>
                    </div>
                    <div
                      className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"
                      role="img"
                      aria-label={`Solar covers ${Math.round(specs.offsetPct)}% of this home's annual use`}
                    >
                      <div
                        className="h-full rounded-full bg-solar transition-[width]"
                        style={{ width: `${offsetFill}%` }}
                      />
                    </div>
                  </div>
                ) : null}

                <dl>
                  <Row
                    label="Annual usage"
                    value={usage ? `${usage.toLocaleString()} kWh` : NOT_SET}
                  />
                  <Row
                    label="Utility rate"
                    value={
                      specs.rateMills != null ? `$${(specs.rateMills / 1000).toFixed(3)}/kWh` : NOT_SET
                    }
                  />
                  {/* Which model produced the number, so a figure that looks wrong can
                      be traced instead of argued about. */}
                  <Row
                    label="Yield source"
                    value={
                      specs.yieldSource ? (
                        <>
                          <span className="uppercase">{specs.yieldSource}</span>
                          {specs.yieldStation && (
                            <span className="ml-1 font-normal text-muted-foreground">
                              · {specs.yieldStation}
                            </span>
                          )}
                        </>
                      ) : (
                        NOT_SET
                      )
                    }
                  />
                  {specs.tsrfPct != null && <Row label="TSRF" value={`${Math.round(specs.tsrfPct)}%`} />}
                  {specs.ratePlan && <Row label="Rate plan" value={specs.ratePlan} />}
                  {specs.netMeteringProgram && (
                    <Row label="Net metering" value={specs.netMeteringProgram} />
                  )}
                </dl>
              </Panel>
            </div>

            {/* Per array, because a design is rarely one plane and the totals
                above hide that. An array facing north is not a rounding error.

                Drawn from the LIVE layout, always: a proposal freezes a picture
                of the roof, not the per-plane angles behind it. Labelled as such
                when the figures above came from a proposal, so a redrawn roof
                cannot quietly read as part of the frozen document. */}
            {specs.arrays.length > 0 && (
              <Panel
                title="Arrays"
                icon={PanelsTopLeft}
                bodyClassName="p-0"
                action={
                  <span className="text-[11px] text-muted-foreground">
                    {proposed ? "Current drawing" : `${specs.arrays.length} on this roof`}
                  </span>
                }
              >
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[24rem] text-sm">
                    <thead>
                      <tr className="border-b border-border/70 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                        <th className="w-10 py-2 pl-4 font-medium">#</th>
                        <th className="w-36 py-2 pr-3 font-medium">Panels</th>
                        <th className="w-40 py-2 pr-3 font-medium">Facing</th>
                        <th className="w-32 py-2 pr-3 font-medium">Pitch</th>
                        <th className="py-2 pr-4 text-right font-medium">Shade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {specs.arrays.map((a, i) => (
                        <tr key={a.id} className="border-b border-border/50 last:border-0">
                          <td className="py-2 pl-4">
                            <span className="grid size-5 place-items-center rounded-md bg-solar/10 text-[11px] font-semibold tabular-nums text-solar">
                              {i + 1}
                            </span>
                          </td>
                          <td className="py-2 pr-3 tabular-nums">
                            {a.panels}
                            {specs.moduleRatingW ? (
                              <span className="ml-1.5 text-[11px] text-muted-foreground">
                                · {((a.panels * specs.moduleRatingW) / 1000).toFixed(2)} kW
                              </span>
                            ) : null}
                          </td>
                          <td className="py-2 pr-3">
                            {a.azimuthDeg != null ? (
                              <span className="inline-flex items-center gap-1">
                                <Compass className="size-3 text-muted-foreground" />
                                {compassLabel(a.azimuthDeg)}
                                <span className="text-[11px] tabular-nums text-muted-foreground">
                                  {Math.round(a.azimuthDeg)}°
                                </span>
                              </span>
                            ) : (
                              NOT_SET
                            )}
                          </td>
                          <td className="py-2 pr-3">
                            {a.tiltDeg != null ? (
                              <>
                                <span className="tabular-nums">{Math.round(a.tiltDeg)}°</span>{" "}
                                <span className="text-[11px] text-muted-foreground">
                                  {tiltDegToPitch(a.tiltDeg)}
                                </span>
                              </>
                            ) : (
                              NOT_SET
                            )}
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums">
                            {a.shadePct ? `${Math.round(a.shadePct)}%` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {/* Only when there is something to total. On a single-plane
                        roof the row would just repeat the one above it. */}
                    {specs.arrays.length > 1 && (
                      <tfoot>
                        <tr className="border-t border-border/70 text-[11px] font-medium text-muted-foreground">
                          <td className="py-2 pl-4">Σ</td>
                          <td className="py-2 pr-3 tabular-nums text-foreground">
                            {specs.arrays.reduce((n, a) => n + a.panels, 0)} panels drawn
                          </td>
                          <td colSpan={3} className="py-2 pr-4" />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </Panel>
            )}

            {(specs.setbackNotes || specs.structuralNotes || specs.electricalNotes) && (
              <Panel title="Site notes" icon={NotebookPen}>
                {specs.setbackNotes && <Note label="Setbacks" body={specs.setbackNotes} />}
                {specs.structuralNotes && <Note label="Structural" body={specs.structuralNotes} />}
                {specs.electricalNotes && <Note label="Electrical" body={specs.electricalNotes} />}
              </Panel>
            )}
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
            <span className="mx-auto grid size-10 place-items-center rounded-full bg-solar/10 text-solar">
              <PanelsTopLeft className="size-5" />
            </span>
            <p className="mt-3 text-sm font-medium">No system designed yet</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
              Draw the array in the proposal builder and the equipment, production and per-plane
              angles all report here.
            </p>
            <Button asChild size="sm" className="mt-4 bg-solar text-solar-foreground hover:bg-solar/90">
              <Link href={builderHref}>Open the proposal builder</Link>
            </Button>
          </div>
        )}
      </div>

      {/* ── Permitting ────────────────────────────────────────────────────────
          Post-sale ops truth: what the jurisdiction needs from us for this
          house. NOT lead intake — a rep opening a new deal has none of it, and
          asking for it there would be asking the wrong person at the wrong time. */}
      <div
        role="tabpanel"
        id={`${uid}-panel-permitting`}
        aria-labelledby={`${uid}-tab-permitting`}
        hidden={tab !== "permitting"}
      >
        <Panel
          title="Permitting & AHJ"
          icon={Stamp}
          action={build.hasDesign ? <StepBadge done={permitDone} /> : undefined}
        >
          {!build.hasDesign ? (
            noDesign
          ) : (
            <>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                The jurisdiction&rsquo;s own details for this house, recorded when the permit is
                pulled — and read straight into permit documents, so nothing here has to be retyped
                into a form.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field
                  id="solar-ahj-name"
                  label="AHJ"
                  value={form.ahjName}
                  disabled={!canEdit}
                  placeholder="City / county issuing the permit"
                  onChange={set("ahjName")}
                />
                <Field
                  id="solar-permit-no"
                  label="Permit #"
                  value={form.permitNumber}
                  disabled={!canEdit}
                  placeholder="Once the permit is pulled"
                  onChange={set("permitNumber")}
                />
                <Field
                  id="solar-ahj-contact"
                  label="AHJ contact name"
                  value={form.ahjContactName}
                  disabled={!canEdit}
                  placeholder="Optional"
                  onChange={set("ahjContactName")}
                />
                <Field
                  id="solar-ahj-contact-info"
                  label="AHJ contact phone / email"
                  value={form.ahjContactInfo}
                  disabled={!canEdit}
                  placeholder="Optional"
                  onChange={set("ahjContactInfo")}
                />
                <Field
                  id="solar-installer-contact"
                  label="Installer contact for AHJ & PTO"
                  value={form.installerContact}
                  disabled={!canEdit}
                  placeholder="Blank = the company's own contact"
                  onChange={set("installerContact")}
                />
                <Field
                  id="solar-installer-title"
                  label="Installer title"
                  value={form.installerTitle}
                  disabled={!canEdit}
                  placeholder="e.g. Project Manager"
                  onChange={set("installerTitle")}
                />
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <Waiver
                  id="solar-flag-permitNotRequired"
                  label="Permit not required"
                  checked={flags.permitNotRequired}
                  disabled={!canEdit}
                  onChange={setFlag("permitNotRequired")}
                />
              </div>

              {canEdit && (
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => save("permitting")}
                  className="mt-4 bg-solar text-solar-foreground hover:bg-solar/90"
                >
                  {busy === "permitting" ? <Loader2 className="size-4 animate-spin" /> : <Stamp className="size-4" />}
                  Save permitting
                </Button>
              )}
            </>
          )}
        </Panel>
      </div>

      {/* ── Interconnection ───────────────────────────────────────────────────
          The utility's numbers for the house and where the utility has got to.
          Same row, same save as permitting — see the note on the component. */}
      <div
        role="tabpanel"
        id={`${uid}-panel-interconnection`}
        aria-labelledby={`${uid}-tab-interconnection`}
        hidden={tab !== "interconnection"}
      >
        <Panel
          title="Interconnection"
          icon={PlugZap}
          action={build.hasDesign ? <StepBadge done={interconnectDone} /> : undefined}
        >
          {!build.hasDesign ? (
            noDesign
          ) : (
            <>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                The utility&rsquo;s own numbers for this house — read straight into interconnection
                and PTO documents. The equipment and the lender are not set here: they are what the
                customer was quoted, so they change on the proposal.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field
                  id="solar-utility-account"
                  label="Utility account #"
                  value={form.utilityAccountNo}
                  disabled={!canEdit}
                  placeholder="From the customer's bill"
                  onChange={set("utilityAccountNo")}
                />
                <Field
                  id="solar-meter-no"
                  label="Meter #"
                  value={form.meterNo}
                  disabled={!canEdit}
                  placeholder="Read off the meter at install"
                  onChange={set("meterNo")}
                />
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <Waiver
                  id="solar-flag-interconnectionNotRequired"
                  label="Interconnection not required"
                  checked={flags.interconnectionNotRequired}
                  disabled={!canEdit}
                  onChange={setFlag("interconnectionNotRequired")}
                />
                <Waiver
                  id="solar-flag-ptoNotRequired"
                  label="PTO not required"
                  checked={flags.ptoNotRequired}
                  disabled={!canEdit}
                  onChange={setFlag("ptoNotRequired")}
                />
                <Waiver
                  id="solar-flag-otherUtilityStatus"
                  label="Other utility status"
                  checked={flags.otherUtilityStatus}
                  disabled={!canEdit}
                  onChange={setFlag("otherUtilityStatus")}
                />
              </div>

              {/* An empty box asks for nothing. A packet that carries a blank
                  "other status" line is worse than one that carries none. */}
              {flags.otherUtilityStatus && (
                <div className="mt-3">
                  <Field
                    id="solar-other-utility-detail"
                    label="Other utility status — detail"
                    value={form.otherUtilityStatusDetail}
                    disabled={!canEdit}
                    placeholder="What the utility actually said"
                    onChange={set("otherUtilityStatusDetail")}
                  />
                </div>
              )}

              {canEdit && (
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => save("interconnection")}
                  className="mt-4 bg-solar text-solar-foreground hover:bg-solar/90"
                >
                  {busy === "interconnection" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <PlugZap className="size-4" />
                  )}
                  Save interconnection
                </Button>
              )}
            </>
          )}
        </Panel>
      </div>

      {/* ── Project fields ──────────────────────────────────────────────────
          Whatever this company decided a job needs recorded, defined in
          Settings → Custom Fields. Rendered here rather than on the lead form
          because they describe the JOB — the same reason permitting is here. */}
      <div
        role="tabpanel"
        id={`${uid}-panel-fields`}
        aria-labelledby={`${uid}-tab-fields`}
        hidden={tab !== "fields"}
      >
        <Panel
          title="Project fields"
          icon={ClipboardList}
          action={
            canEdit ? (
              <Link
                href="/portal/settings/fields"
                className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
              >
                Manage fields
              </Link>
            ) : undefined
          }
        >
          {projectFields.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No project fields defined yet. Add them in{" "}
              <Link href="/portal/settings/fields" className="underline underline-offset-2">
                Settings → Custom Fields
              </Link>{" "}
              and they appear here on every job — and in the picker when you map a document template.
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {projectFields.map((f) => {
                  const id = `project-field-${f.key}`;
                  const value = custom[f.key] ?? "";
                  return (
                    <div key={f.key} className={cn("space-y-1", f.type === "textarea" && "sm:col-span-2")}>
                      <Label htmlFor={id} className="text-xs">
                        {f.label}
                        {f.required && <span className="ml-0.5 text-destructive">*</span>}
                      </Label>
                      {f.type === "textarea" ? (
                        <Textarea
                          id={id}
                          value={value}
                          disabled={!canEdit}
                          className="bg-card"
                          onChange={(e) => setCustomValue(f.key, e.target.value)}
                        />
                      ) : f.type === "select" ? (
                        <Select
                          value={value}
                          disabled={!canEdit}
                          onValueChange={(v) => setCustomValue(f.key, v)}
                        >
                          <SelectTrigger id={id} className="w-full bg-card">
                            <SelectValue placeholder="Select…" />
                          </SelectTrigger>
                          <SelectContent>
                            {f.options.map((o) => (
                              <SelectItem key={o} value={o}>
                                {o}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : f.type === "checkbox" ? (
                        // Stored as the same "Yes"/"" a permitting flag uses, so a
                        // template can drop it on a checkbox OR a text field and
                        // get something sensible either way.
                        <label
                          htmlFor={id}
                          className={cn(
                            "flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs",
                            canEdit ? "cursor-pointer" : "opacity-70"
                          )}
                        >
                          <Checkbox
                            id={id}
                            checked={value === "Yes"}
                            disabled={!canEdit}
                            onCheckedChange={(v) => setCustomValue(f.key, v === true ? "Yes" : "")}
                          />
                          {f.label}
                        </label>
                      ) : (
                        <Input
                          id={id}
                          type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                          value={value}
                          disabled={!canEdit}
                          className="bg-card"
                          onChange={(e) => setCustomValue(f.key, e.target.value)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              {canEdit && (
                <>
                  {!hasProject && (
                    <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                      This deal has no job record yet — saving creates one, at status{" "}
                      <span className="font-medium">Not started</span>.
                    </p>
                  )}
                  <Button
                    size="sm"
                    disabled={savingCustom}
                    onClick={saveProjectFields}
                    className="mt-3 bg-solar text-solar-foreground hover:bg-solar/90"
                  >
                    {savingCustom ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ClipboardList className="size-4" />
                    )}
                    {hasProject ? "Save project fields" : "Create job & save project fields"}
                  </Button>
                </>
              )}
            </>
          )}
        </Panel>
      </div>

    </div>
  );
}
