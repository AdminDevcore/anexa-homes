"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2,
  Check,
  ExternalLink,
  MoreHorizontal,
  Archive,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { LenderMark } from "@/components/ui/lender-mark";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { basePpwFromSticker } from "@/lib/solar-money";
import {
  reconcileContract,
  DISCLOSURE_TOKENS,
  DISCLOSURE_TEMPLATE_SUGGESTION,
} from "@/lib/solar-contract-adjustment";
import {
  upsertSolarLenderAction,
  setSolarLenderActiveAction,
  deleteSolarLenderAction,
  setLenderAdderRulesAction,
} from "@/server/modules/solar/actions";
import type { AdderRuleOption, LenderRow, PricingMode } from "./types";
import {
  adjustmentToCents,
  batteryPriceToCents,
  draftFrom,
  money,
  ppwToCents,
  ppwToDollars,
  resolvedAdderRules,
} from "./types";
import {
  Caution,
  ChoiceCards,
  Figure,
  Hint,
  InfoTip,
  MoneyField,
  Panel,
  Pill,
  TextField,
} from "@/components/portal/settings-kit/fields";
import { LogoControl } from "./logo-control";
import { LenderApiKeyField } from "./api-key-field";
import { RateSheetPanel } from "./rate-sheet";
import { setLenderEquipmentNamesAction } from "@/server/modules/solar/amos-actions";
import { AdderRulesPanel } from "./adder-rules";
import {
  LenderEquipmentPanel,
  equipmentNameDraftFrom,
  type EquipmentNameDraft,
} from "./equipment-names";

export const LENDER_TABS = ["details", "pricing", "rates", "adders", "equipment", "legal"] as const;
export type LenderTab = (typeof LENDER_TABS)[number];

/** The example job every "what does this mean" line on the Pricing tab is worked on. */
const EXAMPLE_KW = 10;

/**
 * The cell where a price box would be, on a partner that publishes none.
 *
 * A hole in the row would be worse than a box: the ceiling and the floor are
 * read as a pair, and an empty half reads as a field that failed to render
 * rather than as a partner that prices the ordinary way.
 */
