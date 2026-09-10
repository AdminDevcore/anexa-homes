"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, Plus, Zap } from "lucide-react";
import type { FinanceProduct, SolarProviderKind } from "@prisma/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/portal/ui";
import {
  ActiveSwitch,
  Caution,
  ChoiceCards,
  FieldGrid,
  Hint,
  ItemRail,
  Panel,
  PanelEmpty,
  Pill,
  RailGroup,
  RailLayout,
  RailNoMatch,
  RailRow,
  SaveBar,
  StatRow,
  TextAreaField,
  TextField,
} from "@/components/portal/settings-kit";
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

const PROVIDER_TABS = ["details", "rates", "programme"] as const;
type ProviderTab = (typeof PROVIDER_TABS)[number];

type Row = ProviderRow & { kind: SolarProviderKind };

/**
 * Every energy provider this company sells against, one at a time.
 *
 * A LIST AND A PANEL. The screen this replaces printed two hundred Texas
 * municipals as two flat lists and opened a seven-field editor INSIDE whichever
 * row you clicked, pushing everything below it down the page — so finding a
 * provider meant scrolling, and editing one meant losing your place. The rail
 * searches; the panel gets the window.
 *
 * The two kinds stay separate groups inside one rail, because they are separate
 * companies in a deregulated market: the utility delivers the power and owns
 * the meter, the retailer bills for it, and a proposal naming the wrong one is
 * wrong on the customer's own document.
 */
export function SolarProviderManager({
  utilities,
  retailers,
  batteries,
  lenderProducts,
  canEdit,
  initialProviderId,
  initialTab,
}: {
  utilities: ProviderRow[];
  retailers: ProviderRow[];
  batteries: BatteryOption[];
  lenderProducts: LenderProductOption[];
  canEdit: boolean;
  /** Read on the SERVER — see the note on the page. */
  initialProviderId?: string | null;
  initialTab?: string | null;
}) {
  const rows: Row[] = React.useMemo(
    () => [
      ...utilities.map((r) => ({ ...r, kind: "utility" as const })),
      ...retailers.map((r) => ({ ...r, kind: "retail" as const })),
    ],
    [utilities, retailers]
  );

  const live = rows.filter((r) => r.active);
  const [selectedId, setSelectedId] = React.useState<string | null>(
    () => initialProviderId ?? live[0]?.id ?? rows[0]?.id ?? null
  );
  const [tab, setTab] = React.useState<ProviderTab>(() =>
    (PROVIDER_TABS as readonly string[]).includes(initialTab ?? "")
      ? (initialTab as ProviderTab)
      : "details"
  );
  const [query, setQuery] = React.useState("");

  const selected = rows.find((r) => r.id === selectedId) ?? live[0] ?? rows[0] ?? null;

  // Moving between providers is not a navigation, so it replaces rather than
  // pushes — but a reload, or a link sent to somebody, still lands here.
  const idInUrl = selected?.id ?? null;
  React.useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (idInUrl) p.set("provider", idInUrl);
    else p.delete("provider");
    p.set("tab", tab);
    window.history.replaceState(null, "", `${window.location.pathname}?${p}`);
  }, [idInUrl, tab]);

  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) => q === "" || r.name.toLowerCase().includes(q));
  const shownUtilities = shown.filter((r) => r.active && r.kind === "utility");
  const shownRetail = shown.filter((r) => r.active && r.kind === "retail");
  const shownRetired = shown.filter((r) => !r.active);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Zap}
        title="No energy providers yet"
        description="Add the utilities that deliver the power and, where the market is deregulated, the retailers that bill for it. A rep can still type one by hand on the Energy step — this list saves them doing it, and keeps the spelling the same on every proposal."
        action={canEdit ? <AddProviderDialog onAdded={setSelectedId} /> : undefined}
      />
    );
  }

  const railRow = (r: Row) => (
    <RailRow
      key={r.id}
      title={r.name}
      subtitle={providerTermsLine(r) || (hasProviderTerms(r) ? "no buyback or programme" : "nothing recorded")}
      selected={r.id === selected?.id}
      onSelect={() => setSelectedId(r.id)}
      needsWork={r.active && !hasProviderTerms(r)}
      muted={!r.active}
    />
  );

  return (
    <RailLayout
      rail={
        <ItemRail
          label="Energy providers"
          add={canEdit ? <AddProviderDialog onAdded={setSelectedId} full /> : undefined}
          query={query}
          onQueryChange={setQuery}
          searchPlaceholder="Find a provider"
          showSearch={rows.length > 6}
        >
          {shownUtilities.length > 0 && <RailGroup>Utilities ({shownUtilities.length})</RailGroup>}
          {shownUtilities.map(railRow)}

          {shownRetail.length > 0 && <RailGroup>Retail providers ({shownRetail.length})</RailGroup>}
          {shownRetail.map(railRow)}

          {shownRetired.length > 0 && <RailGroup>Retired ({shownRetired.length})</RailGroup>}
          {shownRetired.map(railRow)}

          {shown.length === 0 && <RailNoMatch query={query} />}
        </ItemRail>
      }
    >
      {selected && (
        <ProviderPanel
          // Keyed so switching providers remounts the panel: a draft belongs to
          // the provider it was seeded from.
          key={selected.id}
          row={selected}
          batteries={batteries}
          lenderProducts={lenderProducts}
          canEdit={canEdit}
          tab={tab}
          onTabChange={setTab}
        />
      )}
    </RailLayout>
  );
}

