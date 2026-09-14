import { defineTool, z } from "./define";

/**
 * What Nova never does, by name. These are out of scope for the assistant
 * whatever the user's role allows in the portal — there are no tools for them —
 * and asking gets a plain, audited refusal instead of an improvised one.
 */
export const DECLINED_CAPABILITIES = {
  change_deal_stage: "change a deal's stage",
  edit_pricing_or_proposal: "edit pricing or proposals",
  send_to_customer: "send anything to a customer",
  approve_commission_or_payroll: "approve commissions or payroll",
  delete_anything: "delete anything",
} as const;

type Capability = keyof typeof DECLINED_CAPABILITIES;

export const declineRequest = defineTool({
  name: "decline_request",
  kind: "decline",
  description:
    "Call this when the user asks you to change a deal's stage, edit pricing or a proposal, send anything to a customer, approve commissions or payroll, or delete anything. You never do these.",
  input: z.object({
    capability: z.enum(Object.keys(DECLINED_CAPABILITIES) as [Capability, ...Capability[]]),
    request: z.string().max(300).optional().describe("What the user asked, in a few words."),
  }),
  async run(_ctx, { capability }) {
    return {
      ok: true,
      data: {
        message: `I can't ${DECLINED_CAPABILITIES[capability]} — that's outside what I'm allowed to do. You can do it in the portal if your role allows it.`,
      },
    };
  },
});
