import { buildAutofillContext, type AutofillContext } from "./autofill";
import type { ResolvedSigner } from "@/lib/company-signer";

/**
 * The lead shape an autofill context is built from, and the builder itself.
 *
 * Its own module rather than a private function in service.ts because the
 * automation engine needs to fill a template for a deal with NOBODY LOGGED IN,
 * and importing the send-for-signature service just to reach one pure mapping
 * function would drag a session-shaped dependency into a path that has no
 * session. Moved verbatim; nothing here changed but the `export` keywords.
 */

/**
 * The company identity the autofill context needs. Selected in one place so a
 * new Company token can never be added to the catalog and then arrive empty
 * because one of the four query sites still asked for the name alone.
 */
export const COMPANY_CTX_SELECT = {
  name: true,
  phone: true,
  email: true,
  website: true,
  address: true,
  city: true,
  state: true,
  zip: true,
  einTaxId: true,
} as const;

export type CompanyForCtx = {
  name: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  einTaxId?: string | null;
};

// Shared include so view + generate fetch every field the autofill context needs.
export const LEAD_CTX_INCLUDE = {
  source: { select: { name: true } },
  // Selected, not included: the design also carries the roof layout and 12
  // months of readings, and a permit line on a contract is not worth shipping
  // a drawing to read.
  solarDesign: {
    select: {
      ahjName: true,
      ahjContactName: true,
      ahjContactInfo: true,
      permitNumber: true,
      installerContact: true,
      installerTitle: true,
      permitNotRequired: true,
      ptoNotRequired: true,
      interconnectionNotRequired: true,
      otherUtilityStatus: true,
      otherUtilityStatusDetail: true,
    },
  },
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
  coOwnerEmail: string | null;
  coOwnerPhone: string | null;
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
  solarDesign?: {
    ahjName: string | null;
    ahjContactName: string | null;
    ahjContactInfo: string | null;
    permitNumber: string | null;
    installerContact: string | null;
    installerTitle: string | null;
    permitNotRequired: boolean;
    ptoNotRequired: boolean;
    interconnectionNotRequired: boolean;
    otherUtilityStatus: boolean;
    otherUtilityStatusDetail: string | null;
  } | null;
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

/**
 * Who signed for us, and when. Absent on a preview or on a document with no
 * company half — the `signer.*` tokens then resolve to blanks rather than to
 * a name nobody has authorised.
 */
export type SignerForCtx = { signer: ResolvedSigner | null; signedOn?: Date | null };

export function ctxForLead(
  lead: LeadForCtx,
  company: CompanyForCtx,
  signing?: SignerForCtx
): AutofillContext {
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
    coOwnerEmail: lead.coOwnerEmail,
    coOwnerPhone: lead.coOwnerPhone,
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
    companyName: company.name,
    companyPhone: company.phone,
    companyEmail: company.email,
    companyWebsite: company.website,
    companyStreet: company.address,
    companyCity: company.city,
    companyState: company.state,
    companyZip: company.zip,
    companyEin: company.einTaxId,
    permit: lead.solarDesign ?? null,
    signer: signing?.signer ?? null,
    signedOn: signing?.signedOn ?? null,
    custom,
  });
}
