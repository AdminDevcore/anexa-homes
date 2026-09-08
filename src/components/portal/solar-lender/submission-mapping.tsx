"use client";

import * as React from "react";
import { Caution, ChoiceCards, Hint, Panel, TextField } from "@/components/portal/settings-kit/fields";
import type { LenderRow } from "./types";

/**
 * WHAT THIS PARTNER'S API IS TOLD, AND WHERE EACH FIGURE COMES FROM.
 *
 * The integration is a push: a rep presses QUALIFY and Anexa assembles an
 * application out of the deal. Which of our fields becomes which of theirs was
 * decided in code, and for a long time there was nowhere to look it up — an
 * admin asking "does the loan amount go over before or after the tax credit"
 * had no way to answer it short of reading the source.
 *
 * So: every field on the wire, named, with the screen that owns its value —
 * INCLUDING the ones the settings below decide. A list of "everything else"
 * that leaves out the loan amount and the saving is not a list anybody can
 * check a partner's setup against, so the settings appear in the table too,
 * marked, reading back whichever answer this partner is configured to give.
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
/** The unsaved state of this tab, as the detail screen holds it. */
export type SubmissionDraft = {
  submissionAmountBasis: LenderRow["submissionAmountBasis"];
  submissionSavingBasis: LenderRow["submissionSavingBasis"];
  submissionSavingHorizon: LenderRow["submissionSavingHorizon"];
  submissionRepNameBasis: LenderRow["submissionRepNameBasis"];
  submissionRepName: string;
  submissionDelivery: LenderRow["submissionDelivery"];
};