function NotPriced({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

/**
 * Everything about ONE financing partner, in one place.
 *
 * The screen this replaces spread a lender over three sections of one long
 * page — a card, a rate sheet a screenful below it, and an adder table below
 * that — and put the edit form INSIDE a third-width grid card, so twenty
 * fields stacked down a narrow column with two thirds of the window empty
 * beside them. Setting up a partner meant scrolling past every other partner
 * twice.
 *
 * One lender at a time, full width, grouped by the question being answered:
 * who they are, what they charge, what they finance, what rides on top, and
 * the wording that reaches a customer. One Save at the bottom commits the lot.
 */
export function LenderDetail({
  lender,
  canEdit,
  sellableEquipment,
  targetNetPpwCents,
  adderCatalogue,
  tab,
  onTabChange,
  onDeleted,
}: {
  lender: LenderRow;
  canEdit: boolean;
  sellableEquipment: number;
  targetNetPpwCents: number | null;
  adderCatalogue: AdderRuleOption[];
  tab: LenderTab;
  onTabChange: (t: LenderTab) => void;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [draft, setDraft] = React.useState(() => draftFrom(lender));
  const [adderDraft, setAdderDraft] = React.useState(() => resolvedAdderRules(lender, adderCatalogue));
  const [equipDraft, setEquipDraft] = React.useState<EquipmentNameDraft>(() =>
    equipmentNameDraftFrom(lender)
  );

  /**
   * Re-seed when the server sends something new — DURING RENDER, not in an
   * effect: an effect that calls setState runs after a paint, so the panel
   * would flash the pre-save values for a frame on every refresh.
   *
   * Keyed on the lender's id and on a SIGNATURE of what the server sent, not
   * on the object: `lender` arrives from a server component and is a new
   * object every render, so a reference check would re-seed on refreshes that
   * changed nothing and throw away an edit somebody was halfway through.
   */
  const serverKey = JSON.stringify([
    lender.id,
    draftFrom(lender),
    resolvedAdderRules(lender, adderCatalogue),
    equipmentNameDraftFrom(lender),
  ]);
  const [seen, setSeen] = React.useState(serverKey);
  if (seen !== serverKey) {
    setSeen(serverKey);
    setDraft(draftFrom(lender));
    setAdderDraft(resolvedAdderRules(lender, adderCatalogue));
    setEquipDraft(equipmentNameDraftFrom(lender));
  }

  const savedDraft = draftFrom(lender);
  const savedRules = resolvedAdderRules(lender, adderCatalogue);
  const savedEquip = equipmentNameDraftFrom(lender);
  const fieldsDirty = JSON.stringify(draft) !== JSON.stringify(savedDraft);
  const addersDirty = adderCatalogue.some((a) => adderDraft[a.id] !== savedRules[a.id]);
  const equipDirty = JSON.stringify(equipDraft) !== JSON.stringify(savedEquip);
  const dirty = fieldsDirty || addersDirty || equipDirty;

  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const liveProducts = lender.products.filter((p) => p.isActive);

  /**
   * The most this lender's own ceiling can leave the company, per watt.
   *
   * Worth spelling out beside the floor box because the two interact in a way
   * that is not obvious from either one: a capped partner funds one number, so
   * whatever base is typed, only `cap × (1 − fee)` survives. Amos caps at
   * $5.50/W on a 65% fee, which is $1.93 — set a $3.00 floor there and every
   * deal on that partner blocks, with nothing on the screen having warned you.
   *
   * Taken against the LOWEST fee on the rate sheet, because that is the
   * programme that leaves the most; a floor above this is unreachable on any of
   * them. Read off the DRAFT, so the sentence moves while the cap is typed.
   */
  const draftPpwCents = React.useMemo(() => {
    if (draft.ppwMode === "normal") return null;
    const c = ppwToCents(draft.maxFinalPpw);
    return c === "invalid" ? null : c;
  }, [draft.ppwMode, draft.maxFinalPpw]);

  const capBasePpwCents = React.useMemo(() => {
    if (draftPpwCents == null) return null;
    const fees = liveProducts.filter((p) => p.dealerFeePct != null).map((p) => p.dealerFeePct!);
    if (fees.length === 0) return null;
    return basePpwFromSticker(draftPpwCents, Math.min(...fees));
  }, [draftPpwCents, liveProducts]);

  const floorCents = React.useMemo(() => {
    const c = ppwToCents(draft.minBasePpw);
    return c === "invalid" ? null : c;
  }, [draft.minBasePpw]);

  /** A floor no deal on this partner can reach. The mistake this screen exists to stop. */
  const floorUnreachable =
    capBasePpwCents != null && floorCents != null && floorCents > capBasePpwCents;

  /**
   * The disclosure as a homeowner will actually read it, with figures in it.
   *
   * THE POINT OF THE WHOLE TAB. An admin typing `{contractValue}` into a
   * textarea has no way to tell what the sentence comes out as, and the
   * sentence with the numbers in it is the thing they are approving — a
   * template that reads fine and renders "A $70,000 reduces…" is a mistake
   * nobody catches until it is on somebody's paper.
   *
   * Worked on THIS partner's own price where it has one, because that is what
   * its deals actually quote at. A partner that publishes none gets a round,
   * plainly-labelled illustrative price instead: an example that is obviously
   * an example beats one that could be mistaken for a quote.
   */
  const adjustmentPreview = React.useMemo(() => {
    if (!draft.adjustmentEnabled) return null;
    const cents = adjustmentToCents(draft.adjustmentAmount);
    if (cents === "invalid" || cents == null) return null;
    const label = draft.adjustmentLabel.trim();
    const template = draft.adjustmentDisclosure.trim();
    if (!label || !template) return null;

    const PREVIEW_KW = 8.8;
    const obligationCents =
      draftPpwCents != null ? Math.round(PREVIEW_KW * 1000 * draftPpwCents) : 100_000_00;

    const r = reconcileContract({
      customerObligationCents: obligationCents,
      adjustment: { enabled: true, fixedCents: cents, label, disclosure: template },
      lenderName: draft.name.trim() || lender.name,
    });
    if (!r) return null;

    // THE TWO FIGURES THE CUSTOMER'S DOCUMENT NO LONGER BREAKS OUT.
    //
    // Since 2026-08-29 the proposal quotes the contract value whole — one
    // system price — and the federal credits bring it down on the following
    // chapter. The contribution and the obligation are not rows on it any
    // more. They are still tokens here, because the funder's own paperwork and
    // some programmes' approved wording legitimately state them; but an admin
    // who reaches for {adjustment} out of habit puts back, in a sentence,
    // exactly the breakdown the page stopped printing. So it is flagged, in
    // the preview, where they can see the sentence it produces — not blocked,
    // because whether a programme must disclose its own contribution is a
    // question about that programme's agreement and not ours to answer.
    //
    // Read off the RENDERED paragraph rather than the template, so a figure
    // typed by hand is caught as well as one substituted in.
    const leaks: string[] = [];
    if (r.disclosure.includes(money(r.adjustmentCents))) {
      leaks.push(`${money(r.adjustmentCents)} contribution`);
    }
    if (r.disclosure.includes(money(r.customerObligationCents))) {
      leaks.push(`${money(r.customerObligationCents)} obligation`);
    }

    return {
      exampleLabel:
        draftPpwCents != null
          ? `${PREVIEW_KW.toFixed(2)} kW at $${(draftPpwCents / 100).toFixed(2)}/W`
          : "on an example $100,000 customer price",
      heading: `${draft.name.trim() || lender.name} — ${label}`,
      contractValue: money(r.lenderContractValueCents),
      disclosure: r.disclosure,
      leaks,
    };
  }, [
    draft.adjustmentEnabled,
    draft.adjustmentAmount,
    draft.adjustmentLabel,
    draft.adjustmentDisclosure,
    draft.name,
    lender.name,
    draftPpwCents,
  ]);

  type ActionResult = { ok: boolean; error?: string; message?: string };
  const act = async (fn: () => Promise<ActionResult>, fallback: string): Promise<ActionResult> => {
    setBusy(true);
    try {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error, { duration: 9000 });
        return res;
      }
      toast.success(res.message ?? fallback);
      router.refresh();
      return res;
    } finally {
      // ALWAYS cleared. A busy flag left latched by a throwing action is how a
      // panel goes permanently read-only with no error on screen.
      setBusy(false);
    }
  };

  async function save() {
    if (!draft.name.trim()) return toast.error("A lender needs a name.");

    // Caught here rather than left to the server so the message names the box.
    // A price is the one field on this screen that silently rewrites what every
    // deal on this partner quotes, and "Invalid lender." would send somebody
    // looking at the URL fields.
    const maxFinalPpwCents = draft.ppwMode === "normal" ? null : ppwToCents(draft.maxFinalPpw);
    if (maxFinalPpwCents === "invalid") {
      return toast.error(
        "Final $/W has to be a price between $0.50 and $20.00, or choose “Prices the normal way”."
      );
    }
    if (draft.ppwMode !== "normal" && maxFinalPpwCents == null) {
      return toast.error(
        "Type this partner’s $/W, or choose “Prices the normal way” to leave pricing alone."
      );
    }
    const minBasePpwCents = ppwToCents(draft.minBasePpw);
    if (minBasePpwCents === "invalid") {
      return toast.error("Min base $/W has to be a price between $0.50 and $20.00, or blank for no floor.");
    }

    const maxFinalPricePerBatteryCents =
      draft.batteryMode === "normal" ? null : batteryPriceToCents(draft.maxFinalBattery);
    if (maxFinalPricePerBatteryCents === "invalid") {
      return toast.error("Final $/battery has to be between $500 and $100,000, or blank for no cap.");
    }
    if (draft.batteryMode !== "normal" && maxFinalPricePerBatteryCents == null) {
      return toast.error("Type this partner’s price per battery, or choose “Prices the normal way”.");
    }
    const minBasePricePerBatteryCents = batteryPriceToCents(draft.minBaseBattery);
    if (minBasePricePerBatteryCents === "invalid") {
      return toast.error("Min base $/battery has to be between $500 and $100,000, or blank for no floor.");
    }

    // The contribution, in whole dollars. Caught here so the message names the
    // box: this is the one figure on the screen that writes itself onto a
    // contract, and a silent NaN would switch the programme on with nothing
    // behind it.
    const contractAdjustmentCents = adjustmentToCents(draft.adjustmentAmount);
    if (contractAdjustmentCents === "invalid") {
      return toast.error(
        "The contract adjustment has to be an amount between $1 and $5,000,000, or blank for none."
      );
    }
    if (draft.adjustmentEnabled) {
      if (contractAdjustmentCents == null) {
        return toast.error("Set the adjustment amount before switching the contract adjustment on.");
      }
      if (!draft.adjustmentLabel.trim()) {
        return toast.error(
          "Give the adjustment the approved customer-facing label — exactly the words the proposal should print."
        );
      }
      if (!draft.adjustmentDisclosure.trim()) {
        return toast.error(
          "Write the customer disclosure — the paragraph that says who is responsible for which amount."
        );
      }
    }

    setBusy(true);
    try {
      if (fieldsDirty) {
        const res = await upsertSolarLenderAction(lender.id, {
          name: draft.name.trim(),
          notes: draft.notes.trim() || null,
          portalUrl: draft.portalUrl.trim() || null,
          applyUrl: draft.applyUrl.trim() || null,
          apiBaseUrl: draft.apiBaseUrl.trim() || null,
          apiProductSlug: draft.apiProductSlug.trim() || null,
          creditInstructions: draft.creditInstructions.trim() || null,
          repPayMode: draft.repPayMode,
          batteryPayMode: draft.batteryPayMode,
          maxFinalPpwCents,
          // The stored mode only means anything alongside a figure, so on
          // "prices the normal way" it keeps whatever it was — flipping back to
          // a cap later should not silently forget that this partner is flat.
          finalPpwMode: draft.ppwMode === "normal" ? lender.finalPpwMode : draft.ppwMode,
          minBasePpwCents,
          maxFinalPricePerBatteryCents,
          finalBatteryPriceMode:
            draft.batteryMode === "normal" ? lender.finalBatteryPriceMode : draft.batteryMode,
          minBasePricePerBatteryCents,
          batteryRule: draft.batteryRule,
          contractAdjustmentEnabled: draft.adjustmentEnabled,
          contractAdjustmentType: "fixed",
          contractAdjustmentCents,
          contractAdjustmentLabel: draft.adjustmentLabel.trim() || null,
          contractAdjustmentDisclosure: draft.adjustmentDisclosure.trim() || null,
          contractAdjustmentEffectiveAt: draft.adjustmentEffectiveAt.trim() || null,
          ownershipDisclosure: draft.ownershipDisclosure.trim() || null,
        });
        if (!res.ok) {
          toast.error(res.error, { duration: 9000 });
          return;
        }
      }

      // Second write, same Save. The rules live in their own table, so they
      // cannot ride along on the lender row — but a person setting a partner up
      // is doing one job and should press one button.
      if (addersDirty) {
        const res = await setLenderAdderRulesAction(
          lender.id,
          adderCatalogue.map((a) => ({ equipmentId: a.id, financedOnTop: !!adderDraft[a.id] }))
        );
        if (!res.ok) {
          toast.error(res.error, { duration: 9000 });
          return;
        }
      }

      /**
       * Third write, same Save. The names live on the approval rows, which
       * belong to neither the lender nor the catalogue on their own, so they
       * cannot ride along on either update.
       */
      if (equipDirty) {
        const res = await setLenderEquipmentNamesAction(
          lender.id,
          lender.approvedEquipment.map((row) => ({
            equipmentId: row.equipmentId,
            lenderBrand: equipDraft[row.equipmentId]?.brand ?? null,
            lenderModel: equipDraft[row.equipmentId]?.model ?? null,
          }))
        );
        if (!res.ok) {
          toast.error(res.error, { duration: 9000 });
          return;
        }
      }

      toast.success(`${draft.name.trim()} saved`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const onTop = adderCatalogue.filter((a) => adderDraft[a.id]).length;

  /**
   * Approved hardware this partner has no name for, counted off the DRAFT so
   * the badge falls as they are filled in rather than only after a Save.
   *
   * Only badged on a partner that actually submits over an API: on a link
   * lender the names are never sent, and a red count against a setting that
   * changes nothing is how a settings screen teaches people to ignore it.
   */
  const submitsOverApi =
    !!lender.apiBaseUrl && !!lender.apiKeyMasked && !!lender.apiProductSlug;
  const unnamedEquipment = submitsOverApi
    ? lender.approvedEquipment.filter((r) => !equipDraft[r.equipmentId]).length
    : 0;

  return (
    // Named for the specs: only one partner's panel is mounted at a time, so a
    // test can scope to "the open lender" without the card-filtering gymnastics
    // the old grid needed to avoid asserting against somebody else's row.
    <div className="min-w-0" data-testid="lender-panel">
      {/* ── Who this is, and what it costs at a glance ──────────────────── */}
      <header className="flex flex-wrap items-start gap-3 border-b border-border pb-4">
        <LenderMark
          name={lender.name}
          logoUrl={lender.logoUrl}
          size="lg"
          className="size-12 rounded-xl"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate font-display text-xl font-semibold tracking-tight">
              {lender.name}
            </h2>
            {!lender.isActive && <Pill>Retired</Pill>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {lender.maxFinalPpwCents != null ? (
              <Pill tone="gold">
                {lender.finalPpwMode === "flat" ? "Flat" : "Max"} $
                {ppwToDollars(lender.maxFinalPpwCents)}/W
              </Pill>
            ) : (
              <Pill>Prices the normal way</Pill>
            )}
            {lender.minBasePpwCents != null && (
              <Pill tone="gold">Floor ${ppwToDollars(lender.minBasePpwCents)}/W</Pill>
            )}
            <Pill tone={liveProducts.length === 0 ? "warn" : "plain"}>
              {liveProducts.length === 0
                ? "no programmes"
                : `${liveProducts.length} ${liveProducts.length === 1 ? "programme" : "programmes"}`}
            </Pill>
            <Pill tone={lender.approvedCount === 0 ? "warn" : "plain"}>
              {lender.approvedCount}
              {sellableEquipment > 0 ? `/${sellableEquipment}` : ""} equipment
            </Pill>
            <Pill>
              {lender.dealCount} {lender.dealCount === 1 ? "deal" : "deals"}
            </Pill>
            {/* Was a row of the "At a glance" box on Details. It belongs up here:
                how this partner pays a rep is as true on the rate sheet as it is
                on the identity form, and the box could only say it on one tab. */}
            <Pill>{draft.repPayMode === "per_watt" ? "Fixed $/W" : "Redline"}</Pill>
            {lender.contractAdjustmentEnabled && (
              <Pill tone="solar">
                {lender.contractAdjustmentLabel?.trim() || "Contract adjustment"}
                {lender.contractAdjustmentCents != null &&
                  ` +${money(lender.contractAdjustmentCents)}`}
              </Pill>
            )}
            {lender.batteryRule === "required" && <Pill tone="warn">Battery required</Pill>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {lender.applyUrl && (
            <Button size="sm" variant="outline" asChild>
              <a href={lender.applyUrl} target="_blank" rel="noopener noreferrer">
                Application <ExternalLink className="size-3.5" />
              </a>
            </Button>
          )}
          {lender.portalUrl && (
            <Button size="sm" variant="outline" asChild>
              <a href={lender.portalUrl} target="_blank" rel="noopener noreferrer">
                Dealer portal <ExternalLink className="size-3.5" />
              </a>
            </Button>
          )}
          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" disabled={busy} aria-label={`More for ${lender.name}`}>
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem
                  onSelect={() =>
                    void act(
                      () => setSolarLenderActiveAction(lender.id, !lender.isActive),
                      "Updated"
                    )
                  }
                >
                  {lender.isActive ? (
                    <>
                      <Archive className="size-4" /> Retire — deals already built for it keep working
                    </>
                  ) : (
                    <>
                      <RotateCcw className="size-4" /> Make available again
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={async () => {
                    const res = await act(() => deleteSolarLenderAction(lender.id), "Deleted");
                    if (res.ok) onDeleted();
                  }}
                >
                  <Trash2 className="size-4" /> Delete — refused if a deal is being built for it
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>

      <Tabs
        value={tab}
        onValueChange={(v) => onTabChange(v as LenderTab)}
        className="mt-4 gap-4"
      >
        <TabsList variant="line" className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="pricing">Pricing</TabsTrigger>
          <TabsTrigger value="rates">
            Rate sheet
            {liveProducts.length > 0 && (
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {liveProducts.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="adders">
            Extra work
            {adderCatalogue.length > 0 && (
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {onTop}/{adderCatalogue.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="equipment">
            Equipment
            {unnamedEquipment > 0 && (
              <Pill tone="warn" className="ml-1.5">
                {unnamedEquipment}
              </Pill>
            )}
          </TabsTrigger>
          <TabsTrigger value="legal">
            Disclosures
            {lender.contractAdjustmentEnabled && (
              <span className="size-1.5 rounded-full bg-solar" aria-hidden />
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── DETAILS ──────────────────────────────────────────────────── */}
        <TabsContent value="details" className="space-y-4">
          {canEdit && <LogoControl lender={lender} />}

          {/* A lender approving nothing produces empty equipment lists on every
              deal that selects it, and one with no programme cannot be quoted at
              all. Both used to sit in a column beside the form, under a box that
              restated the programme, equipment and deal counts already in the
              header two inches above. The counts are gone; the warnings, which
              are the only part of that column somebody could act on, are not. */}
          {lender.isActive && lender.approvedCount === 0 && (
            <Caution>
              No equipment approved yet — a deal on this lender will show empty lists.{" "}
              <Link
                href="/portal/settings/solar-equipment"
                className="underline underline-offset-2"
              >
                Tag equipment
              </Link>
              .
            </Caution>
          )}
          {lender.isActive && liveProducts.length === 0 && (
            <Caution>
              Nothing on the rate sheet — a deal cannot be quoted on this partner until it has a
              programme.{" "}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => onTabChange("rates")}
              >
                Add one
              </button>
              .
            </Caution>
          )}

          <div className="space-y-4">
            <Panel title="Identity">
              <TextField
                label="Lender name"
                value={draft.name}
                onChange={(v) => set("name", v)}
                id={`ld-${lender.id}-name`}
              />
              <TextField
                label="Notes"
                value={draft.notes}
                placeholder="Anything worth remembering about this partner"
                onChange={(v) => set("notes", v)}
              />
            </Panel>

            {/* Two links, never one. The portal is your dealer login; the apply
                link is what a homeowner opens from the proposal. One shared
                field is how a back office ends up in front of a customer. */}
            <Panel
              title="Links"
              description="Only the customer application link ever reaches a proposal. The dealer portal stays inside the CRM."
            >
              <TextField
                label="Dealer portal — where your team runs credit"
                value={draft.portalUrl}
                placeholder="https://…"
                onChange={(v) => set("portalUrl", v)}
              />
              <TextField
                label="Customer application link — the proposal's Qualify button"
                value={draft.applyUrl}
                placeholder="https://…"
                onChange={(v) => set("applyUrl", v)}
              />
            </Panel>

            {/* Direct submission. Empty on every partner that has not given
                you an integration, which is most of them — and a lender left
                empty here keeps the application link above, unchanged. */}
            <Panel
              title="Direct submission (optional)"
              description="If this partner gave you API access, a rep can send a priced deal straight into their system instead of the customer retyping it. The customer still enters their own SSN and authorises the credit check on the lender's page."
            >
              <TextField
                label="API address"
                value={draft.apiBaseUrl}
                placeholder="https://admin.example.com"
                onChange={(v) => set("apiBaseUrl", v)}
              />
              <TextField
                label="Loan product"
                value={draft.apiProductSlug}
                placeholder="solar-installation-financing"
                onChange={(v) => set("apiProductSlug", v)}
              />
              <LenderApiKeyField lenderId={lender.id} masked={lender.apiKeyMasked} />
            </Panel>

            <Panel
              title="How to run credit with this partner"
              description="Rep-facing. Shown on the deal beside this lender."
            >
              <Textarea
                id={`ld-${lender.id}-credit`}
                aria-label="How to run credit with this partner"
                rows={4}
                value={draft.creditInstructions}
                placeholder="The steps a rep needs — which portal, what to have ready, who to call when it stips."
                onChange={(e) => set("creditInstructions", e.target.value)}
              />
            </Panel>
          </div>
        </TabsContent>

        {/* ── PRICING ──────────────────────────────────────────────────── */}
        <TabsContent value="pricing" className="space-y-4">
          {/* TWO COLUMNS ONLY WHEN THERE IS ROOM FOR TWO.
              This used to wait until `2xl` because the panel shared the window
              with the Settings rail as well as the lender rail, and at `xl` each
              half came to about 250px — narrow enough that "Min base $/W"
              wrapped to three lines above a box reading "no fl". Settings gave
              its column back, so the second half arrives a breakpoint earlier.
              The pair of money fields inside is the thing that has to stay side
              by side; the panels beside it are the ones that can stack. */}
          <div className="grid items-start gap-4 xl:grid-cols-2">
            <div className="space-y-4">
              {/* THE TWO ENDS OF THE SAME BAND, SIDE BY SIDE.
                  The ceiling is about the CUSTOMER'S number and the floor is
                  about YOURS — neither is derived from the other — but they are
                  read together and set together, and having them in separate
                  cards a column apart meant setting one without seeing what the
                  other already said. Which is exactly how a floor gets typed
                  above what a cap can ever leave. */}
              <Panel
                title="Price per watt"
                description="What this partner charges a homeowner, and the least those deals may leave you. Dealer fee and adders are included in the first; the second is measured before the fee, on what survives it."
              >
                <ChoiceCards<PricingMode>
                  name={`ppw-mode-${lender.id}`}
                  legend="How this partner prices"
                  why={
                    <>
                      Most partners price the ordinary way: the base $/W a rep types, grossed up by
                      the programme&rsquo;s dealer fee. A few publish one number the homeowner pays
                      whatever the job — set FLAT for those. MAXIMUM holds the contract at or under
                      a figure, so extra work comes out of what you keep rather than out of the
                      customer&rsquo;s price.
                    </>
                  }
                  value={draft.ppwMode}
                  onChange={(v) => set("ppwMode", v)}
                  options={[
                    {
                      value: "normal",
                      label: "Prices the normal way",
                      detail: "Base $/W grossed up by the programme's dealer fee.",
                    },
                    {
                      value: "cap",
                      label: "Maximum $/W",
                      detail: "A cheaper deal quotes cheaper; nothing goes above this.",
                    },
                    {
                      value: "flat",
                      label: "Flat $/W",
                      detail: "Every deal is this figure. Extra work only changes what you keep.",
                    },
                  ]}
                />

                <div className="grid items-start gap-3 sm:grid-cols-2">
                  {draft.ppwMode === "normal" ? (
                    <NotPriced label="Final $/W">
                      Derived per programme: the base a rep types, grossed up by that
                      programme&rsquo;s dealer fee. Choose a maximum or a flat price above to set
                      one here.
                    </NotPriced>
                  ) : (
                    <MoneyField
                      id={`ld-${lender.id}-final-ppw`}
                      label="Final $/W"
                      suffix="/W"
                      placeholder="5.50"
                      value={draft.maxFinalPpw}
                      onChange={(v) => set("maxFinalPpw", v)}
                      invalid={ppwToCents(draft.maxFinalPpw) === "invalid"}
                      hint="What this partner charges a homeowner."
                    />
                  )}
                  <MoneyField
                    id={`ld-${lender.id}-min-ppw`}
                    label="Min base $/W"
                    suffix="/W"
                    placeholder="no floor"
                    value={draft.minBasePpw}
                    onChange={(v) => set("minBasePpw", v)}
                    invalid={floorUnreachable || ppwToCents(draft.minBasePpw) === "invalid"}
                    hint="The least this partner's deals may leave you."
                  />
                </div>

                {draftPpwCents != null && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Figure
                      label={`A ${EXAMPLE_KW} kW system quotes`}
                      tone="gold"
                      value={money(EXAMPLE_KW * 1000 * draftPpwCents)}
                    />
                    <Figure
                      label={
                        capBasePpwCents == null
                          ? "Leaves you (needs a dealer fee)"
                          : "Leaves you, before your cut"
                      }
                      tone={floorUnreachable ? "warn" : "plain"}
                      value={capBasePpwCents == null ? "—" : `$${ppwToDollars(capBasePpwCents)}/W`}
                    />
                  </div>
                )}

                <Hint>
                  A deal under the floor cannot be quoted or generated. It is measured on what
                  actually survives the dealer fee — so on a capped partner it is what the cap
                  leaves you, not what the rep typed.
                  {capBasePpwCents != null && (
                    <>
                      {" "}
                      This lender&rsquo;s cap and fee leave at most{" "}
                      <span className="font-medium tabular-nums text-foreground">
                        ${ppwToDollars(capBasePpwCents)}/W
                      </span>
                      , so a floor above that blocks every deal on it.
                    </>
                  )}
                </Hint>

                {floorUnreachable && (
                  <Caution>
                    A ${ppwToDollars(floorCents)}/W floor is above the $
                    {ppwToDollars(capBasePpwCents)}/W this partner&rsquo;s cap and fee can leave
                    you. Every deal on it would be blocked.
                  </Caution>
                )}
              </Panel>

              {/* The same two rules, on a deal with no watts.
                  A storage job has no array for a $/W figure to be per, so the
                  pair above cannot reach it — they would divide by zero and
                  wave every price through. These are the same ceiling and the
                  same floor, measured per battery. Grouped and labelled so
                  nobody sets one believing it guards a solar deal. */}
              <Panel
                title="Battery-only jobs"
                description="A battery job has no watts, so the figures above do not apply to it. These do. Leave them alone if this lender does not fund storage on its own."
              >
                <ChoiceCards<PricingMode>
                  name={`batt-mode-${lender.id}`}
                  legend="How this partner prices a storage-only job"
                  value={draft.batteryMode}
                  onChange={(v) => set("batteryMode", v)}
                  options={[
                    { value: "normal", label: "Prices the normal way" },
                    { value: "cap", label: "Maximum per battery" },
                    { value: "flat", label: "Flat per battery" },
                  ]}
                  columns={3}
                />
                <div className="grid items-start gap-3 sm:grid-cols-2">
                  {draft.batteryMode === "normal" ? (
                    <NotPriced label="Final $/battery">
                      Priced the ordinary way. Choose a maximum or a flat price above to set one
                      here.
                    </NotPriced>
                  ) : (
                    <MoneyField
                      id={`ld-${lender.id}-final-battery`}
                      label="Final $/battery"
                      placeholder="13000"
                      value={draft.maxFinalBattery}
                      onChange={(v) => set("maxFinalBattery", v)}
                      invalid={batteryPriceToCents(draft.maxFinalBattery) === "invalid"}
                      hint="What this partner charges a homeowner."
                    />
                  )}
                  <MoneyField
                    id={`ld-${lender.id}-min-battery`}
                    label="Min base $/battery"
                    placeholder="no floor"
                    value={draft.minBaseBattery}
                    onChange={(v) => set("minBaseBattery", v)}
                    invalid={batteryPriceToCents(draft.minBaseBattery) === "invalid"}
                    hint="The least these deals may leave you."
                  />
                </div>
                <Hint>
                  Measured before the dealer fee, on what survives it — the same rule as the $/W
                  floor.
                </Hint>
              </Panel>
            </div>

            <div className="space-y-4">
              {/* Pay mode is a property of the PARTNER, not of the rep — a
                  fixed-pay lender pays a flat rate to everyone, and the
                  alternative is that somebody hardcodes a name check on "Amos"
                  that a rename breaks. */}
              <Panel title="How reps are paid on this lender">
                <ChoiceCards
                  name={`pay-${lender.id}`}
                  legend="Commission basis"
                  value={draft.repPayMode}
                  onChange={(v) => set("repPayMode", v)}
                  options={[
                    {
                      value: "redline",
                      label: "Redline",
                      detail: "The rep keeps everything above their own net $/W.",
                    },
                    {
                      value: "per_watt",
                      label: "Fixed $/W",
                      detail: "The rep earns their flat rate per installed watt.",
                    },
                  ]}
                  columns={2}
                />
                <Hint>
                  Each rep&rsquo;s own redline and fixed rate live on their{" "}
                  <Link href="/portal/team" className="underline underline-offset-2">
                    team profile
                  </Link>
                  . Changing this only affects deals whose commission hasn&rsquo;t been generated
                  yet.
                </Hint>

                {/* THE STORAGE TWIN, and its own setting rather than a third
                    value above, because every basis up there is measured in
                    WATTS and a battery-only job has none. A partner holds both
                    opinions at once and they are routinely different: this one
                    pays a flat $/W on an array while pricing storage at a flat
                    figure per battery. Before this existed a battery-only deal
                    generated no commission line whatsoever. */}
                <div className="mt-5 border-t border-border pt-4">
                  <ChoiceCards
                    name={`batt-pay-${lender.id}`}
                    legend="Battery-only jobs"
                    value={draft.batteryPayMode}
                    onChange={(v) => set("batteryPayMode", v)}
                    options={[
                      {
                        value: "redline",
                        label: "Redline per battery",
                        detail: "The rep keeps everything above their own net $/battery.",
                      },
                      {
                        value: "flat",
                        label: "Fixed $ per battery",
                        detail: "The rep earns a flat amount per installed battery.",
                      },
                    ]}
                    columns={2}
                  />
                  <Hint>
                    A storage job has no watts, so the basis above cannot reach it. This is what
                    pays it. Only battery-only deals read this — a battery riding along on an
                    array is paid by the watt.
                  </Hint>
                </div>
              </Panel>

              {/* WHETHER THIS PARTNER WILL FUND AN ARRAY WITH NO BATTERY.
                  The app used to hold one opinion about this for every lender —
                  a note on every batteryless design, unswitchable — which is
                  neither true of the partners that do not care nor binding on
                  the ones that will decline the file. */}
              <Panel title="A system with no battery on it">
                <ChoiceCards
                  name={`batt-rule-${lender.id}`}
                  legend="If a design has no storage"
                  value={draft.batteryRule}
                  onChange={(v) => set("batteryRule", v)}
                  options={[
                    {
                      value: "optional",
                      label: "Fine — say nothing",
                      detail:
                        "Nothing is stopped. The proposal still tells the homeowner a grid-tied system shuts off in an outage.",
                    },
                    {
                      value: "warn",
                      label: "Flag it, but let the proposal out",
                      detail:
                        "The readiness report flags it and the rep carries on. This is what every lender did before this setting existed.",
                    },
                    {
                      value: "required",
                      label: "Battery required — block the proposal",
                      detail:
                        "A grid-tied design on this partner cannot be generated at all. Better a rep finds out here than at submission.",
                    },
                  ]}
                />
              </Panel>
            </div>
          </div>
        </TabsContent>

        {/* ── RATE SHEET ───────────────────────────────────────────────── */}
        <TabsContent value="rates">
          <RateSheetPanel
            lender={lender}
            canEdit={canEdit}
            targetNetPpwCents={targetNetPpwCents}
          />
        </TabsContent>

        {/* ── EXTRA WORK ───────────────────────────────────────────────── */}
        <TabsContent value="adders">
          <AdderRulesPanel
            lender={lender}
            catalogue={adderCatalogue}
            draft={adderDraft}
            lenderDraft={draft}
            canEdit={canEdit}
            onChange={setAdderDraft}
          />
        </TabsContent>

        {/* ── DISCLOSURES ──────────────────────────────────────────────── */}
        <TabsContent value="equipment">
          <LenderEquipmentPanel
            lender={lender}
            draft={equipDraft}
            canEdit={canEdit}
            onChange={setEquipDraft}
          />
        </TabsContent>

        <TabsContent value="legal" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="space-y-4">
              {/* ── THE PROGRAMME CONTRIBUTION ──────────────────────────
                  The only setting on this screen where the contract and the
                  customer's obligation stop being the same number. Everything
                  on Pricing says what a homeowner pays; this says what the
                  partner's paper is written at on top of it. */}
              <Panel
                tone="accent"
                title="Contract adjustment"
                description="For a partner whose contract is written for MORE than the customer owes — a prepaid-lease programme where a fixed contribution comes off the contract value. Off on every other lender, and off is what changes nothing."
                action={
                  <label className="flex items-center gap-2 text-xs font-medium">
                    <Switch
                      checked={draft.adjustmentEnabled}
                      onCheckedChange={(v) => set("adjustmentEnabled", v)}
                      aria-label="Contract adjustment enabled"
                    />
                    {draft.adjustmentEnabled ? "On" : "Off"}
                  </label>
                }
              >
                {draft.adjustmentEnabled ? (
                  <>
                    {/* One member today. Shown as a stated fact rather than as a
                        select with nothing to choose — a dropdown with one option
                        is a question that wastes somebody's time. */}
                    <Hint>
                      Adjustment type:{" "}
                      <span className="font-medium text-foreground">Fixed dollar amount</span>
                    </Hint>
                    <MoneyField
                      id={`ld-${lender.id}-adjustment`}
                      label="Fixed contract adjustment"
                      placeholder="70000"
                      value={draft.adjustmentAmount}
                      onChange={(v) => set("adjustmentAmount", v)}
                      invalid={adjustmentToCents(draft.adjustmentAmount) === "invalid"}
                    />
                    <TextField
                      label="Customer-facing label — the approved term, printed as typed"
                      placeholder="Participate Program Contribution"
                      value={draft.adjustmentLabel}
                      onChange={(v) => set("adjustmentLabel", v)}
                      hint="Whatever is typed here is what the customer's proposal prints. Do not call it a discount, a rebate, an incentive or a tax credit unless that is the approved term for this programme — they are different claims about who owes what."
                    />

                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <Label className="text-xs" htmlFor={`ld-${lender.id}-disclosure`}>
                          Customer disclosure — the paragraph that reconciles the figures
                        </Label>
                        <InfoTip label="customer disclosure">
                          The figures are substituted in at generation, so no dollar amount is typed
                          here:{" "}
                          {DISCLOSURE_TOKENS.map((t, i) => (
                            <React.Fragment key={t.token}>
                              {i > 0 && ", "}
                              <code className="rounded bg-muted px-1 py-px">{t.token}</code> {t.means}
                            </React.Fragment>
                          ))}
                          .
                        </InfoTip>
                      </div>
                      <Textarea
                        id={`ld-${lender.id}-disclosure`}
                        rows={5}
                        value={draft.adjustmentDisclosure}
                        placeholder={DISCLOSURE_TEMPLATE_SUGGESTION}
                        onChange={(e) => set("adjustmentDisclosure", e.target.value)}
                      />
                      <div className="flex flex-wrap items-center gap-x-2">
                        <Hint className="flex-1">
                          Tokens:{" "}
                          {DISCLOSURE_TOKENS.map((t, i) => (
                            <React.Fragment key={t.token}>
                              {i > 0 && " "}
                              <code className="rounded bg-muted px-1 py-px">{t.token}</code>
                            </React.Fragment>
                          ))}
                        </Hint>
                        {draft.adjustmentDisclosure.trim() === "" && (
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            onClick={() =>
                              set("adjustmentDisclosure", DISCLOSURE_TEMPLATE_SUGGESTION)
                            }
                          >
                            Start from the suggested wording
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs" htmlFor={`ld-${lender.id}-effective`}>
                        Effective from
                      </Label>
                      <Input
                        id={`ld-${lender.id}-effective`}
                        type="date"
                        value={draft.adjustmentEffectiveAt}
                        onChange={(e) => set("adjustmentEffectiveAt", e.target.value)}
                      />
                      <Hint>
                        Blank means it is already running. A future date configures the programme now
                        and starts it then — proposals generated before it quote no adjustment at
                        all. Nothing here is ever retroactive: a generated proposal is frozen, so
                        changing any of this moves only versions made afterwards.
                      </Hint>
                    </div>
                  </>
                ) : (
                  <Hint>
                    Switch this on only for a programme whose agreement says the contract is written
                    for more than the household owes.
                  </Hint>
                )}
              </Panel>

              {/* Kept OUTSIDE the enabled branch. A partner can publish its own
                  ownership wording without running a contribution, and the
                  sentence this replaces — "you own it outright, and it transfers
                  with the house" — is on every financed proposal whether or not
                  any money is being adjusted. */}
              <Panel
                title="What the customer ends up owning"
                description="In this partner's own words. Leave blank and the proposal keeps its own sentence: that the customer owns the system outright, it carries its manufacturer warranties, and it transfers with the house. That is true of a loan. Write something here for any product where it is not."
              >
                <Textarea
                  id={`ld-${lender.id}-ownership`}
                  aria-label="What the customer ends up owning"
                  rows={4}
                  value={draft.ownershipDisclosure}
                  placeholder="Ownership, term, transfer on sale, and any buyout — as this product actually works."
                  onChange={(e) => set("ownershipDisclosure", e.target.value)}
                />
              </Panel>
            </div>

            {/* The preview is the point of this tab. An admin typing tokens into
                a textarea cannot otherwise tell what a homeowner will read, and
                the sentence they are approving is the sentence with the numbers
                in it. Beside the textarea now rather than under it, so the two
                are read together.

                IT MIRRORS THE DOCUMENT, and the document changed on 2026-08-29:
                it prints one system price at the contract value, then the
                programme's name and paragraph. It showed three rows here —
                contract value, less the contribution, equals the obligation —
                for as long as the page did. A preview of a page that no longer
                exists is worse than no preview, because somebody approves
                wording against it. */}
            <div className="xl:sticky xl:top-4 xl:self-start">
              {adjustmentPreview ? (
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    What the customer reads — {adjustmentPreview.exampleLabel}
                  </p>
                  <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-border pt-2 text-sm font-semibold">
                    <span>System price</span>
                    <span className="tabular-nums">{adjustmentPreview.contractValue}</span>
                  </div>
                  <p className="mt-4 text-[11px] font-medium uppercase tracking-wide text-foreground">
                    {adjustmentPreview.heading}
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    {adjustmentPreview.disclosure}
                  </p>
                  {adjustmentPreview.leaks.length > 0 && (
                    <div className="mt-3">
                      <Caution>
                        This wording states the {adjustmentPreview.leaks.join(" and the ")} in prose.
                        The proposal itself no longer breaks the price down that way — it quotes the{" "}
                        {adjustmentPreview.contractValue} contract whole and the federal credits
                        bring it down on the following page. Keep these figures only if this
                        programme&rsquo;s agreement requires them to be disclosed.
                      </Caution>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border p-6 text-center">
                  <p className="text-xs text-muted-foreground">
                    {draft.adjustmentEnabled
                      ? "Fill in the amount, the label and the disclosure and the customer's paragraph is previewed here, with this partner's own figures in it."
                      : "Nothing is added to this partner's contract, so a customer reads the ordinary proposal."}
                  </p>
                </div>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* ── ONE SAVE ─────────────────────────────────────────────────────
          Sticky, and only there when something has changed. Everything the
          five tabs touch is one draft, so a person can set a partner's price
          on one tab and its adders on another and commit both with the button
          that has been following them down the page. */}
      {canEdit && dirty && (
        <div className="sticky bottom-0 z-10 mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gold/40 bg-card/95 px-4 py-3 shadow-lg shadow-black/[0.06] backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <span className="flex items-center gap-2 text-xs font-medium">
            <TriangleAlert className="size-3.5 text-gold" />
            Unsaved changes to {lender.name}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setDraft(draftFrom(lender));
                setAdderDraft(resolvedAdderRules(lender, adderCatalogue));
              }}
            >
              Discard
            </Button>
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Save
              changes
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
