"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ActiveSwitch,
  Caution,
  ChoiceCards,
  FieldGrid,
  Hint,
  MoneyField,
  Panel,
  Pill,
  SaveBar,
  StatRow,
  TextAreaField,
  TextField,
  ToggleRow,
} from "@/components/portal/settings-kit";
import { ADDER_BASES, ADDER_BASIS_ORDER, type AdderBasis } from "@/lib/solar-adders";
import {
  deleteSolarEquipmentAction,
  setSolarEquipmentActiveAction,
  upsertSolarEquipmentAction,
} from "@/server/modules/solar/actions";
import { bandLabel, catalogueRateLabel, type AdderItem } from "./types";

export const ADDER_TABS = ["details", "pricing", "rules"] as const;
export type AdderTab = (typeof ADDER_TABS)[number];

type Draft = {
  label: string;
  description: string;
  basis: AdderBasis;
  price: string;
  perWatt: string;
  cost: string;
  autoApply: boolean;
  minKw: string;
  maxKw: string;
  outsidePriceRule: boolean;
};

const seed = (a: AdderItem): Draft => ({
  label: a.label,
  description: a.description ?? "",
  basis: a.basis,
  price: a.priceCents ? String(a.priceCents / 100) : "",
  perWatt: a.priceMillsPerWatt != null ? String(a.priceMillsPerWatt / 1000) : "",
  cost: a.costCents ? String(a.costCents / 100) : "",
  autoApply: a.autoApplyMinKw != null || a.autoApplyMaxKw != null,
  minKw: a.autoApplyMinKw != null ? String(a.autoApplyMinKw) : "",
  maxKw: a.autoApplyMaxKw != null ? String(a.autoApplyMaxKw) : "",
  outsidePriceRule: a.outsidePriceRule,
});

/** What each way of pricing actually does on a deal. */
const BASIS_DETAIL: Record<AdderBasis, string> = {
  flat: "One amount, whatever the system size.",
  perUnit: "An amount for one. The rep enters how many on the deal.",
  perFoot: "A rate per foot. The rep enters the run length on the deal.",
  perWatt: "Follows the array — the charge moves when the design does.",
  custom: "Priced on the day. The rep types the amount on the deal.",
  discount: "Comes off the price. Enter it as a positive number.",
};

/**
 * One adder: what it is, what it costs, and when it lands on a deal by itself.
 *
 * The rules tab is the one worth the width. An auto-apply band puts money on
 * somebody's deal without anybody choosing it, and "financed on top" changes
 * what a lender is asked to fund — both are sentences, not checkboxes, and the
 * dialog this replaces had to fit them into a 28rem column.
 */