export function SubmissionMapping({
  lender,
  draft,
  onAmountBasis,
  onSavingBasis,
  onSavingHorizon,
  onRepNameBasis,
  onRepName,
  onDelivery,
}: {
  lender: LenderRow;
  draft: SubmissionDraft;
  onAmountBasis: (v: LenderRow["submissionAmountBasis"]) => void;
  onSavingBasis: (v: LenderRow["submissionSavingBasis"]) => void;
  onSavingHorizon: (v: LenderRow["submissionSavingHorizon"]) => void;
  onRepNameBasis: (v: LenderRow["submissionRepNameBasis"]) => void;
  onRepName: (v: string) => void;
  onDelivery: (v: LenderRow["submissionDelivery"]) => void;
}) {
  const wired = !!lender.apiBaseUrl && !!lender.apiProductSlug;

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


      <Panel title="Everything on the application">
        <p className="text-sm text-muted-foreground">
          Every field on the wire, in the order the body carries them. The five marked{" "}
          <span className="font-medium text-foreground">above</span> are the settings on this tab —
          they are listed here too so the whole application can be read in one place. The rest are
          fixed, because each has exactly one sensible source: change the value on the screen that
          owns it. There is no separate mapping, so what a rep sees is always what the lender is
          told.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4 font-medium">They receive</th>
                <th className="py-2 pr-4 font-medium">From</th>
                <th className="py-2 font-medium">Changed on</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {wireRows(draft).map((r) => (
                <tr key={r.field} className="align-top">
                  <td className="py-2 pr-4 font-mono text-xs">{r.field}</td>
                  <td className="py-2 pr-4">{r.from}</td>
                  <td className="py-2 text-muted-foreground">
                    {r.setting ? (
                      <span className="inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
                        <span className="rounded border border-solar/40 bg-solar/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground/80">
                          above
                        </span>
                        <span>{r.where}</span>
                      </span>
                    ) : (
                      r.where
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Hint>
          Nothing else crosses the wire. No social security number, no date of birth and no consent
          flag — authorising a credit pull has to be the customer’s own act, captured on the
          partner’s page under their disclosures, and Anexa stays out of it.
        </Hint>
      </Panel>
    </div>
  );
}

type WireRow = {
  field: string;
  from: string;
  where: string;
  /** True where a panel above decides it, and `where` names that panel. */
  setting?: boolean;
};

/**
 * EVERY FIELD ON THE WIRE, in the order the request body carries them.
 *
 * The settings above are in this table too, marked. They used to be excluded on
 * the reasoning that a row asking a question does not also need a line stating
 * it — but the effect was a section titled "everything else" that omitted the
 * loan amount and the saving, so the one question an admin brings to this
 * screen ("what exactly does this partner receive?") had no single answer on
 * it. A field configured somewhere is still a field on the application.
 *
 * WHAT A SETTING ROW SAYS IN "FROM" IS THE ANSWER THIS PARTNER IS CONFIGURED TO
 * GIVE, not a deal's number: it moves with the controls above and is equally
 * true of a partner with no deals yet. The live figures stay off this screen —
 * the payload inspector on a proposal's preview shows the real body.
 */
function wireRows(draft: SubmissionDraft): WireRow[] {
  const AMOUNT = "“The amount they are asked to fund”";
  const SAVING = "“What they mean by a saving”";
  const SELLER = "“Whose name goes on it”";
  const DEVICE = "“Who completes the application”";

  const savingBasis =
    draft.submissionSavingBasis === "net_of_payment"
      ? "The bill the proposal says stops arriving, less what the system costs"
      : "The electricity bill the proposal says stops arriving";
  const savingHorizon =
    draft.submissionSavingHorizon === "term_average"
      ? ", averaged over every year it compares"
      : ", in the first twelve months";

  const fixedName = draft.submissionRepName.trim();
  const seller =
    draft.submissionRepNameBasis === "fixed"
      ? fixedName.length > 0
        ? `Always “${fixedName}”, whoever sold it`
        : "No name typed yet, so the deal's rep is still sent"
      : draft.submissionRepNameBasis === "submitter"
        ? "Whoever pressed the button — the deal's rep where the household pressed it"
        : "The rep the deal is assigned to";

  return [
    { field: "externalId", from: "The design's id, so a resend cannot open a second file", where: "“Start a new reference”" },
    { field: "productSlug", from: "This partner's product", where: "Details → Direct submission" },
    { field: "applicant.firstName", from: "The lead's first name", where: "the deal" },
    { field: "applicant.lastName", from: "The lead's last name", where: "the deal" },
    { field: "applicant.email", from: "The lead's email, lowercased", where: "the deal" },
    { field: "applicant.phone", from: "The lead's phone, digits only", where: "the deal" },
    { field: "property.line1 / city / state / postalCode", from: "The lead's address", where: "the deal" },
    { field: "property.ownerOccupied", from: "Answered when QUALIFY is pressed — stored nowhere", where: "the send dialog" },
    { field: "system.annualProductionKwh", from: "The proposal's year-one production", where: "the designer, then regenerate" },
    { field: "system.annualConsumptionKwh", from: "The proposal's annual usage", where: "Energy, then regenerate" },
    { field: "system.retailRatePerKwh", from: "The proposal's utility rate, in dollars per kWh", where: "Energy, then regenerate" },
    { field: "system.estAnnualSaving", from: `${savingBasis}${savingHorizon}`, where: SAVING, setting: true },
    { field: "system.estMonthlySaving", from: "The annual figure above ÷ 12, rounded once so the two agree", where: SAVING, setting: true },
    { field: "equipment[].brand / model", from: "This partner's own name for the item", where: "the Equipment tab" },
    { field: "equipment[].quantity — panels", from: "The panel count on the roof drawing", where: "the designer" },
    { field: "equipment[].quantity — inverters", from: "Array watts ÷ the item's rated watts", where: "Solar Equipment → Rated W" },
    { field: "equipment[].quantity — batteries", from: "The battery count on the design", where: "the designer" },
    { field: "requestedAmount", from: amountFrom(draft.submissionAmountBasis), where: AMOUNT, setting: true },
    { field: "termMonths", from: "The proposal's loan term", where: "Financing, then regenerate" },
    { field: "salesRepName", from: seller, where: SELLER, setting: true },
    {
      field: "delivery",
      from:
        draft.submissionDelivery === "customer"
          ? "Only the partner's own email and text reach the household"
          : "The completion link comes back, for the rep's own device",
      where: DEVICE,
      setting: true,
    },
  ];
}

/** The figure this partner is currently configured to be asked for. */
function amountFrom(basis: SubmissionDraft["submissionAmountBasis"]): string {
  if (basis === "customer_obligation") return "What the proposal says the household owes";
  if (basis === "after_credits") return "The contract value, less the credits the proposal quotes";
  return "The proposal's contract value, before any tax credit";
}
