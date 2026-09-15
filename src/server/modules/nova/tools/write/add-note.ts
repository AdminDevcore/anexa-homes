import { prisma } from "@/server/db/client";
import { postDealFeedAction } from "@/server/modules/solar/cockpit-actions";
import { refuseUnless, resolveDeal } from "../../access";
import { defineWriteTool, z } from "../define";
import { DEAL_GONE, justNow, personName } from "./common";

export const addNote = defineWriteTool({
  name: "add_note",
  description:
    "Post a note on a Solar deal's Activity tab, as the user. Omit deal_id for the deal on screen. The user is asked to confirm before it posts.",
  input: z.object({
    deal_id: z.guid().optional().describe("From find_deal. Omit for the deal on screen."),
    text: z.string().trim().min(1).max(4000).describe("The note, in the user's words."),
  }),
  async prepare(ctx, { deal_id, text }) {
    // The Activity tab's own gate: whoever can open the deal can post on it.
    const refused = refuseUnless(ctx.user, "read", "Lead", "post notes on deals");
    if (refused) return refused;
    const deal = await resolveDeal(ctx, deal_id);
    if (!deal.ok) return deal;
    const lead = await prisma.lead.findFirst({
      where: { id: deal.leadId, companyId: ctx.user.companyId },
      select: { firstName: true, lastName: true },
    });
    if (!lead) return DEAL_GONE;
    const customer = personName(lead);
    return {
      ok: true,
      summary: `Add a note to ${customer}'s deal: "${text}"`,
      leadId: deal.leadId,
      args: { deal_id: deal.leadId, text },
      plan: { leadId: deal.leadId, text, customer },
    };
  },
  async execute(ctx, plan) {
    const startedAt = new Date();
    const res = await postDealFeedAction({ leadId: plan.leadId, body: plan.text });
    if (!res.ok) return { ok: false, message: res.error };
    const post = await prisma.dealFeedPost.findFirst({
      where: {
        companyId: ctx.user.companyId,
        leadId: plan.leadId,
        authorId: ctx.user.userId,
        body: plan.text,
        createdAt: justNow(startedAt),
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    return {
      ok: true,
      done: `Added a note to ${plan.customer}'s deal: "${plan.text}"`,
      leadId: plan.leadId,
      entityType: "DealFeedPost",
      entityId: post?.id ?? null,
    };
  },
});
