import type { SendInput } from "./service";

/** Just enough of a deal to say who signs it. */
export type HouseholdForSigners = {
  firstName: string;
  lastName: string;
  email: string | null;
  coOwnerName: string | null;
  coOwnerEmail: string | null;
};

/** The columns `defaultSignersForLead` needs, for callers writing a `select`. */
export const HOUSEHOLD_SIGNER_SELECT = {
  firstName: true,
  lastName: true,
  email: true,
  coOwnerName: true,
  coOwnerEmail: true,
} as const;

/**
 * Who signs for this household.
 *
 * One answer, used by "Send final docs", the `send_for_signature` automation
 * and both send dialogs, because three callers deciding this separately is how
 * a spouse ends up on the contract a rep sends by hand and off the one the
 * automation sends an hour later.
 *
 * The co-owner joins at the SAME order as the customer: either may sign first,
 * and making one wait on the other only means the document stalls on whichever
 * of them checks email less often. Ours, when the template has a company half,
 * is added by `createSignaturePackage` — the household never has to know about
 * it.
 *
 * A co-owner with a name but no email is not a signer. A document is sent to an
 * address; without one there is nothing to send, and adding them would hold the
 * envelope open forever waiting on a signature that can never arrive. Their
 * name still prints through `{{coOwner.fullName}}`.
 */
export function defaultSignersForLead(lead: HouseholdForSigners): SendInput["signers"] {
  const signers: SendInput["signers"] = [
    {
      role: "customer",
      name: `${lead.firstName} ${lead.lastName}`.trim(),
      email: lead.email?.trim() || undefined,
      order: 1,
    },
  ];

  const coName = lead.coOwnerName?.trim();
  const coEmail = lead.coOwnerEmail?.trim();
  if (coName && coEmail) {
    signers.push({ role: "co_customer", name: coName, email: coEmail, order: 1 });
  }

  return signers;
}