export function AdderPanel({
  adder,
  canEdit,
  rank,
  of,
  onMove,
  tab,
  onTabChange,
  onDeleted,
}: {
  adder: AdderItem;
  canEdit: boolean;
  /** 1-based place in the selling order, and how many are being sold. */
  rank: number | null;
  of: number;
  onMove: ((delta: number) => void) | null;
  tab: AdderTab;
  onTabChange: (t: AdderTab) => void;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [draft, setDraft] = React.useState(() => seed(adder));

  const serverKey = JSON.stringify([adder.id, seed(adder)]);
  const [seen, setSeen] = React.useState(serverKey);
  if (seen !== serverKey) {
    setSeen(serverKey);
    setDraft(seed(adder));
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(seed(adder));
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const meta = ADDER_BASES[draft.basis];
  const isRate = draft.basis === "perWatt";
  const band = bandLabel(adder.autoApplyMinKw, adder.autoApplyMaxKw);

  /** The rules the action enforces, said before the save is attempted. */
  const noRate = isRate && draft.perWatt.trim() === "";
  const noPrice =
    !isRate && draft.basis !== "custom" && (draft.price.trim() === "" || Number(draft.price) === 0);
  const badBand =
    draft.autoApply &&
    draft.minKw.trim() !== "" &&
    draft.maxKw.trim() !== "" &&
    Number(draft.minKw) >= Number(draft.maxKw);
  const discountOnTop = draft.outsidePriceRule && draft.basis === "discount";
  const blocked = noRate || noPrice || badBand || discountOnTop || draft.label.trim() === "";

  async function act(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setBusy(true);
    try {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error ?? "Something went wrong.", { duration: 9000 });
        return res;
      }
      toast.success(okMsg);
      router.refresh();
      return res;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    /**
     * The busy flag is cleared in `finally`, not after the await.
     *
     * A server action that THROWS — rather than returning `{ ok: false }` —
     * skips every line after it, and the flag latches on: the panel is left
     * with a spinning button and every field disabled, and the only way out is
     * a page reload.
     */
    try {
      const res = await upsertSolarEquipmentAction(adder.id, {
        kind: "adder",
        manufacturer: null,
        model: draft.label.trim(),
        description: draft.description.trim() || null,
        adderBasis: draft.basis,
        costCents: draft.cost ? Math.round(Number(draft.cost) * 100) : 0,
        priceCents: isRate ? 0 : draft.price ? Math.round(Number(draft.price) * 100) : 0,
        // Dollars per watt on screen, mills per watt on the wire. $0.05 → 50.
        priceMillsPerWatt:
          isRate && draft.perWatt.trim() !== "" ? Math.round(Number(draft.perWatt) * 1000) : null,
        // Both cleared when the rule is switched off, so an unticked box cannot
        // leave a band behind that keeps firing.
        autoApplyMinKw: draft.autoApply && draft.minKw.trim() !== "" ? Number(draft.minKw) : null,
        autoApplyMaxKw: draft.autoApply && draft.maxKw.trim() !== "" ? Number(draft.maxKw) : null,
        outsidePriceRule: draft.outsidePriceRule,
      });
      if (!res.ok) return toast.error(res.error, { duration: 9000 });
      toast.success(`${draft.label.trim()} saved`);
      router.refresh();
    } catch {
      toast.error("That did not save. Try again, or reload if it keeps failing.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0" data-testid="adder-panel">
      <header className="flex flex-wrap items-start gap-3 border-b border-border pb-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate font-display text-xl font-semibold tracking-tight">
              {adder.label}
            </h2>
            {!adder.isActive && !canEdit && <Pill>Retired</Pill>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Pill tone="gold">
              {adder.basis === "discount" ? "" : "+ "}
              {catalogueRateLabel(adder)}
            </Pill>
            <Pill>{ADDER_BASES[adder.basis].label}</Pill>
            {band && <Pill tone="solar">auto · {band}</Pill>}
            {adder.outsidePriceRule && <Pill tone="solar">on top of a fixed price</Pill>}
            {rank != null && (
              <Pill>
                #{rank} of {of}
              </Pill>
            )}
          </div>
        </div>

        {/* Up/down rather than a drag handle: the same reorder, but it works
            from a keyboard, on a trackpad, and on a phone. */}
        {canEdit && onMove && (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="icon-sm"
              variant="outline"
              disabled={busy || rank === 1}
              aria-label={`Move ${adder.label} up the selling order`}
              onClick={() => onMove(-1)}
            >
              <ChevronUp className="size-4" />
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              disabled={busy || rank === of}
              aria-label={`Move ${adder.label} down the selling order`}
              onClick={() => onMove(1)}
            >
              <ChevronDown className="size-4" />
            </Button>
          </div>
        )}

        {canEdit && (
          <ActiveSwitch
            label={`In use — ${adder.label}`}
            checked={adder.isActive}
            disabled={busy}
            hint="Retired: hidden from new designs, kept on the quotes that already carry it."
            onChange={(v) =>
              void act(
                () => setSolarEquipmentActiveAction(adder.id, v),
                v ? "Sellable again" : "Retired"
              )
            }
          />
        )}

        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={busy}
                aria-label={`More for ${adder.label}`}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuItem
                variant="destructive"
                onSelect={async () => {
                  const res = await act(() => deleteSolarEquipmentAction(adder.id), "Deleted");
                  if (res.ok) onDeleted();
                }}
              >
                <Trash2 className="size-4" /> Delete permanently
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      <Tabs value={tab} onValueChange={(v) => onTabChange(v as AdderTab)} className="mt-4 gap-4">
        <TabsList variant="line" className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="pricing">Pricing</TabsTrigger>
          <TabsTrigger value="rules">
            Rules
            {(adder.autoApplyMinKw != null ||
              adder.autoApplyMaxKw != null ||
              adder.outsidePriceRule) && <span className="size-1.5 rounded-full bg-solar" aria-hidden />}
          </TabsTrigger>
        </TabsList>

        {/* ── DETAILS ──────────────────────────────────────────────────── */}
        <TabsContent value="details" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
            <div className="space-y-4">
              <Panel title="What the work is">
                <TextField
                  label="Name"
                  value={draft.label}
                  onChange={(v) => set("label", v)}
                  placeholder="e.g. Trenching Adder"
                  id={`adder-${adder.id}-name`}
                />
                <TextAreaField
                  label="Description"
                  value={draft.description}
                  rows={3}
                  onChange={(v) => set("description", v)}
                  placeholder="What the work actually is, in your own words."
                  hint="A rep and a homeowner both read this, so it should say what the work IS rather than repeat its name."
                />
              </Panel>
            </div>

            <div className="xl:sticky xl:top-20 xl:self-start">
              <Panel title="At a glance" tone="muted">
                <dl>
                  <StatRow label="Priced" value={ADDER_BASES[adder.basis].label} />
                  <StatRow label="Charge" value={catalogueRateLabel(adder)} />
                  <StatRow
                    label="Cost to us"
                    value={adder.costCents ? `$${(adder.costCents / 100).toLocaleString()}` : "—"}
                  />
                  <StatRow label="Auto-applies" value={band ?? "no"} />
                  <StatRow
                    label="On top of a fixed price"
                    value={adder.outsidePriceRule ? "yes" : "no"}
                  />
                  <StatRow label="Selling order" value={rank == null ? "retired" : `#${rank}`} />
                </dl>
              </Panel>
            </div>
          </div>
        </TabsContent>

        {/* ── PRICING ──────────────────────────────────────────────────── */}
        <TabsContent value="pricing" className="space-y-4">
          <Panel
            title="How the money is worked out"
            description="Six ways, because “$2,700”, “$2,700 each”, “$10 a foot” and “$2,700 off” are four different prices that one amount column cannot tell apart."
          >
            <ChoiceCards
              name={`adder-basis-${adder.id}`}
              legend="Priced as"
              value={draft.basis}
              onChange={(v) => set("basis", v)}
              columns={3}
              options={ADDER_BASIS_ORDER.map((b) => ({
                value: b,
                label: ADDER_BASES[b].label,
                detail: BASIS_DETAIL[b],
              }))}
            />
          </Panel>

          <Panel title="The amounts">
            <FieldGrid columns={2}>
              {isRate ? (
                <MoneyField
                  label="Price"
                  suffix="/W"
                  value={draft.perWatt}
                  onChange={(v) => set("perWatt", v)}
                  placeholder="0.05"
                  invalid={noRate}
                  hint="Per installed watt. $0.05/W on a 10 kW system is $500."
                />
              ) : (
                <MoneyField
                  label="Price"
                  suffix={meta.unit ? `per ${meta.unit}` : undefined}
                  value={draft.price}
                  onChange={(v) => set("price", v)}
                  invalid={noPrice}
                  hint={
                    draft.basis === "custom"
                      ? "Optional — a custom adder is priced on the day, by the rep, on the deal."
                      : undefined
                  }
                />
              )}
              <MoneyField
                label="Cost to us"
                value={draft.cost}
                onChange={(v) => set("cost", v)}
                hint="Never shown to a customer. It is what the margin on this line is measured against."
              />
            </FieldGrid>
            {noRate && <Caution>A per-watt adder needs a rate per watt, or it prices at zero.</Caution>}
            {noPrice && (
              <Caution>
                Give the adder a price. Everything except a custom adder needs one, and an adder
                with none lands on a deal at $0 without saying so.
              </Caution>
            )}
          </Panel>
        </TabsContent>

        {/* ── RULES ────────────────────────────────────────────────────── */}
        <TabsContent value="rules" className="space-y-4">
          <Panel
            title="Land on a deal by itself"
            tone={draft.autoApply ? "accent" : "plain"}
            description="Whenever the drawn array falls in this band, this adder puts itself on the deal — and comes back off when the design moves out of it."
          >
            <ToggleRow
              label="Auto-apply by system size"
              description="Nobody chooses it on the deal. Use it for a charge that is really a function of size."
              checked={draft.autoApply}
              onChange={(v) => set("autoApply", v)}
            />
            {draft.autoApply && (
              <>
                <FieldGrid columns={2}>
                  <TextField
                    label="From (kW DC)"
                    type="number"
                    value={draft.minKw}
                    onChange={(v) => set("minKw", v)}
                    placeholder="any"
                  />
                  <TextField
                    label="Up to (kW DC)"
                    type="number"
                    value={draft.maxKw}
                    onChange={(v) => set("maxKw", v)}
                    placeholder="any"
                  />
                </FieldGrid>
                <Hint>
                  Leave one blank for an open end — blank “from” and 5 in “up to” is a small-system
                  charge under 5 kW. The lower figure counts, the upper one does not, so bands
                  written back to back never both fire.
                </Hint>
                {badBand && (
                  <Caution>
                    The smallest system size has to be below the largest, or the band fires on
                    nothing — a rule that looks configured and does nothing.
                  </Caution>
                )}
              </>
            )}
          </Panel>

          <Panel
            title="Financed on top of a fixed price"
            tone={draft.outsidePriceRule ? "accent" : "plain"}
          >
            <ToggleRow
              label="Added above the partner's rate"
              description="For work a partner funds above its fixed or maximum $/W — a roof. The dealer fee still applies to it."
              checked={draft.outsidePriceRule}
              onChange={(v) => set("outsidePriceRule", v)}
            />
            <Hint>
              On a lender with a fixed or maximum $/W this is added on top of that rate instead of
              coming out of the system price. It is still part of the gross, so the dealer fee is taken
              on it like every other adder: at an 18% fee, 10 kW at $5.50/W is $55,000, and $63,537
              with a $7,000 roof. Every other adder still comes out of the rate, and nothing changes on
              a lender with no fixed rate.
            </Hint>
            {discountOnTop && (
              <Caution>
                A discount cannot be financed on top of a fixed price — that is money coming off a
                number the partner never funded.
              </Caution>
            )}
          </Panel>
        </TabsContent>
      </Tabs>

      {canEdit && (
        <SaveBar
          dirty={dirty}
          busy={busy}
          what={adder.label}
          onSave={save}
          onDiscard={() => setDraft(seed(adder))}
          disabled={blocked}
          blockedReason={
            blocked ? "Fix what is flagged above before this adder can be saved." : undefined
          }
        />
      )}
    </div>
  );
}
