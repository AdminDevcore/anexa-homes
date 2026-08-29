"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Undo2, Archive, Check, Pencil, X, Zap } from "lucide-react";
import type { FinanceProduct, SolarProviderKind } from "@prisma/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  saveSolarProviderAction,
  saveSolarProviderTermsAction,
  setSolarProviderActiveAction,
} from "@/server/modules/solar/actions";
import {
  hasProviderTerms,
  providerTermsLine,
  vppRequirementsLine,
  type ProviderTerms,
  type VppListItem,
} from "@/lib/solar-provider-terms";
import { PRODUCT_LABEL } from "@/lib/solar-lender-product";

export type ProviderRow = {
  id: string;
  name: string;
  active: boolean;
  position: number;
} & ProviderTerms;

/** A battery on the catalogue, or a rate-sheet row, as the picker offers it. */
export type BatteryOption = VppListItem;
export type LenderProductOption = VppListItem & { lender: string };

/**
 * What the save posts.
 *
 * IDS, not the labelled lists the row was read with: the office picks from a
 * catalogue whose names it can change tomorrow, and a payload that carried
 * names would write last week's spelling back over it.
 */
export type ProviderTermsInput = Omit<ProviderTerms, "vppBatteries" | "vppProducts"> & {
  vppBatteryIds: string[];
  vppProductIds: string[];
};

/** The four ways a solar deal is ever paid for, in the order a rep meets them. */
const FINANCE_KINDS: FinanceProduct[] = ["cash", "loan", "lease", "ppa"];

/**
 * The two provider lists a solar company sells against.
 *
 * Separate lists because they are separate things: in a deregulated market the
 * utility delivers the power and a retailer bills for it, and a proposal that
 * confuses the two names the wrong company on the customer's own document.
 */
export function SolarProviderManager({
  utilities,
  retailers,
  batteries,
  lenderProducts,
  canEdit,
}: {
  utilities: ProviderRow[];
  retailers: ProviderRow[];
  batteries: BatteryOption[];
  lenderProducts: LenderProductOption[];
  canEdit: boolean;
}) {
  return (
    <div className="space-y-6">
      <ProviderList
        kind="utility"
        title="Utilities"
        blurb="Who physically delivers the power and owns the meter — Oncor, CenterPoint, AEP Texas, TNMP."
        rows={utilities}
        batteries={batteries}
        lenderProducts={lenderProducts}
        canEdit={canEdit}
      />
      <ProviderList
        kind="retail"
        title="Retail electric providers"
        blurb="Who bills the customer, where that is a different company from the utility."
        rows={retailers}
        batteries={batteries}
        lenderProducts={lenderProducts}
        canEdit={canEdit}
      />
    </div>
  );
}

/** Module scope on purpose — react-hooks/static-components is an error here. */
function ProviderList({
  kind,
  title,
  blurb,
  rows,
  batteries,
  lenderProducts,
  canEdit,
}: {
  kind: SolarProviderKind;
  title: string;
  blurb: string;
  rows: ProviderRow[];
  batteries: BatteryOption[];
  lenderProducts: LenderProductOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [adding, setAdding] = React.useState("");

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) return toast.error(res.error ?? "Something went wrong.");
    toast.success(okMsg);
    router.refresh();
  }

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-5">
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{blurb}</p>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing here yet. A rep can still type a provider by hand on the Energy step — this list
          just saves them doing it, and keeps the spelling consistent.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <ProviderItem
              key={r.id}
              row={r}
              batteries={batteries}
              lenderProducts={lenderProducts}
              busy={busy}
              canEdit={canEdit}
              onToggle={() =>
                run(
                  () => setSolarProviderActiveAction(r.id, !r.active),
                  r.active ? "Retired" : "Back in use"
                )
              }
              onSaveTerms={(terms) =>
                run(() => saveSolarProviderTermsAction(r.id, terms), `${r.name} updated`)
              }
            />
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1 space-y-1">
            <Label htmlFor={`add-${kind}`} className="text-xs">
              Add a {kind === "utility" ? "utility" : "retail provider"}
            </Label>
            <Input
              id={`add-${kind}`}
              value={adding}
              placeholder={kind === "utility" ? "e.g. Oncor" : "e.g. Rhythm Energy"}
              onChange={(e) => setAdding(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            disabled={busy || !adding.trim()}
            onClick={async () => {
              const name = adding.trim();
              await run(
                () => saveSolarProviderAction({ kind, name, position: rows.length }),
                `${name} added`
              );
              setAdding("");
            }}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add
          </Button>
        </div>
      )}
    </section>
  );
}

