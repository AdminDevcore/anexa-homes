"use client";

import * as React from "react";
import { Caution, ChoiceCards, Hint, Panel } from "@/components/portal/settings-kit/fields";
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
 * So: every field on the wire, named, with the screen that owns its value.
 *
 * MOST OF IT IS NOT A CHOICE, and the table says so rather than offering a
 * dropdown per row. A first name has exactly one sensible source. The two rows
 * that ARE choices are choices because more than one figure is TRUE and only
 * the partner knows which one their paper is written at — and getting those
 * wrong is a six-figure misstatement on a credit application, which is
 * precisely why they belong on a settings screen instead of in a constant.
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
}: {
  lender: LenderRow;
  draft: { submissionAmountBasis: LenderRow["submissionAmountBasis"]; submissionSavingBasis: LenderRow["submissionSavingBasis"] };
  onAmountBasis: (v: LenderRow["submissionAmountBasis"]) => void;
  onSavingBasis: (v: LenderRow["submissionSavingBasis"]) => void;
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
      </Panel>

      <Panel title="Everything else on the application">
        <p className="text-sm text-muted-foreground">
          Fixed, because each has exactly one sensible source. Change the value on the screen that
          owns it — there is no separate mapping, so what a rep sees is always what the lender is
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
              {ROWS.map((r) => (
                <tr key={r.field} className="align-top">
                  <td className="py-2 pr-4 font-mono text-xs">{r.field}</td>
                  <td className="py-2 pr-4">{r.from}</td>
                  <td className="py-2 text-muted-foreground">{r.where}</td>
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

/** Every field on the wire that is not a setting above. */
const ROWS: { field: string; from: string; where: string }[] = [
  { field: "applicant.firstName", from: "The lead's first name", where: "the deal" },
  { field: "applicant.lastName", from: "The lead's last name", where: "the deal" },
  { field: "applicant.email", from: "The lead's email, lowercased", where: "the deal" },
  { field: "applicant.phone", from: "The lead's phone, digits only", where: "the deal" },
  { field: "property.line1 / city / state / postalCode", from: "The lead's address", where: "the deal" },
  { field: "property.ownerOccupied", from: "Answered when QUALIFY is pressed — stored nowhere", where: "the send dialog" },
  { field: "salesRepName", from: "The deal's rep, or whoever pressed the button", where: "the deal" },
  { field: "productSlug", from: "This partner's product", where: "Details → Direct submission" },
  { field: "externalId", from: "The design's id, so a resend cannot open a second file", where: "“Start a new reference”" },
  { field: "termMonths", from: "The proposal's loan term", where: "Financing, then regenerate" },
  { field: "equipment[].brand / model", from: "This partner's own name for the item", where: "the Equipment tab" },
  { field: "equipment[].quantity — panels", from: "The panel count on the roof drawing", where: "the designer" },
  { field: "equipment[].quantity — inverters", from: "Array watts ÷ the item's rated watts", where: "Solar Equipment → Rated W" },
  { field: "equipment[].quantity — batteries", from: "The battery count on the design", where: "the designer" },
  { field: "system.annualProductionKwh", from: "The proposal's year-one production", where: "the designer, then regenerate" },
  { field: "system.annualConsumptionKwh", from: "The proposal's annual usage", where: "Energy, then regenerate" },
  { field: "system.retailRatePerKwh", from: "The proposal's utility rate, in dollars per kWh", where: "Energy, then regenerate" },
];