/**
 * Everything the office knows about one provider.
 *
 * Three tabs because there are three separate questions: who they are, what
 * they pay for power, and what their battery programme takes. Every field is
 * rep-facing except the two time-of-use rates, which are the only figures here
 * that reach a homeowner's document — a storage proposal's savings are the
 * spread between them, which is why they are called out on their own.
 */
function ProviderPanel({
  row,
  batteries,
  lenderProducts,
  canEdit,
  tab,
  onTabChange,
}: {
  row: Row;
  batteries: BatteryOption[];
  lenderProducts: LenderProductOption[];
  canEdit: boolean;
  tab: ProviderTab;
  onTabChange: (t: ProviderTab) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [draft, setDraft] = React.useState(() => seedTerms(row));

  // Re-seed during render when the server sends something new — an effect would
  // paint the pre-save values for a frame after every refresh.
  const serverKey = JSON.stringify([row.id, seedTerms(row)]);
  const [seen, setSeen] = React.useState(serverKey);
  if (seen !== serverKey) {
    setSeen(serverKey);
    setDraft(seedTerms(row));
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(seedTerms(row));
  const set = <K extends keyof TermsDraft>(k: K, v: TermsDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

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

  /** Both rates or neither — the action refuses one alone, so say so first. */
  const halfTou = (draft.touPeak.trim() === "") !== (draft.touOffPeak.trim() === "");

  async function act(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setBusy(true);
    try {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error ?? "Something went wrong.");
        return res;
      }
      toast.success(okMsg);
      router.refresh();
      return res;
    } finally {
      setBusy(false);
    }
  }

  /**
   * ONE SAVE for the whole panel, across two server actions.
   *
   * The name lives on the provider row and the terms on their own action, but
   * that is a fact about the schema, not something a person editing a provider
   * should have to know — so the rename only posts when the name actually
   * changed, and a failure there stops the terms going in behind it.
   */
  async function save() {
    setBusy(true);
    try {
      const name = draft.name.trim();
      if (name === "") return toast.error("A provider needs a name.");
      if (name !== row.name) {
        const res = await saveSolarProviderAction({ id: row.id, kind: row.kind, name });
        if (!res.ok) return toast.error(res.error ?? "Could not rename this provider.");
      }
      const res = await saveSolarProviderTermsAction(row.id, termsFromDraft(draft));
      if (!res.ok) return toast.error(res.error ?? "Something went wrong.");
      toast.success(`${name} saved`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const requirements = vppRequirementsLine(row);

  return (
    <div className="min-w-0" data-testid="provider-panel">
      <header className="flex flex-wrap items-start gap-3 border-b border-border pb-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate font-display text-xl font-semibold tracking-tight">
              {row.name}
            </h2>
            {!row.active && !canEdit && <Pill>Retired</Pill>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Pill>{row.kind === "utility" ? "Utility" : "Retail provider"}</Pill>
            {row.buyback ? (
              <Pill tone="solar">
                Buys back
                {row.buybackRateMills != null && ` $${(row.buybackRateMills / 1000).toFixed(3)}/kWh`}
              </Pill>
            ) : (
              <Pill>No buyback</Pill>
            )}
            {row.vpp && <Pill tone="gold">{row.vppProgramme?.trim() || "Battery programme"}</Pill>}
            {row.touPeakRateMills != null && <Pill tone="gold">Time-of-use</Pill>}
            {!hasProviderTerms(row) && <Pill tone="warn">Nothing recorded</Pill>}
          </div>
        </div>

        {canEdit && (
          <ActiveSwitch
            label={`In use — ${row.name}`}
            checked={row.active}
            disabled={busy}
            hint="Retired: reps stop seeing it, and the deals already naming it keep working."
            onChange={(v) =>
              void act(
                () => setSolarProviderActiveAction(row.id, v),
                v ? "Back in use" : "Retired"
              )
            }
          />
        )}
      </header>

      <Tabs value={tab} onValueChange={(v) => onTabChange(v as ProviderTab)} className="mt-4 gap-4">
        <TabsList variant="line" className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="rates">
            Rates
            {row.touPeakRateMills != null && (
              <span className="size-1.5 rounded-full bg-gold" aria-hidden />
            )}
          </TabsTrigger>
          <TabsTrigger value="programme">
            Battery programme
            {row.vpp && <span className="size-1.5 rounded-full bg-solar" aria-hidden />}
          </TabsTrigger>
        </TabsList>

        {/* ── DETAILS ──────────────────────────────────────────────────── */}
        <TabsContent value="details" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
            <div className="space-y-4">
              <Panel
                title="Identity"
                description="The spelling here is the spelling on every proposal that names this provider."
              >
                <TextField
                  label="Provider name"
                  value={draft.name}
                  onChange={(v) => set("name", v)}
                  id={`pv-${row.id}-name`}
                />
              </Panel>

              <Panel
                title="Notes"
                description="Rep-facing only — none of this reaches a customer's proposal."
              >
                <TextAreaField
                  label="What the office knows"
                  value={draft.notes}
                  rows={4}
                  placeholder="Term length, which batteries qualify, enrolment window — anything the boxes on the other tabs cannot hold."
                  onChange={(v) => set("notes", v)}
                />
              </Panel>
            </div>

            <div className="xl:sticky xl:top-20 xl:self-start">
              <Panel title="At a glance" tone="muted">
                <dl>
                  <StatRow label="Kind" value={row.kind === "utility" ? "Utility" : "Retail"} />
                  <StatRow
                    label="Buyback"
                    value={
                      row.buyback
                        ? row.buybackRateMills != null
                          ? `$${(row.buybackRateMills / 1000).toFixed(3)}/kWh`
                          : "yes — rate varies"
                        : "no"
                    }
                    tone={row.buyback ? "plain" : "warn"}
                  />
                  <StatRow
                    label="Time-of-use"
                    value={row.touPeakRateMills != null ? row.touPeakWindow || "set" : "not set"}
                  />
                  <StatRow
                    label="Battery programme"
                    value={row.vpp ? row.vppProgramme?.trim() || "yes" : "none"}
                  />
                </dl>
                {requirements && <Hint className="mt-2">{requirements}</Hint>}
              </Panel>
            </div>
          </div>
        </TabsContent>

        {/* ── RATES ────────────────────────────────────────────────────── */}
        <TabsContent value="rates" className="space-y-4">
          <Panel
            title="Exported power"
            description="What this provider pays for the power a system sends back to the grid."
          >
            <ChoiceCards
              name={`buyback-${row.id}`}
              legend="Does this provider buy back exports?"
              value={draft.buyback ? "yes" : "no"}
              onChange={(v) => set("buyback", v === "yes")}
              columns={2}
              options={[
                {
                  value: "yes",
                  label: "Yes",
                  detail: "Exports are credited. Type the rate if it is a fixed one.",
                },
                {
                  value: "no",
                  label: "No",
                  detail: "Exports earn nothing, so the value of the system is what it offsets.",
                },
              ]}
            />
            {draft.buyback && (
              <RateField
                id={`buyback-${row.id}`}
                label="Export rate"
                value={draft.buybackRate}
                onChange={(v) => set("buybackRate", v)}
                placeholder="blank — rate varies"
              />
            )}
          </Panel>

          <Panel
            title="Time-of-use rates"
            tone="accent"
            description="The only figures on this screen that reach a homeowner's document — a storage proposal's saving is the spread between them. Leave both blank where this provider has no time-of-use plan, and the proposal omits the line rather than guessing at one."
          >
            <FieldGrid columns={3}>
              <RateField
                id={`tou-peak-${row.id}`}
                label="Peak"
                value={draft.touPeak}
                onChange={(v) => set("touPeak", v)}
                placeholder="0.240"
              />
              <RateField
                id={`tou-off-${row.id}`}
                label="Off-peak"
                value={draft.touOffPeak}
                onChange={(v) => set("touOffPeak", v)}
                placeholder="0.090"
              />
              <TextField
                label="Peak window"
                value={draft.touWindow}
                placeholder="4pm – 8pm"
                onChange={(v) => set("touWindow", v)}
              />
            </FieldGrid>
            {halfTou && (
              <Caution>
                Enter both the peak and the off-peak rate, or neither. One rate on its own computes
                no saving, and the proposal would drop the line with nothing to say why.
              </Caution>
            )}
          </Panel>
        </TabsContent>

        {/* ── BATTERY PROGRAMME ────────────────────────────────────────── */}
        <TabsContent value="programme" className="space-y-4">
          <Panel
            title="Virtual power plant"
            description="What this provider pays a customer for letting it call on their battery."
          >
            <ChoiceCards
              name={`vpp-${row.id}`}
              legend="Does this provider run a battery programme?"
              value={draft.vpp ? "yes" : "no"}
              onChange={(v) => set("vpp", v === "yes")}
              columns={2}
              options={[
                {
                  value: "yes",
                  label: "Yes",
                  detail: "Its payments flow into the savings a storage proposal quotes.",
                },
                { value: "no", label: "No", detail: "Nothing is added to a storage proposal." },
              ]}
            />

            {draft.vpp && (
              <FieldGrid columns={3}>
                <TextField
                  label="Programme"
                  value={draft.vppProgramme}
                  placeholder="e.g. Renew Home"
                  onChange={(v) => set("vppProgramme", v)}
                />
                <TextField
                  label="Upfront ($)"
                  type="number"
                  value={draft.vppUpfront}
                  onChange={(v) => set("vppUpfront", v)}
                />
                <TextField
                  label="Per year ($)"
                  type="number"
                  value={draft.vppAnnual}
                  onChange={(v) => set("vppAnnual", v)}
                />
              </FieldGrid>
            )}
          </Panel>

          {/* WHO THE PROGRAMME IS OPEN TO.
              Three lists, all ANDed, and every one of them EMPTY MEANS
              EVERYTHING — which is why each says so in its own words rather
              than rendering as blank space. On a screen whose job is to record
              conditions, an empty list is ambiguous between "open to all" and
              "nobody has filled this in", and only one of those is safe to
              quote across a kitchen table. */}
          {draft.vpp && (
            <Panel
              title="Who it is open to"
              description="All three conditions have to hold. Ticking nothing in a list means it does not narrow anything."
            >
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
                    onClick={() => set("financeProducts", toggle(draft.financeProducts, k))}
                  />
                ))}
              </PickerBlock>

              <PickerBlock
                title="Batteries the programme enrols"
                hint="Nothing ticked means any battery."
                empty={draft.batteryIds.length === 0}
                none={
                  batteryChoices.length === 0
                    ? "No batteries on the catalogue yet — add them under Solar Equipment."
                    : null
                }
              >
                {batteryChoices.map((b) => (
                  <Chip
                    key={b.id}
                    on={draft.batteryIds.includes(b.id)}
                    label={b.label}
                    gone={b.gone}
                    onClick={() => set("batteryIds", toggle(draft.batteryIds, b.id))}
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
                    onClick={() => set("productIds", toggle(draft.productIds, p.id))}
                  />
                ))}
              </PickerBlock>
            </Panel>
          )}

          {!draft.vpp && (
            <PanelEmpty>
              No battery programme, so nothing is added to a storage proposal for this provider.
            </PanelEmpty>
          )}
        </TabsContent>
      </Tabs>

      {canEdit && (
        <SaveBar
          dirty={dirty}
          busy={busy}
          what={row.name}
          onSave={save}
          onDiscard={() => setDraft(seedTerms(row))}
          disabled={halfTou}
          blockedReason={
            halfTou ? "Enter both time-of-use rates, or neither, before saving." : undefined
          }
        />
      )}
    </div>
  );
}

/** A $/kWh box. Three decimals, because these rates are cents-and-tenths. */
function RateField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs" htmlFor={id}>
        {label} ($/kWh)
      </Label>
      <Input
        id={id}
        type="number"
        step="0.001"
        value={value}
        placeholder={placeholder}
        className="tabular-nums"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** Adding a provider: which kind it is, and what it is called. */
function AddProviderDialog({
  onAdded,
  full,
}: {
  onAdded: (id: string) => void;
  full?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [kind, setKind] = React.useState<SolarProviderKind>("utility");
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await saveSolarProviderAction({ kind, name: name.trim() });
      if (!res.ok) return toast.error(res.error ?? "Something went wrong.");
      onAdded(res.id);
      toast.success(`${name.trim()} added`);
      setName("");
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className={full ? "w-full" : undefined}>
          <Plus className="size-4" /> New provider
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add an energy provider</DialogTitle>
          <DialogDescription>
            Its buyback rate, time-of-use plan and battery programme are filled in on the panel
            next.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <ChoiceCards
            name="new-provider-kind"
            legend="Which is it?"
            value={kind}
            onChange={(v) => setKind(v)}
            columns={2}
            options={[
              {
                value: "utility" as SolarProviderKind,
                label: "Utility",
                detail: "Delivers the power and owns the meter — Oncor, CenterPoint, AEP.",
              },
              {
                value: "retail" as SolarProviderKind,
                label: "Retail provider",
                detail: "Bills the customer, where that is a different company.",
              },
            ]}
          />
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="new-provider-name">
              Name
            </Label>
            <Input
              id="new-provider-name"
              value={name}
              placeholder={kind === "utility" ? "e.g. Oncor" : "e.g. Rhythm Energy"}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void add();
                }
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={add} disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add
            provider
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The row as text boxes. Money and rates are typed in dollars, stored in cents. */
type TermsDraft = {
  name: string;
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
    name: r.name,
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
        <Hint>{none}</Hint>
      ) : (
        <div className="flex flex-wrap gap-1.5">{children}</div>
      )}
      <Hint>{hint}</Hint>
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
          ? "border-gold/50 bg-gold/[0.12] text-gold-muted"
          : "border-border hover:bg-muted"
      )}
    >
      {on && <Check className="size-3" />}
      {label}
      {gone && " · retired"}
    </button>
  );
}