/**
 * One provider, and what the office knows about it.
 *
 * The terms open on demand rather than sitting open on every row: this list
 * runs to two hundred Texas municipals, and seven fields against each of them
 * is a settings page nobody can find anything on. Closed, a provider is a name
 * and one line of summary — which is the form a rep needs it in anyway.
 */
function ProviderItem({
  row,
  batteries,
  lenderProducts,
  busy,
  canEdit,
  onToggle,
  onSaveTerms,
}: {
  row: ProviderRow;
  batteries: BatteryOption[];
  lenderProducts: LenderProductOption[];
  busy: boolean;
  canEdit: boolean;
  onToggle: () => void;
  onSaveTerms: (terms: ProviderTermsInput) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(() => seedTerms(row));

  function open() {
    setDraft(seedTerms(row));
    setEditing(true);
  }

  const summary = providerTermsLine(row);
  const requirements = vppRequirementsLine(row);

  /**
   * The catalogue, plus anything already on this programme that has since left
   * it.
   *
   * A battery the office retired last quarter is still on the list somebody
   * wrote, and if the picker only offered ACTIVE items that tick would have
   * nowhere to render — so the next save would quietly drop it. An option that
   * vanishes from its own select is how a form writes over data nobody touched.
   */
  const batteryChoices = React.useMemo(
    () => withKept(batteries, row.vppBatteries),
    [batteries, row.vppBatteries]
  );
  const productChoices = React.useMemo(
    () =>
      withKept(
        lenderProducts,
        // The row's labels already lead with the lender, so a kept product must
        // not have it prefixed a second time.
        row.vppProducts.map((p) => ({ ...p, lender: "" }))
      ),
    [lenderProducts, row.vppProducts]
  );

  return (
    <li className="py-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <span className={cn("text-sm", !row.active && "text-muted-foreground line-through")}>
            {row.name}
          </span>
          {/* NOTHING RECORDED IS ITS OWN ANSWER. On a list whose job is to say
              who buys back, a blank line reads as "they do not" when it means
              "nobody has checked", and a rep quotes the first one. */}
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {summary ||
              (hasProviderTerms(row) ? "No buyback or programme" : "Buyback and VPP not recorded")}
          </p>
          {/* Who the programme is open to, closed. A row that reads "$500/yr"
              and says nothing about its conditions is the sentence a rep
              repeats across the kitchen table. */}
          {requirements && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">{requirements}</p>
          )}
          {row.notes && (
            <p className="mt-0.5 whitespace-pre-wrap text-[11px] text-muted-foreground">
              {row.notes}
            </p>
          )}
        </div>
        {!row.active && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            retired
          </span>
        )}
        {canEdit && !editing && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={open}>
            <Zap className="size-4" /> Terms
          </Button>
        )}
        {canEdit && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onToggle}>
            {row.active ? <Archive className="size-4" /> : <Undo2 className="size-4" />}
            {row.active ? "Retire" : "Restore"}
          </Button>
        )}
      </div>

      {editing && (
        <div className="mt-2 space-y-3 rounded-lg border border-border bg-muted/30 p-3">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={draft.buyback}
                onChange={(e) => setDraft((d) => ({ ...d, buyback: e.target.checked }))}
              />
              Buys back exported power
            </label>
            {draft.buyback && (
              <div className="ml-6 max-w-56 space-y-1">
                <Label htmlFor={`buyback-${row.id}`} className="text-xs">
                  Export rate ($/kWh)
                </Label>
                <Input
                  id={`buyback-${row.id}`}
                  type="number"
                  step="0.001"
                  value={draft.buybackRate}
                  placeholder="blank — rate varies"
                  onChange={(e) => setDraft((d) => ({ ...d, buybackRate: e.target.value }))}
                />
              </div>
            )}
          </div>

          {/* Time-of-use. The only figures on this form that reach a
              homeowner's document: a storage proposal's savings are the spread
              between them. Both or neither — the action refuses one alone
              rather than letting the savings line vanish unexplained. */}
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-sm font-medium">Time-of-use rates</p>
            <p className="text-xs text-muted-foreground">
              Used to work out what a battery saves by charging off-peak and discharging at peak.
              Leave blank if this provider has no time-of-use plan — the proposal then omits the
              saving rather than guessing at one.
            </p>
            <div className="flex flex-wrap gap-3">
              <div className="w-36 space-y-1">
                <Label htmlFor={`tou-peak-${row.id}`} className="text-xs">
                  Peak ($/kWh)
                </Label>
                <Input
                  id={`tou-peak-${row.id}`}
                  type="number"
                  step="0.001"
                  value={draft.touPeak}
                  placeholder="0.240"
                  onChange={(e) => setDraft((d) => ({ ...d, touPeak: e.target.value }))}
                />
              </div>
              <div className="w-36 space-y-1">
                <Label htmlFor={`tou-off-${row.id}`} className="text-xs">
                  Off-peak ($/kWh)
                </Label>
                <Input
                  id={`tou-off-${row.id}`}
                  type="number"
                  step="0.001"
                  value={draft.touOffPeak}
                  placeholder="0.090"
                  onChange={(e) => setDraft((d) => ({ ...d, touOffPeak: e.target.value }))}
                />
              </div>
              <div className="w-40 space-y-1">
                <Label htmlFor={`tou-window-${row.id}`} className="text-xs">
                  Peak window
                </Label>
                <Input
                  id={`tou-window-${row.id}`}
                  value={draft.touWindow}
                  placeholder="4pm – 8pm"
                  onChange={(e) => setDraft((d) => ({ ...d, touWindow: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={draft.vpp}
                onChange={(e) => setDraft((d) => ({ ...d, vpp: e.target.checked }))}
              />
              Runs a battery / VPP programme
            </label>
            {draft.vpp && (
              <div className="ml-6 grid max-w-2xl gap-2 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor={`vpp-name-${row.id}`} className="text-xs">
                    Programme
                  </Label>
                  <Input
                    id={`vpp-name-${row.id}`}
                    value={draft.vppProgramme}
                    placeholder="e.g. Renew Home"
                    onChange={(e) => setDraft((d) => ({ ...d, vppProgramme: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`vpp-up-${row.id}`} className="text-xs">
                    Upfront ($)
                  </Label>
                  <Input
                    id={`vpp-up-${row.id}`}
                    type="number"
                    value={draft.vppUpfront}
                    onChange={(e) => setDraft((d) => ({ ...d, vppUpfront: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`vpp-yr-${row.id}`} className="text-xs">
                    Per year ($)
                  </Label>
                  <Input
                    id={`vpp-yr-${row.id}`}
                    type="number"
                    value={draft.vppAnnual}
                    onChange={(e) => setDraft((d) => ({ ...d, vppAnnual: e.target.value }))}
                  />
                </div>
              </div>
            )}

            {/* WHO THE PROGRAMME IS OPEN TO.
                Three lists, all ANDed, and every one of them EMPTY MEANS
                EVERYTHING — which is why each says so in its own words rather
                than rendering as blank space. On a screen whose job is to
                record conditions, an empty list is ambiguous between "open to
                all" and "nobody has filled this in", and only one of those is
                safe to quote. */}
            {draft.vpp && (
              <div className="ml-6 space-y-3 border-l border-border pl-3">
                <PickerBlock
                  title="Ways of paying that qualify"
                  hint="Nothing ticked means any. Cash is here and not in the list below because a cash deal has no lender product to tick."
                  empty={draft.financeProducts.length === 0}
                >
                  {FINANCE_KINDS.map((k) => (
                    <Chip
                      key={k}
                      on={draft.financeProducts.includes(k)}
                      label={PRODUCT_LABEL[k]}
                      onClick={() =>
                        setDraft((d) => ({ ...d, financeProducts: toggle(d.financeProducts, k) }))
                      }
                    />
                  ))}
                </PickerBlock>

                <PickerBlock
                  title="Batteries the programme enrols"
                  hint="Nothing ticked means any battery."
                  empty={draft.batteryIds.length === 0}
                  none={
                    batteryChoices.length === 0
                      ? "No batteries on the catalogue yet — add them under Equipment."
                      : null
                  }
                >
                  {batteryChoices.map((b) => (
                    <Chip
                      key={b.id}
                      on={draft.batteryIds.includes(b.id)}
                      label={b.label}
                      gone={b.gone}
                      onClick={() =>
                        setDraft((d) => ({ ...d, batteryIds: toggle(d.batteryIds, b.id) }))
                      }
                    />
                  ))}
                </PickerBlock>

                <PickerBlock
                  title="Specific finance products"
                  hint="Nothing ticked means any product of the types above. Tick rows only where the programme takes some of a lender's paper and not the rest."
                  empty={draft.productIds.length === 0}
                  none={
                    productChoices.length === 0
                      ? "No rate sheet entered yet — add products under Lenders."
                      : null
                  }
                >
                  {productChoices.map((p) => (
                    <Chip
                      key={p.id}
                      on={draft.productIds.includes(p.id)}
                      label={`${p.lender} ${p.label}`.trim()}
                      gone={p.gone}
                      onClick={() =>
                        setDraft((d) => ({ ...d, productIds: toggle(d.productIds, p.id) }))
                      }
                    />
                  ))}
                </PickerBlock>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor={`notes-${row.id}`} className="text-xs">
              Notes
            </Label>
            <Textarea
              id={`notes-${row.id}`}
              rows={2}
              value={draft.notes}
              placeholder="Term length, which batteries qualify, enrolment window — anything the boxes above cannot hold."
              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                onSaveTerms(termsFromDraft(draft));
                setEditing(false);
              }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Save
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
              <X className="size-4" /> Cancel
            </Button>
            <span className="text-[11px] text-muted-foreground">
              <Pencil className="mr-1 inline size-3" />
              Rep-facing only — none of this reaches a customer&rsquo;s proposal.
            </span>
          </div>
        </div>
      )}
    </li>
  );
}

/** The row as text boxes. Money and rates are typed in dollars, stored in cents. */
type TermsDraft = {
  buyback: boolean;
  buybackRate: string;
  touPeak: string;
  touOffPeak: string;
  touWindow: string;
  vpp: boolean;
  vppProgramme: string;
  vppUpfront: string;
  vppAnnual: string;
  financeProducts: FinanceProduct[];
  batteryIds: string[];
  productIds: string[];
  notes: string;
};

function seedTerms(r: ProviderRow): TermsDraft {
  return {
    buyback: r.buyback,
    buybackRate: r.buybackRateMills == null ? "" : (r.buybackRateMills / 1000).toFixed(3),
    touPeak: r.touPeakRateMills == null ? "" : (r.touPeakRateMills / 1000).toFixed(3),
    touOffPeak: r.touOffPeakRateMills == null ? "" : (r.touOffPeakRateMills / 1000).toFixed(3),
    touWindow: r.touPeakWindow ?? "",
    vpp: r.vpp,
    vppProgramme: r.vppProgramme ?? "",
    vppUpfront: r.vppUpfrontCents == null ? "" : String(Math.round(r.vppUpfrontCents / 100)),
    vppAnnual: r.vppAnnualCents == null ? "" : String(Math.round(r.vppAnnualCents / 100)),
    financeProducts: r.vppFinanceProducts,
    batteryIds: r.vppBatteries.map((b) => b.id),
    productIds: r.vppProducts.map((p) => p.id),
    notes: r.notes ?? "",
  };
}

/** In or out, on a list where order carries nothing. */
function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

/**
 * Everything currently on offer, plus whatever this programme already names.
 * Kept items sort last and say what they are, so the live catalogue still reads
 * as the catalogue.
 */
function withKept<T extends VppListItem>(offered: T[], kept: T[]): (T & { gone?: boolean })[] {
  const have = new Set(offered.map((o) => o.id));
  return [
    ...offered,
    ...kept.filter((k) => !have.has(k.id)).map((k) => ({ ...k, gone: true })),
  ];
}

/** A blank box is "not recorded", which is not the same as zero. */
const num = (v: string, scale: number): number | null => {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * scale) : null;
};

function termsFromDraft(d: TermsDraft): ProviderTermsInput {
  return {
    buyback: d.buyback,
    buybackRateMills: num(d.buybackRate, 1000),
    touPeakRateMills: num(d.touPeak, 1000),
    touOffPeakRateMills: num(d.touOffPeak, 1000),
    touPeakWindow: d.touWindow.trim() || null,
    vpp: d.vpp,
    vppProgramme: d.vppProgramme.trim() || null,
    vppUpfrontCents: num(d.vppUpfront, 100),
    vppAnnualCents: num(d.vppAnnual, 100),
    vppFinanceProducts: d.financeProducts,
    vppBatteryIds: d.batteryIds,
    vppProductIds: d.productIds,
    notes: d.notes.trim() || null,
  };
}

/**
 * One condition list: a heading, its chips, and the sentence that says what an
 * empty one means. The sentence is the point — see the note at the call site.
 */
function PickerBlock({
  title,
  hint,
  empty,
  none,
  children,
}: {
  title: string;
  hint: string;
  empty: boolean;
  none?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium">
        {title}
        {empty && <span className="ml-1.5 font-normal text-muted-foreground">Any</span>}
      </p>
      {none ? (
        <p className="text-[11px] text-muted-foreground">{none}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">{children}</div>
      )}
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function Chip({
  on,
  label,
  gone,
  onClick,
}: {
  on: boolean;
  label: string;
  gone?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
        on
          ? "border-violet-300 bg-violet-100 text-violet-900 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200"
          : "border-border hover:bg-muted"
      )}
    >
      {on && <Check className="size-3" />}
      {label}
      {gone && " · retired"}
    </button>
  );
}
