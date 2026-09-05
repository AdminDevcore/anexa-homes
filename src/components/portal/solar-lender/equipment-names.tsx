"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Download, Loader2, TriangleAlert, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Caution, Hint, Pill } from "@/components/portal/settings-kit/fields";
import { readLenderCatalogueAction } from "@/server/modules/solar/amos-actions";
import { suggestPartnerItem } from "@/lib/lender-equipment-match";
import type { ApprovedEquipmentRow, LenderRow, PartnerCatalogueItem } from "./types";

/**
 * WHAT THIS PARTNER CALLS THE EQUIPMENT WE CALL SOMETHING ELSE.
 *
 * The tab exists because two correct catalogues disagree. Ours names a SKU and
 * carries the wattage, because the designer sizes an array from it. A lender's
 * approved-vendor list names a product family:
 *
 *     ours   Qcells · Q.PEAK DUO BLK ML-G10.C+ 405
 *     Amos   Qcells · Q.PEAK DUO BLK ML G10.C+
 *
 * Neither can be renamed into the other — dropping the wattage would break the
 * designer, and the next partner would want a third spelling regardless — so
 * the translation is written down here, per partner, on the row that already
 * says this partner approves this item.
 *
 * A DROPDOWN OF THEIR LIST, NEVER A TEXT BOX. A typed name that is one space
 * out from theirs looks correct on this screen and is refused by their
 * validator with `unknown_equipment`, in front of a homeowner, at the moment
 * they press Qualify. Their list is fetched from their own API, so the only
 * strings reachable through this UI are strings they will accept.
 *
 * CONTROLLED, like the adder rules beside it: the draft belongs to the lender
 * panel so the one Save at the bottom of the screen commits it with everything
 * else about the partner.
 */

/** Their word for the same kind of thing. */
const THEIR_KIND: Record<ApprovedEquipmentRow["kind"], PartnerCatalogueItem["kind"]> = {
  module: "panel",
  inverter: "inverter",
  battery: "battery",
};

const GROUPS: { kind: ApprovedEquipmentRow["kind"]; label: string }[] = [
  { kind: "module", label: "Panels" },
  { kind: "inverter", label: "Inverters" },
  { kind: "battery", label: "Batteries" },
];

/** One draft entry, keyed by our equipment id. Null = not mapped. */
export type EquipmentNameDraft = Record<string, { brand: string; model: string } | null>;

/**
 * The value one `<option>` carries: their brand and their model, in one string.
 *
 * Joined by U+001F, the ASCII unit separator, rather than by a space. Both
 * halves routinely contain a space ("Canadian Solar", "PRIME DCA2
 * (SIL440QD-DCA2)"), so splitting on one would file that panel under a brand
 * called "PRIME".
 */
const SEP = "\u001f";
const optionValue = (i: { brand: string; model: string }) => `${i.brand}${SEP}${i.model}`;

/** The pair back out. The empty value, "not on their list", is null. */
function parseOption(value: string): { brand: string; model: string } | null {
  const at = value.indexOf(SEP);
  if (at < 0) return null;
  return { brand: value.slice(0, at), model: value.slice(at + 1) };
}

export function equipmentNameDraftFrom(lender: LenderRow): EquipmentNameDraft {
  const out: EquipmentNameDraft = {};
  for (const row of lender.approvedEquipment) {
    out[row.equipmentId] =
      row.lenderBrand && row.lenderModel
        ? { brand: row.lenderBrand, model: row.lenderModel }
        : null;
  }
  return out;
}

