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
  upsertSolarLenderAction,
  setSolarLenderActiveAction,
  deleteSolarLenderAction,
  setLenderAdderRulesAction,
  setLenderFieldMapAction,
} from "@/server/modules/solar/actions";
import { SubmissionMapping } from "./submission-mapping";
import type { AdderRuleOption, LenderRow, PricingMode } from "./types";
import {
  batteryPriceToCents,
  draftFrom,
  money,
  ppwToCents,
  ppwToDollars,
  resolvedAdderRules,
  signTodayToCents,
} from "./types";
import type { SignTodayMode } from "@/lib/solar-sign-today";
import { claimedCreditRate, type CreditRates } from "@/lib/solar-credit-ladder";
import {
  Caution,
  ChoiceCards,
  Figure,
  Hint,
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

export const LENDER_TABS = ["details", "pricing", "rates", "adders", "equipment", "submission"] as const;
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
/**
 * A mapping as a comparable string, keys in a fixed order.
 *
 * Object key order survives a spread, so a row edited and then set back would
 * otherwise leave the Save button lit for a map that is identical to the saved
 * one.
 */
function stableMap(m: Record<string, { sourceKey: string | null; literal: string }>): string {
  return JSON.stringify(
    Object.keys(m)
      .sort()
      .map((k) => [k, m[k].sourceKey ?? "", m[k].literal.trim()])
  );
}

export function LenderDetail({
  lender,
  canEdit,
  sellableEquipment,
  targetNetPpwCents,
  creditRates,
  adderCatalogue,
  tab,
  onTabChange,
  onDeleted,
}: {
  lender: LenderRow;
  canEdit: boolean;
  sellableEquipment: number;
  targetNetPpwCents: number | null;
  creditRates: CreditRates;
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
  // The field mapping is compared on its own and EXCLUDED from the lender row's
  // comparison: it lives in its own table, so a changed mapping must not make
  // the row look dirty and provoke a pointless write of values nobody touched.
  const { fieldMap: draftMap, ...draftRow } = draft;
  const { fieldMap: savedMap, ...savedRow } = savedDraft;
  const fieldsDirty = JSON.stringify(draftRow) !== JSON.stringify(savedRow);
  const mapDirty = stableMap(draftMap) !== stableMap(savedMap);
  const addersDirty = adderCatalogue.some((a) => adderDraft[a.id] !== savedRules[a.id]);
  const equipDirty = JSON.stringify(equipDraft) !== JSON.stringify(savedEquip);
  const dirty = fieldsDirty || addersDirty || equipDirty || mapDirty;

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

  /** The typed sign-today cap, for the worked example beside it. */
  const signTodayCapCents = React.useMemo(() => {
    const c = ppwToCents(draft.signTodayCapPpw);
    return c === "invalid" ? null : c;
  }, [draft.signTodayCapPpw]);

  /**
   * WHAT A HOUSEHOLD IS STILL HOLDING, per watt, on this partner's own price.
   *
   * The cap is measured on what they NET, so an example worked on the sticker
   * would tell an admin the opposite of what the rule does — which is exactly
   * how a flat $5.50/W partner ended up with a $5.50/W cap that could never
   * pay out. All three credits, because that is what a deal claims until a rep
   * unticks one; a job earning fewer nets more and hands back more.
   */
  const nettedPpwCents = React.useMemo(
    () =>
      draftPpwCents == null
        ? null
        : Math.round(draftPpwCents * (1 - claimedCreditRate(creditRates, null))),
    [draftPpwCents, creditRates]
  );

  const floorCents = React.useMemo(() => {
    const c = ppwToCents(draft.minBasePpw);
    return c === "invalid" ? null : c;
  }, [draft.minBasePpw]);

  /** A floor no deal on this partner can reach. The mistake this screen exists to stop. */
  const floorUnreachable =
    capBasePpwCents != null && floorCents != null && floorCents > capBasePpwCents;

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

    // The sign-today rule, checked here for the same reason the prices are: a
    // partner saved with a rule and no figure hands every household nothing
    // under that partner's name, and nothing on the deal screen says why.
    const signTodayFixedCents = signTodayToCents(draft.signTodayFixed);
    if (signTodayFixedCents === "invalid") {
      return toast.error("Sign today credit has to be between $0 and $100,000.");
    }
    const signTodayCapPpwCents = ppwToCents(draft.signTodayCapPpw);
    if (signTodayCapPpwCents === "invalid") {
      return toast.error("The sign today cap has to be a price per watt between $0.50 and $20.00.");
    }
    if (draft.signTodayMode === "fixed" && signTodayFixedCents == null) {
      return toast.error("Type what this partner gives, or choose “The rep decides”.");
    }
    if (draft.signTodayMode === "above_cap" && signTodayCapPpwCents == null) {
      return toast.error("Type the cap this partner gives away above, or choose “The rep decides”.");
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
          signTodayMode: draft.signTodayMode,
          // Kept rather than cleared when the mode moves off them, so an admin
          // switching a partner to "the rep decides" for a month does not have
          // to retype the figure to switch it back.
          signTodayFixedCents,
          signTodayCapPpwCents,
          submissionAmountBasis: draft.submissionAmountBasis,
          submissionSavingBasis: draft.submissionSavingBasis,
          submissionSavingHorizon: draft.submissionSavingHorizon,
          submissionRepNameBasis: draft.submissionRepNameBasis,
          // Blank clears it, and a `fixed` partner with nothing typed falls
          // back to the deal's rep rather than sending an empty name.
          submissionRepName: draft.submissionRepName.trim() || null,
          submissionDelivery: draft.submissionDelivery,
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
       * Third write, same Save. The mapping is its own table too, and is sent
       * WHOLE — a row returned to its built-in source is an absence, and a
       * merge would leave it overridden for ever. See setLenderFieldMapAction.
       */
      if (mapDirty) {
        const res = await setLenderFieldMapAction(
          lender.id,
          Object.entries(draftMap).map(([wireField, v]) => ({
            wireField,
            sourceKey: v.sourceKey,
            literal: v.literal.trim() || null,
          }))
        );
        if (!res.ok) {
          toast.error(res.error, { duration: 9000 });
          return;
        }
      }

      /**
       * Fourth write, same Save. The names live on the approval rows, which
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
          {/* WHAT THE PARTNER API IS TOLD. Beside Equipment because the two
              answer the same question — what leaves Anexa and under whose
              name — and an admin looking for one is looking for the other. */}
          <TabsTrigger value="submission">Submission</TabsTrigger>
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

              {/* WHAT THIS PARTNER HANDS BACK FOR SIGNING TODAY.
                  Under the price panel because it is measured against the
                  price: the cap rule gives away whatever the household is left
                  NETTING above a figure, and an admin setting that has to be
                  able to see the $/W this partner charges while they type it. */}
              <Panel
                title="Sign today credit"
                description="What a household is handed back for signing today. It comes off what they NET once the federal credits are claimed — never off the price, the payment, the contract or the rep's commission."
              >
                <ChoiceCards<SignTodayMode>
                  name={`sign-today-mode-${lender.id}`}
                  legend="Who decides the figure"
                  why={
                    <>
                      Most partners leave it to the rep, who types what he is offering on the deal.
                      A partner that gives a set figure gives it on every deal written on them; a
                      partner that gives away the overage hands back whatever the household is
                      still holding above their cap once the federal credits are claimed, so the
                      credit grows the higher the deal is sold.
                    </>
                  }
                  value={draft.signTodayMode}
                  onChange={(v) => set("signTodayMode", v)}
                  options={[
                    {
                      value: "none",
                      label: "The rep decides",
                      detail: "Typed on the deal, deal by deal. What every partner did until now.",
                    },
                    {
                      value: "fixed",
                      label: "This partner gives",
                      detail: "One figure, automatic on every deal. The rep cannot change it.",
                    },
                    {
                      value: "above_cap",
                      label: "Everything above a cap",
                      detail:
                        "Whatever the household still owes above the figure below, once their credits are claimed. Derived, never typed.",
                    },
                  ]}
                />

                {draft.signTodayMode === "fixed" && (
                  <MoneyField
                    id={`ld-${lender.id}-sign-fixed`}
                    label="Credit"
                    placeholder="1,500"
                    value={draft.signTodayFixed}
                    onChange={(v) => set("signTodayFixed", v)}
                    invalid={signTodayToCents(draft.signTodayFixed) === "invalid"}
                    hint="Given on every deal on this partner."
                  />
                )}

                {draft.signTodayMode === "above_cap" && (
                  <>
                    <MoneyField
                      id={`ld-${lender.id}-sign-cap`}
                      label="Cap"
                      suffix="/W"
                      placeholder="5.00"
                      value={draft.signTodayCapPpw}
                      onChange={(v) => set("signTodayCapPpw", v)}
                      invalid={ppwToCents(draft.signTodayCapPpw) === "invalid"}
                      hint="Measured on the system AND its storage, after the credits the job claims. Adders are the exception: they raise the price and stay raised."
                    />
                    {/* WORKED, but only where there is a price to work it on.
                        A partner that publishes its own $/W has one; a partner
                        pricing the ordinary way does not, because what a deal
                        hands back then depends on what each rep sold it at —
                        and a figure invented against an assumed price is the
                        kind of number that gets quoted at a kitchen table. */}
                    {signTodayCapCents != null &&
                      (draftPpwCents != null && nettedPpwCents != null ? (
                        <>
                          <Figure
                            label={`A ${EXAMPLE_KW} kW system at $${ppwToDollars(draftPpwCents)}/W nets $${ppwToDollars(nettedPpwCents)}/W and hands back`}
                            tone={nettedPpwCents > signTodayCapCents ? "gold" : "plain"}
                            value={money(
                              Math.max(0, (nettedPpwCents - signTodayCapCents) * EXAMPLE_KW * 1000)
                            )}
                          />
                          <Hint>
                            Storage is measured with the array, so a job carrying batteries lands
                            higher than this and hands back more. Adders never are.
                          </Hint>
                        </>
                      ) : (
                        <Hint>
                          This partner prices the ordinary way, so what each deal hands back
                          depends on what it was sold at: every cent a watt the household still
                          nets above ${ppwToDollars(signTodayCapCents)}/W goes back to them. A{" "}
                          {EXAMPLE_KW} kW job netting a dime a watt over the cap returns{" "}
                          <span className="font-medium tabular-nums text-foreground">
                            {money(10 * EXAMPLE_KW * 1000)}
                          </span>
                          .
                        </Hint>
                      ))}
                  </>
                )}

                <Hint>
                  Whichever way it is set, the credit is shown on the proposal&rsquo;s tax-credit
                  switch, under the federal credits. It never changes what this partner funds or
                  what the household is asked to pay.
                </Hint>
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

        <TabsContent value="submission" className="space-y-4">
          <SubmissionMapping
            lender={lender}
            draft={draft}
            onAmountBasis={(v) => set("submissionAmountBasis", v)}
            onSavingBasis={(v) => set("submissionSavingBasis", v)}
            onSavingHorizon={(v) => set("submissionSavingHorizon", v)}
            onRepNameBasis={(v) => set("submissionRepNameBasis", v)}
            onRepName={(v) => set("submissionRepName", v)}
            onDelivery={(v) => set("submissionDelivery", v)}
            onFieldMap={(next) => set("fieldMap", next)}
          />
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
