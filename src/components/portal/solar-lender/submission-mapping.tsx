"use client";

import * as React from "react";
import { Caution, ChoiceCards, Hint, Panel, TextField } from "@/components/portal/settings-kit/fields";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FIELD_SOURCES, WIRE_FIELDS, type FieldKind } from "@/server/modules/solar/lender-field-map";
import type { LenderRow } from "./types";

/** What a row is set to. Absent from the draft entirely means "built-in". */
export type FieldMapDraft = Record<string, { sourceKey: string | null; literal: string }>;

/** The sentinel the picker uses for "let the built-in source stand". */
export const BUILT_IN = "__default__";
/** ...and for "I will type the value myself". */
export const CONSTANT = "__constant__";

/**
 * WHICH OPTION A ROW IS SHOWING.
 *
 * Its own function because getting it wrong is invisible: derived from the
 * literal being non-empty, choosing “A constant I type…” stored an empty one,
 * which read back as built-in — so the select snapped shut on the old value and
 * the box to type in never appeared. ABSENCE is built-in; a row with no source
 * is a constant, typed or not yet.
 */
export function rowSelection(
  entry: { sourceKey: string | null; literal: string } | undefined,
): string {
  if (!entry) return BUILT_IN;
  // The literal wins where a row somehow carries both, because that is what
  // `applyFieldMap` sends. The save action stores one or the other, so this is
  // unreachable today — and a screen that disagreed with the wire about which
  // half was live is exactly the bug nobody would think to look for.
  if (entry.literal.trim() !== "") return CONSTANT;
  return entry.sourceKey === null ? CONSTANT : entry.sourceKey;
}

/**
 * WHAT THIS PARTNER'S API IS TOLD, AND WHERE EACH FIGURE COMES FROM.
 *
 * The integration is a push: a rep presses QUALIFY and Anexa assembles an
 * application out of the deal. Which of our fields becomes which of theirs was
 * decided in code, and for a long time there was nowhere to look it up — an
 * admin asking "does the loan amount go over before or after the tax credit"
 * had no way to answer it short of reading the source.
 *
 * So: every field on the wire, named, with the screen that owns its value.
 *
 * MOST OF IT IS NOT A CHOICE, and the table says so rather than offering a
 * dropdown per row. A first name has exactly one sensible source.
 *
 * THE BAR FOR BECOMING A SETTING is that more than one answer is TRUE and only
 * the partner knows which of them their own paper is written at. Five rows
 * clear it: the loan amount, what a saving means, which year that saving
 * describes, whose name goes on as the seller, and whose device the household
 * finishes on. Each was a constant in this file before it was a column, and
 * each was silently RIGHT for the first partner and unknowable for the second.
 *
 * Rows that do NOT clear the bar stay stated, however tempting. Production is
 * the instructive refusal: the quoted figure is held under the model on
 * purpose, so the un-derated one is arguably also true — but the saving beside
 * it is computed FROM the quoted figure, and a partner handed a production
 * number that does not reconcile with the saving has been handed two different
 * deals. Inverter quantity is the other: it is a fact about the hardware, not
 * about the partner, and `inverterCount` already reasons it out from nameplate.
 *
 * The LIVE values are deliberately not here. A settings screen showing one
 * deal's numbers is a settings screen pretending to be a deal; the payload
 * inspector on a proposal's preview shows the real body for the real deal.
 */
