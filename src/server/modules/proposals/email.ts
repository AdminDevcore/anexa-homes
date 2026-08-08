// The customer's copy of their proposal, as an email.
//
// A link, not a PDF attachment: the presentation is the thing the customer
// interacts with — they pick how they want to pay, ask a question, or request a
// change right on the page, and all three write back to the deal. So the email's
// job is to carry the numbers far enough that it reads like the proposal in the
// inbox preview, then hand off to the live page.

import { paymentPlan, type ProposalContent } from "@/lib/proposal";
import { brandedEmailTemplate, type EmailBrand } from "@/server/modules/notifications/email-templates";

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export type ProposalEmailInput = {
  brand: EmailBrand;
  customerName: string;
  propertyAddress: string;
  dealType: "cash" | "insurance";
  repName: string | null;
  /** The out-of-pocket the presentation itself shows — never recomputed here. */
  outOfPocketCents: number;
  financing: ProposalContent["financing"];
  url: string;
  /** Optional note the rep typed; leads the email in their own voice. */
  message?: string;
};

/** Build the branded proposal email. Pure — same input, same bytes. */
export function proposalEmail(i: ProposalEmailInput): { subject: string; html: string; text: string } {
  const isCash = i.dealType === "cash";
  const plan = paymentPlan({ outOfPocketCents: i.outOfPocketCents, financing: i.financing });
  // "Your total" on a cash bid, "your out-of-pocket" on a claim — the same
  // wording the presentation uses, so the email never introduces a new term.
  const amountLabel = isCash ? "Your total" : "Your out-of-pocket";

  const firstName = (i.customerName || "").trim().split(/\s+/)[0] || "there";

  const paragraphs = [
    `Hi ${firstName},`,
    ...(i.message ? [i.message] : []),
    `Here is your ${isCash ? "roofing proposal" : "roofing restoration proposal"} for ${i.propertyAddress}.`,
    // A proposal with nothing priced yet still gets sent — the rep may be
    // walking the customer through scope first. Quote nothing rather than $0.
    ...(plan.totalCents > 0
      ? [
          plan.headline
            ? `${amountLabel} is ${money(plan.totalCents)} — or as low as ${money(plan.headline.monthlyCents)}/mo for ${plan.headline.months} months at 0% interest.`
            : `${amountLabel} is ${money(plan.totalCents)}.`,
        ]
      : []),
    `Open it to see the full breakdown, the photos and materials, and to choose how you'd like to pay.` +
      ` If anything looks off you can ask a question or request a change right on the page${i.repName ? `, and ${i.repName} will follow up` : ""}.`,
  ];

  return brandedEmailTemplate({
    brand: i.brand,
    subject: `Your ${i.brand.companyName} proposal for ${i.propertyAddress}`,
    preheader:
      plan.totalCents > 0
        ? `${amountLabel}: ${money(plan.totalCents)}. Review it and choose how you'd like to pay.`
        : `Your proposal is ready — open it to see the full breakdown.`,
    heading: "Your proposal is ready",
    paragraphs,
    cta: { label: "View my proposal", url: i.url },
    note: "This link is private to you — please don't forward it.",
  });
}
