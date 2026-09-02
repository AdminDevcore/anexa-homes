import { z } from "zod";
import { prisma } from "@/server/db/client";
import { createSignaturePackage } from "@/server/modules/esign/service";
import { defaultSignersForLead, HOUSEHOLD_SIGNER_SELECT } from "@/server/modules/esign/household-signers";
import type { ActionContext, AutomationActionModule, StepResult } from "../types";

/**
 * Who signs. Chosen by ROLE, never by name or address: a rule outlives the deal
 * it was written against, so the signer must be whoever holds that role on
 * whichever deal set the rule off.
 *
 * "Customer" means the household, not one person: `defaultSignersForLead` adds
 * the co-owner whenever the deal has one with an email, so a rule written once
 * keeps sending to both after somebody fills in a spouse. There is no separate
 * co-owner option because there is no case for asking only the spouse.
 *
 * Nor is there a company option any more. A template that needs our signature
 * carries company fields, and `createSignaturePackage` applies the authorised
 * signer's mark itself — see Settings → Authorised signers. "Assigned rep"
 * survives for rules written before that; where the template signs itself, the
 * saved signer wins and the rep is dropped.
 */
const SIGNERS = ["customer", "assigned_rep"] as const;

const schema = z.object({
  templateId: z.string().min(1),
  signer: z.enum(SIGNERS),
});

export const sendForSignatureAction: AutomationActionModule = {
  type: "send_for_signature",

  parseConfig(raw) {
    const parsed = schema.safeParse(raw);
    return parsed.success
      ? { ok: true, config: parsed.data }
      : { ok: false, error: "Pick a template and who should sign it." };
  },

  async run(ctx: ActionContext): Promise<StepResult> {
    const parsed = schema.safeParse(ctx.config);
    if (!parsed.success) return fail("Misconfigured: no template or signer.");

    const lead = await prisma.lead.findFirst({
      where: { id: ctx.leadId, companyId: ctx.companyId },
      select: {
        ...HOUSEHOLD_SIGNER_SELECT,
        assignedRep: { select: { firstName: true, lastName: true, email: true } },
      },
    });
    if (!lead) return fail("Deal not found.");

    const target = resolveSigner(parsed.data.signer, lead);
    if (!target) return fail(`This deal has no ${label(parsed.data.signer)}.`);
    // A signature request with no address is a document sent nowhere. Fail so
    // the run log names the deal that is missing an email, rather than
    // reporting success for a link nobody will ever receive.
    if (!target.email) return fail(`The ${label(parsed.data.signer)} has no email on file.`);

    try {
      await createSignaturePackage({
        companyId: ctx.companyId,
        actor: null,
        input: {
          templateIds: [parsed.data.templateId],
          leadId: ctx.leadId,
          signers:
            parsed.data.signer === "customer"
              ? defaultSignersForLead(lead)
              : [{ role: target.role, name: target.name, email: target.email, order: 1 }],
        },
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Could not send the document.");
    }

    return { type: "send_for_signature", ok: true, detail: `Sent to ${target.name}.` };
  },
};

type Resolved = { name: string; email: string | null; role: "customer" | "company_rep" };

function resolveSigner(
  which: (typeof SIGNERS)[number],
  lead: {
    firstName: string;
    lastName: string;
    email: string | null;
    assignedRep: { firstName: string; lastName: string; email: string } | null;
  }
): Resolved | null {
  // Still resolved for "customer" so the guards below can name a deal with no
  // email; the signer LIST for that case comes from defaultSignersForLead.
  if (which === "customer") {
    return { name: `${lead.firstName} ${lead.lastName}`.trim(), email: lead.email, role: "customer" };
  }
  return lead.assignedRep
    ? {
        name: `${lead.assignedRep.firstName} ${lead.assignedRep.lastName}`.trim(),
        email: lead.assignedRep.email,
        role: "company_rep",
      }
    : null;
}

function label(which: string): string {
  return which === "assigned_rep" ? "assigned rep" : "customer";
}

function fail(detail: string): StepResult {
  return { type: "send_for_signature", ok: false, detail };
}
