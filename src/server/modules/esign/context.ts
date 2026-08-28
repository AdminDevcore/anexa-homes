import { buildAutofillContext, type AutofillContext } from "./autofill";

/**
 * The lead shape an autofill context is built from, and the builder itself.
 *
 * Its own module rather than a private function in service.ts because the
 * automation engine needs to fill a template for a deal with NOBODY LOGGED IN,
 * and importing the send-for-signature service just to reach one pure mapping
 * function would drag a session-shaped dependency into a path that has no
 * session. Moved verbatim; nothing here changed but the `export` keywords.
 */

// Shared include so view + generate fetch every field the autofill context needs.
export const LEAD_CTX_INCLUDE = {
  source: { select: { name: true } },
  assignedRep: { select: { firstName: true, lastName: true } },
  project: {
    select: {
      projectNumber: true,
      serviceType: true,
      status: true,
      contractValue: true,
      customFields: true,
      manager: { select: { firstName: true, lastName: true } },
    },
  },
} as const;

export type LeadForCtx = {
  firstName: string;
  lastName: string;
  coOwnerName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  status: string;
  createdAt: Date;
  customFields: unknown;
  source: { name: string } | null;
  assignedRep: { firstName: string; lastName: string } | null;
  project: {
    projectNumber: string;
    serviceType: string;
    status: string;
    contractValue: number;
    customFields: unknown;
    manager: { firstName: string; lastName: string } | null;
  } | null;
};

export function ctxForLead(lead: LeadForCtx, companyName: string): AutofillContext {
  const custom: Record<string, string> = {};
  const merge = (obj: unknown) => {
    if (obj && typeof obj === "object") {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) custom[k] = v == null ? "" : String(v);
    }
  };
  merge(lead.customFields);
  merge(lead.project?.customFields);
  const name = (u: { firstName: string; lastName: string } | null | undefined) =>
    u ? `${u.firstName} ${u.lastName}`.trim() : null;
  return buildAutofillContext({
    firstName: lead.firstName,
    lastName: lead.lastName,
    coOwnerName: lead.coOwnerName,
    email: lead.email,
    phone: lead.phone,
    street: lead.address,
    city: lead.city,
    state: lead.state,
    zip: lead.zip,
    projectNumber: lead.project?.projectNumber,
    projectType: lead.project?.serviceType,
    projectStage: lead.project?.status,
    projectValueCents: lead.project?.contractValue,
    rep: name(lead.assignedRep),
    pm: name(lead.project?.manager),
    leadSource: lead.source?.name,
    leadCreatedAt: lead.createdAt,
    leadStatus: lead.status,
    companyName,
    custom,
  });
}