export function LenderEquipmentPanel({
  lender,
  draft,
  canEdit,
  onChange,
}: {
  lender: LenderRow;
  draft: EquipmentNameDraft;
  canEdit: boolean;
  onChange: (next: EquipmentNameDraft) => void;
}) {
  const [catalogue, setCatalogue] = React.useState<PartnerCatalogueItem[] | null>(null);
  const [pulling, setPulling] = React.useState(false);
  /** Rows this screen filled in by guessing, so they can be marked until saved. */
  const [guessed, setGuessed] = React.useState<Set<string>>(new Set());

  const rows = lender.approvedEquipment;
  const submits = !!lender.apiBaseUrl && !!lender.apiKeyMasked && !!lender.apiProductSlug;
  const mapped = rows.filter((r) => draft[r.equipmentId]).length;

  /**
   * Fetch their list, and fill in every unmapped row we can be sure about.
   *
   * Only the unmapped ones: a name somebody has already chosen is an answer,
   * and a button labelled "pull their list" that quietly overwrote it would be
   * the second-worst thing on this screen. Nothing is written until Save.
   */
  async function pull() {
    setPulling(true);
    try {
      const res = await readLenderCatalogueAction(lender.id);
      if (!res.ok) {
        toast.error(res.error, { duration: 9000 });
        return;
      }
      setCatalogue(res.equipment);

      const next = { ...draft };
      const filled = new Set<string>();
      for (const row of rows) {
        if (next[row.equipmentId]) continue;
        const hit = suggestPartnerItem(
          { kind: THEIR_KIND[row.kind], manufacturer: row.manufacturer, model: row.model },
          res.equipment
        );
        if (hit) {
          next[row.equipmentId] = { brand: hit.brand, model: hit.model };
          filled.add(row.equipmentId);
        }
      }
      setGuessed(filled);
      if (filled.size > 0) onChange(next);

      const stillBlank = rows.length - Object.values(next).filter(Boolean).length;
      toast.success(
        filled.size > 0
          ? `Read ${res.equipment.length} items from ${lender.name}. Filled ${filled.size} in — check them, then Save.`
          : `Read ${res.equipment.length} items from ${lender.name}.`,
        { description: stillBlank > 0 ? `${stillBlank} still need a name.` : undefined },
      );
    } catch {
      toast.error("Could not read that lender's catalogue. Try again in a moment.");
    } finally {
      setPulling(false);
    }
  }

  function setRow(equipmentId: string, value: string) {
    const next = { ...draft };
    next[equipmentId] = parseOption(value);
    // Choosing by hand is no longer a guess.
    setGuessed((g) => {
      if (!g.has(equipmentId)) return g;
      const n = new Set(g);
      n.delete(equipmentId);
      return n;
    });
    onChange(next);
  }

  if (!submits) {
    return (
      <div className="space-y-4">
        <Hint>
          {lender.name} takes applications by link, not over an API, so nothing here would ever be
          sent. Add its API address, key and product on the{" "}
          <span className="font-medium text-foreground">Details</span> tab and this becomes the list
          of names its validator checks against.
        </Hint>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        {lender.name} approves no sellable hardware yet. Tick it onto their approved-vendor list
        from{" "}
        <Link href="/portal/settings/solar-equipment" className="underline underline-offset-2">
          Solar Equipment
        </Link>
        , then come back and say what they call each piece.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">What {lender.name} calls each item</h3>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
              Their approved-vendor list names a product family; ours names the SKU and carries the
              wattage the designer sizes from. A deal carrying an item they cannot find under their
              own name is refused —{" "}
              <span className="font-medium text-foreground">unknown equipment</span> — so a rep
              cannot send it and the customer&rsquo;s document falls back to the plain application
              link.
            </p>
          </div>
          <Pill tone={mapped === rows.length ? "gold" : "warn"}>
            {mapped}/{rows.length} named
          </Pill>
        </div>

        {canEdit && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={pull} disabled={pulling}>
              {pulling ? (
                <Loader2 className="size-4 animate-spin" />
              ) : catalogue ? (
                <Wand2 className="size-4" />
              ) : (
                <Download className="size-4" />
              )}
              {catalogue ? "Read their list again" : `Read ${lender.name}'s list`}
            </Button>
            <span className="text-[11px] text-muted-foreground">
              {catalogue
                ? `${catalogue.length} items, live from their API.`
                : "Fetched from their API, so every name here is one they accept."}
            </span>
          </div>
        )}
      </div>

      {!catalogue && (
        <Hint>
          Read their list first — until then there is nothing to choose from, and a name typed by
          hand is the failure this screen exists to prevent.
        </Hint>
      )}

      {mapped < rows.length && catalogue && (
        <Caution>
          {rows.length - mapped} {rows.length - mapped === 1 ? "item is" : "items are"} still
          unnamed. Any deal built on {rows.length - mapped === 1 ? "it" : "one of them"} cannot be
          submitted to {lender.name} — the rep sees why on the deal, and the homeowner is quietly
          shown the ordinary application link instead.
        </Caution>
      )}

      {GROUPS.map((g) => {
        const inGroup = rows.filter((r) => r.kind === g.kind);
        if (inGroup.length === 0) return null;
        const theirs = (catalogue ?? []).filter((i) => i.kind === THEIR_KIND[g.kind]);
        return (
          <section key={g.kind} className="rounded-xl border border-border bg-card">
            <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {g.label}
              </h4>
              <span className="text-[11px] text-muted-foreground">
                {inGroup.filter((r) => draft[r.equipmentId]).length}/{inGroup.length} named
                {catalogue ? ` · ${theirs.length} on theirs` : ""}
              </span>
            </header>
            <ul className="divide-y divide-border">
              {inGroup.map((row) => {
                const chosen = draft[row.equipmentId];
                const isGuess = guessed.has(row.equipmentId);
                /**
                 * A saved name whose item has since dropped off their list still
                 * has to appear, or the dropdown would silently reset it to
                 * blank the first time this tab is opened.
                 */
                const options = chosen && !theirs.some((i) => optionValue(i) === optionValue(chosen))
                  ? [
                      { kind: THEIR_KIND[g.kind], brand: chosen.brand, model: chosen.model, watts: null, capacityKwh: null } as PartnerCatalogueItem,
                      ...theirs,
                    ]
                  : theirs;

                return (
                  <li
                    key={row.equipmentId}
                    className="grid gap-2 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:items-center"
                  >
                    <div className="min-w-0">
                      <span className="block truncate text-sm font-medium">{row.ourName}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {row.ratingW ? `${row.ratingW} W · ` : ""}our catalogue
                      </span>
                    </div>
                    <div className="min-w-0">
                      <label className="sr-only" htmlFor={`map-${row.equipmentId}`}>
                        What {lender.name} calls {row.ourName}
                      </label>
                      <select
                        id={`map-${row.equipmentId}`}
                        data-testid={`lender-equipment-map-${row.equipmentId}`}
                        disabled={!canEdit || !catalogue}
                        value={chosen ? optionValue(chosen) : ""}
                        onChange={(e) => setRow(row.equipmentId, e.target.value)}
                        className={cn(
                          "h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm",
                          "disabled:cursor-not-allowed disabled:opacity-60",
                          chosen
                            ? isGuess
                              ? "border-amber-500/60 bg-amber-500/[0.06]"
                              : "border-gold/50"
                            : "border-border"
                        )}
                      >
                        <option value="">
                          {catalogue ? "— not on their list —" : "read their list first"}
                        </option>
                        {options.map((i) => (
                          <option key={optionValue(i)} value={optionValue(i)}>
                            {i.brand} · {i.model}
                            {i.watts ? ` (${i.watts} W)` : ""}
                          </option>
                        ))}
                      </select>
                      {isGuess && (
                        <span className="mt-1 flex items-center gap-1 text-[11px] text-amber-600">
                          <TriangleAlert className="size-3 shrink-0" />
                          Our guess — check it before saving.
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <Hint>
        A name here changes what is SENT, never what is quoted or printed: the proposal, the
        designer and the contract all keep our catalogue&rsquo;s name for the item.
      </Hint>
    </div>
  );
}