export function SubmissionMapping({
  lender,
  draft,
  onAmountBasis,
  onSavingBasis,
  onSavingHorizon,
  onRepNameBasis,
  onRepName,
  onDelivery,
  onFieldMap,
}: {
  lender: LenderRow;
  draft: {
    submissionAmountBasis: LenderRow["submissionAmountBasis"];
    submissionSavingBasis: LenderRow["submissionSavingBasis"];
    submissionSavingHorizon: LenderRow["submissionSavingHorizon"];
    submissionRepNameBasis: LenderRow["submissionRepNameBasis"];
    submissionRepName: string;
    submissionDelivery: LenderRow["submissionDelivery"];
    fieldMap: FieldMapDraft;
  };
  onAmountBasis: (v: LenderRow["submissionAmountBasis"]) => void;
  onSavingBasis: (v: LenderRow["submissionSavingBasis"]) => void;
  onSavingHorizon: (v: LenderRow["submissionSavingHorizon"]) => void;
  onRepNameBasis: (v: LenderRow["submissionRepNameBasis"]) => void;
  onRepName: (v: string) => void;
  onDelivery: (v: LenderRow["submissionDelivery"]) => void;
  /** The whole map, replaced — see `setLenderFieldMapAction` for why. */
  onFieldMap: (next: FieldMapDraft) => void;
}) {
  const wired = !!lender.apiBaseUrl && !!lender.apiProductSlug;
  const mapped = Object.keys(draft.fieldMap).length;

  return (
    <div className="space-y-4">
      {!wired && (
        <Caution>
          This partner has no direct submission set up, so nothing is pushed to them at all — a rep
          gets their ordinary application link instead. The settings below take effect once an API
          address and product are filled in on Details.
        </Caution>
      )}

      <Panel title="The amount they are asked to fund">
        <ChoiceCards
          name={`amount-basis-${lender.id}`}
          legend="Which figure is the loan amount"
          value={draft.submissionAmountBasis}
          onChange={onAmountBasis}
          options={[
            {
              value: "contract_value",
              label: "The contract value",
              detail:
                "What this partner's own paper is written at, including any programme contribution, and BEFORE any tax credit. What every lender received before this setting existed, and right for almost all of them.",
            },
            {
              value: "customer_obligation",
              label: "What the household owes",
              detail:
                "The customer's own price. Identical to the contract value on a partner with no programme contribution — and a six-figure understatement on one that has. Choose this only if their paper really is written at the household's number.",
            },
            {
              value: "after_credits",
              label: "Contract value less the tax credits",
              detail:
                "The federal credits the proposal quotes, subtracted. Unusual: a homeowner claims those on their own return months later, so most partners lend the whole amount and are repaid early instead.",
            },
          ]}
        />
        {draft.submissionAmountBasis !== "contract_value" && (
          <Caution>
            This is not the figure this partner was sent before. Check it against a signed contract
            before the next deal goes out — the amount on a credit application is the one number
            nobody downstream re-reads. Every submission records which basis produced it.
          </Caution>
        )}
        <Hint>
          The figure itself is frozen when a proposal is generated, so changing this affects the
          NEXT submission, not a proposal already sent. To see the exact body for a deal, open its
          proposal preview and expand “What gets sent”.
        </Hint>
      </Panel>

      <Panel title="What they mean by a saving">
        <ChoiceCards
          name={`saving-basis-${lender.id}`}
          legend="The estimated monthly and annual saving"
          value={draft.submissionSavingBasis}
          onChange={onSavingBasis}
          options={[
            {
              value: "utility_avoided",
              label: "The electricity bill that stops arriving",
              detail:
                "What the utility would have charged, less what they still charge. Positive on any system that generates, which is what a partner asking for a minimum saving expects.",
            },
            {
              value: "net_of_payment",
              label: "That, less what the system costs",
              detail:
                "The household's true net position — and frequently NEGATIVE in the early years of a thirty-year loan. A partner whose amount format has no minus sign cannot accept it, so most deals will be refused before sending.",
            },
          ]}
        />
        {draft.submissionSavingBasis === "net_of_payment" && (
          <Caution>
            Expect most deals to stop being submittable. This is a true figure that many partner
            APIs cannot represent; deals whose payment exceeds the bill it replaces will be blocked
            rather than sent.
          </Caution>
        )}

        <div className="pt-1">
          <ChoiceCards
            name={`saving-horizon-${lender.id}`}
            legend="Which year that figure describes"
            why={
              <>
                The comparison on the proposal runs for the life of the loan, and the electricity
                it replaces gets more expensive every year — so a system’s “annual saving” is
                thirty different true numbers, of which year one is the smallest.
              </>
            }
            value={draft.submissionSavingHorizon}
            onChange={onSavingHorizon}
            columns={2}
            options={[
              {
                value: "year_one",
                label: "The first twelve months",
                detail:
                  "What every partner received before this setting existed. The smallest of the true answers, and the one to send where their form tests a first-year minimum.",
              },
              {
                value: "term_average",
                label: "Averaged over the whole term",
                detail:
                  "The same subtraction across every year the proposal compares, divided by the number of years. Larger than year one on any deal — utility rates escalate. Right where their form asks what the household saves per year over the life of the loan.",
              },
            ]}
          />
        </div>
        {draft.submissionSavingHorizon === "term_average" && (
          <Caution>
            A BIGGER number than this partner has been sent before, on every deal. That is the
            direction that does harm on a credit application, so check their form actually asks for
            the lifetime average before leaving this on — and note the monthly figure moves with it,
            since it is the annual one divided by twelve.
          </Caution>
        )}
      </Panel>

      <Panel title="Whose name goes on it">
        <ChoiceCards
          name={`rep-basis-${lender.id}`}
          legend="The salesperson on the application"
          why={
            <>
              The partner receives a typed name and reconciles it on their own side — against an
              approved roster, or against their portal logins. A name they cannot place comes back
              as a decline days later, with no indication that the name was the reason.
            </>
          }
          value={draft.submissionRepNameBasis}
          onChange={onRepNameBasis}
          options={[
            {
              value: "deal_rep",
              label: "The rep the deal is assigned to",
              detail:
                "Falling back to whoever caused the submission when a deal has no rep of its own. What every partner received before this setting existed.",
            },
            {
              value: "submitter",
              label: "Whoever sends it",
              detail:
                "The person who pressed the button, whatever the deal says. For a partner that matches the name against its own portal logins. When the HOUSEHOLD presses Qualify on their own document nobody here sent it, so those deals fall back to the deal’s rep.",
            },
            {
              value: "fixed",
              label: "One name, every time",
              detail:
                "The dealer contact registered with this partner, sent on every deal regardless of who sold it. For a partner that will not accept a name outside its own approved list.",
            },
          ]}
        />
        {draft.submissionRepNameBasis === "fixed" && (
          <div className="mt-3">
            <TextField
              label="The name they are sent"
              value={draft.submissionRepName}
              onChange={onRepName}
              placeholder="Jordan Ellis"
              hint="Spell it exactly as this partner has it registered. Left blank, deals fall back to the rep on the deal rather than going out with an empty name — which is a field they refuse the whole application over."
            />
          </div>
        )}
      </Panel>

      <Panel title="Who completes the application">
        <ChoiceCards
          name={`delivery-${lender.id}`}
          legend="Where the customer finishes"
          why={
            <>
              BOTH ANSWERS EMAIL AND TEXT THE HOUSEHOLD. The partner’s invitation always goes out
              and there is no way to suppress it — there is no such thing as a silent submission,
              which matters when you are testing. The only difference is whether the link also
              comes back to us.
            </>
          }
          value={draft.submissionDelivery}
          onChange={onDelivery}
          columns={2}
          options={[
            {
              value: "in_person",
              label: "On the rep’s device, there and then",
              detail:
                "The completion link comes back in the response, so a rep at the kitchen table can hand their own phone over. What every partner received before this setting existed.",
            },
            {
              value: "customer",
              label: "Only on the customer’s own device",
              detail:
                "The link is not returned to us; the household completes it from the email or text the partner sends. For a partner whose rules say the application must not be finished on the dealer’s device.",
            },
          ]}
        />
      </Panel>

      <Panel title="Everything else on the application">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="max-w-3xl text-sm text-muted-foreground">
            Each of these has a sensible built-in source, and leaving them alone is right for
            almost every partner: what a rep sees on the deal is what the lender is told. Where
            this one wants something else in a box, point it at another value or type a constant —
            it takes effect on the next submission.
          </p>
          {mapped > 0 && (
            <button
              type="button"
              onClick={() => onFieldMap({})}
              className="shrink-0 text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Reset all {mapped} to built-in
            </button>
          )}
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4 font-medium">They receive</th>
                <th className="py-2 pr-4 font-medium">Fed from</th>
                <th className="py-2 font-medium">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {WIRE_FIELDS.map((f) => (
                <MappingRow
                  key={f.field}
                  field={f}
                  entry={draft.fieldMap[f.field]}
                  onChange={(next) => {
                    const copy = { ...draft.fieldMap };
                    // An absent key IS "built-in" — see the draft's own note.
                    if (next === null) delete copy[f.field];
                    else copy[f.field] = next;
                    onFieldMap(copy);
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>

        <Hint>
          The list of values you can point at is fixed, and that is what keeps the promise below:
          a mapping cannot name a column, only one of these. Three boxes are deliberately absent —
          the loan amount and the two saving figures — because their true readings are the settings
          above, and a typed constant there would be a fabricated figure on every deal.
        </Hint>
        <Hint>
          Nothing else crosses the wire. No social security number, no date of birth and no consent
          flag — authorising a credit pull has to be the customer’s own act, captured on the
          partner’s page under their disclosures, and Anexa stays out of it.
        </Hint>
      </Panel>
    </div>
  );
}

/**
 * ONE BOX, AND WHERE IT IS FED FROM.
 *
 * The picker offers only sources of the SAME SHAPE as the box — a panel count
 * cannot be dropped into a surname — because the alternative is an admin
 * choosing something that looks accepted and is silently ignored at send time.
 * The server refuses the mismatch too; this just means nobody can pick one.
 */
function MappingRow({
  field,
  entry,
  onChange,
}: {
  field: (typeof WIRE_FIELDS)[number];
  entry: { sourceKey: string | null; literal: string } | undefined;
  onChange: (next: { sourceKey: string | null; literal: string } | null) => void;
}) {
  /**
   * A ROW PRESENT WITH NO SOURCE IS "A CONSTANT", EVEN BEFORE ONE IS TYPED.
   *
   * Deriving this from the literal being non-empty instead made the picker
   * un-selectable: choosing “A constant I type…” stored an empty one, which
   * read back as built-in, and the select snapped shut on the old value before
   * anybody could type. Absence is built-in; presence is the override.
   */
  const selected = rowSelection(entry);
  const usingConstant = selected === CONSTANT;
  const groups = groupedSources(field.kind);
  const builtIn = SOURCE_LABEL.get(field.defaultSource) ?? field.defaultSource;

  return (
    <tr className="align-top">
      <td className="py-2 pr-4 font-mono text-xs">
        {field.field}
        {!field.required && (
          <span className="ml-1.5 font-sans text-[10px] uppercase tracking-wide text-muted-foreground">
            optional
          </span>
        )}
      </td>
      <td className="py-2 pr-4">
        <Select
          value={selected}
          onValueChange={(v) => {
            if (v === BUILT_IN) return onChange(null);
            if (v === CONSTANT) return onChange({ sourceKey: null, literal: entry?.literal ?? "" });
            onChange({ sourceKey: v, literal: "" });
          }}
        >
          <SelectTrigger className="h-8 w-full min-w-[15rem] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={BUILT_IN}>{builtIn} (built-in)</SelectItem>
            {groups.map((g) => (
              <SelectGroup key={g.group}>
                <SelectLabel>{g.group}</SelectLabel>
                {g.sources.map((src) => (
                  <SelectItem key={src.key} value={src.key}>
                    {src.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
            <SelectGroup>
              <SelectLabel>Or</SelectLabel>
              <SelectItem value={CONSTANT}>A constant I type…</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </td>
      <td className="py-2 text-muted-foreground">
        {usingConstant ? (
          <Input
            className="h-8 text-xs"
            value={entry?.literal ?? ""}
            placeholder={PLACEHOLDER[field.kind]}
            aria-label={`The constant sent as ${field.field}`}
            onChange={(e) => onChange({ sourceKey: null, literal: e.target.value })}
          />
        ) : selected === BUILT_IN ? (
          <span className="text-xs">Changed on {field.changedOn}</span>
        ) : (
          <span className="text-xs italic">Overridden — no longer read from {field.changedOn}</span>
        )}
      </td>
    </tr>
  );
}

const SOURCE_LABEL = new Map(FIELD_SOURCES.map((s) => [s.key, s.label]));

/** The compatible sources, in the order the catalogue lists their groups. */
function groupedSources(kind: FieldKind) {
  const out: { group: string; sources: typeof FIELD_SOURCES }[] = [];
  for (const src of FIELD_SOURCES) {
    if (src.kind !== kind) continue;
    const last = out.find((g) => g.group === src.group);
    if (last) last.sources.push(src);
    else out.push({ group: src.group, sources: [src] });
  }
  return out;
}

const PLACEHOLDER: Record<FieldKind, string> = {
  string: "Typed exactly as they expect it",
  number: "A whole number",
  boolean: "yes or no",
  rate: "$0.233 per kWh",
};
