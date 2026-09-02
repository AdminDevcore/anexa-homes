import { formatCents, formatDate } from "@/lib/format";
import type { ResolvedSigner } from "@/lib/company-signer";

/** Resolved values for every mappable token, for a specific lead/project record. */
export type AutofillContext = {
  customer: { fullName: string; firstName: string; lastName: string; coOwner: string; email: string; phone: string };
  /**
   * The second person on the title. `customer.coOwner` is kept as an alias of
   * `coOwner.fullName` so every template that already maps it keeps working —
   * this group exists because a co-owner who can sign needs an address and a
   * phone number too, not just a name.
   */
  coOwner: { fullName: string; email: string; phone: string };
  /**
   * Whoever signs for us on this document. Always present, empty when no
   * signer is configured: `resolvePath` walks the object, so a missing branch
   * and an empty string print the same blank — but only the empty branch keeps
   * the token out of the "unmapped" count.
   */
  signer: {
    name: string;
    title: string;
    email: string;
    phone: string;
    license: string;
    date: string;
    cred: Record<string, string>;
  };
  property: { street: string; city: string; state: string; zip: string; full: string };
  // `address` kept as an alias of property.full for backward-compatible templates.
  project: { number: string; address: string; type: string; stage: string; value: string; rep: string; pm: string };
  lead: { source: string; createdDate: string; status: string };
  company: {
    name: string;
    phone: string;
    email: string;
    website: string;
    street: string;
    city: string;
    state: string;
    zip: string;
    full: string;
    ein: string;
  };
  today: string;
  /**
   * Permitting & AHJ, off the solar design. Booleans resolve to "Yes" or the
   * empty string: "Yes" ticks a checkbox field (pdf.ts reads yes/true/x/1) and
   * still reads correctly if the template puts it in a text field instead,
   * while an unticked box prints nothing rather than the word "false".
   */
  permit: {
    ahj: string;
    ahjContactName: string;
    ahjContact: string;
    number: string;
    installerContact: string;
    installerTitle: string;
    notRequired: string;
    ptoNotRequired: string;
    interconnectionNotRequired: string;
    otherUtilityStatus: string;
    otherUtilityDetail: string;
  };
  custom: Record<string, string>;
};

/** A ticked box, or nothing at all. See AutofillContext.permit. */
function tick(v: boolean | null | undefined): string {
  return v ? "Yes" : "";
}

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function buildAutofillContext(a: {
  firstName: string;
  lastName: string;
  coOwnerName?: string | null;
  coOwnerEmail?: string | null;
  coOwnerPhone?: string | null;
  email?: string | null;
  phone?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  projectNumber?: string | null;
  projectType?: string | null;
  projectStage?: string | null;
  projectValueCents?: number | null;
  rep?: string | null;
  pm?: string | null;
  leadSource?: string | null;
  leadCreatedAt?: Date | null;
  leadStatus?: string | null;
  companyName: string;
  companyPhone?: string | null;
  companyEmail?: string | null;
  companyWebsite?: string | null;
  companyStreet?: string | null;
  companyCity?: string | null;
  companyState?: string | null;
  companyZip?: string | null;
  companyEin?: string | null;
  permit?: {
    ahjName?: string | null;
    ahjContactName?: string | null;
    ahjContactInfo?: string | null;
    permitNumber?: string | null;
    installerContact?: string | null;
    installerTitle?: string | null;
    permitNotRequired?: boolean;
    ptoNotRequired?: boolean;
    interconnectionNotRequired?: boolean;
    otherUtilityStatus?: boolean;
    otherUtilityStatusDetail?: string | null;
  } | null;
  /**
   * The saved signer this document is signed by, when one resolves. Optional
   * because a preview rendered before any signer exists must still produce a
   * context, and because nothing about a customer's half of the document
   * depends on ours.
   */
  signer?: ResolvedSigner | null;
  /** When the company signature was applied. Defaults to today. */
  signedOn?: Date | null;
  custom?: Record<string, string>;
}): AutofillContext {
  const full = [a.street, [a.city, a.state, a.zip].filter(Boolean).join(", ")].filter(Boolean).join(", ");
  const companyFull = [
    a.companyStreet,
    [a.companyCity, a.companyState, a.companyZip].filter(Boolean).join(", "),
  ]
    .filter(Boolean)
    .join(", ");
  const cred: Record<string, string> = {};
  for (const c of a.signer?.credentials ?? []) cred[c.key] = c.value;
  return {
    customer: {
      fullName: `${a.firstName} ${a.lastName}`.trim(),
      firstName: a.firstName,
      lastName: a.lastName,
      coOwner: a.coOwnerName ?? "",
      email: a.email ?? "",
      phone: a.phone ?? "",
    },
    coOwner: {
      fullName: a.coOwnerName ?? "",
      email: a.coOwnerEmail ?? "",
      phone: a.coOwnerPhone ?? "",
    },
    signer: {
      name: a.signer?.name ?? "",
      title: a.signer?.title ?? "",
      email: a.signer?.email ?? "",
      phone: a.signer?.phone ?? "",
      license: a.signer?.licenseNumber ?? "",
      // Only dated once there is a signature to date. A blank line is honest
      // about a document nobody has signed yet; today's date on it is not.
      date: a.signer ? formatDate(a.signedOn ?? new Date()) : "",
      cred,
    },
    property: { street: a.street ?? "", city: a.city ?? "", state: a.state ?? "", zip: a.zip ?? "", full },
    project: {
      number: a.projectNumber ?? "",
      address: full,
      type: a.projectType ? titleCase(a.projectType) : "",
      stage: a.projectStage ? titleCase(a.projectStage) : "",
      value: a.projectValueCents != null ? formatCents(a.projectValueCents) : "",
      rep: a.rep ?? "",
      pm: a.pm ?? "",
    },
    lead: {
      source: a.leadSource ?? "",
      createdDate: a.leadCreatedAt ? formatDate(a.leadCreatedAt) : "",
      status: a.leadStatus ? titleCase(a.leadStatus) : "",
    },
    company: {
      name: a.companyName,
      phone: a.companyPhone ?? "",
      email: a.companyEmail ?? "",
      website: a.companyWebsite ?? "",
      street: a.companyStreet ?? "",
      city: a.companyCity ?? "",
      state: a.companyState ?? "",
      zip: a.companyZip ?? "",
      full: companyFull,
      ein: a.companyEin ?? "",
    },
    today: formatDate(new Date()),
    permit: {
      ahj: a.permit?.ahjName ?? "",
      ahjContactName: a.permit?.ahjContactName ?? "",
      ahjContact: a.permit?.ahjContactInfo ?? "",
      number: a.permit?.permitNumber ?? "",
      // Falls back to the company's own contact: the installer answering an AHJ
      // is the company unless this particular job names someone else, and a
      // blank line on a permit form is what gets it sent back.
      installerContact: a.permit?.installerContact || a.companyEmail || a.companyPhone || "",
      installerTitle: a.permit?.installerTitle ?? "",
      notRequired: tick(a.permit?.permitNotRequired),
      ptoNotRequired: tick(a.permit?.ptoNotRequired),
      interconnectionNotRequired: tick(a.permit?.interconnectionNotRequired),
      otherUtilityStatus: tick(a.permit?.otherUtilityStatus),
      otherUtilityDetail: a.permit?.otherUtilityStatusDetail ?? "",
    },
    custom: a.custom ?? {},
  };
}

const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

export function fillTokens(template: string, ctx: AutofillContext): string {
  return template.replace(TOKEN_RE, (_m, path: string) => resolvePath(ctx, path) ?? "");
}

function resolvePath(ctx: AutofillContext, path: string): string | undefined {
  const parts = path.split(".");
  let cur: unknown = ctx;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return typeof cur === "string" ? cur : undefined;
}

// ---------------------------------------------------------------------------
// Field catalog (drives the template builder's "Map to CRM field" picker)
// ---------------------------------------------------------------------------

export type CatalogEntry = { token: string; label: string; group: string; sample: string };

/** Built-in mappable fields, grouped by entity. Custom fields are appended dynamically. */
export const BASE_CATALOG: CatalogEntry[] = [
  { group: "Customer", token: "{{customer.fullName}}", label: "Full name", sample: "Nancy Moore" },
  { group: "Customer", token: "{{customer.firstName}}", label: "First name", sample: "Nancy" },
  { group: "Customer", token: "{{customer.lastName}}", label: "Last name", sample: "Moore" },
  { group: "Customer", token: "{{customer.email}}", label: "Email", sample: "nancy@example.com" },
  { group: "Customer", token: "{{customer.phone}}", label: "Phone", sample: "(555) 123-4567" },
  { group: "Co-owner", token: "{{coOwner.fullName}}", label: "Full name", sample: "John Moore" },
  { group: "Co-owner", token: "{{coOwner.email}}", label: "Email", sample: "john@example.com" },
  { group: "Co-owner", token: "{{coOwner.phone}}", label: "Phone", sample: "(555) 987-6543" },
  { group: "Property", token: "{{property.street}}", label: "Street", sample: "107 Oak Street" },
  { group: "Property", token: "{{property.city}}", label: "City", sample: "Dallas" },
  { group: "Property", token: "{{property.state}}", label: "State", sample: "TX" },
  { group: "Property", token: "{{property.zip}}", label: "ZIP", sample: "75201" },
  { group: "Property", token: "{{property.full}}", label: "Full address", sample: "107 Oak Street, Dallas, TX, 75201" },
  { group: "Project", token: "{{project.number}}", label: "Project ID", sample: "AH-1004" },
  { group: "Project", token: "{{project.type}}", label: "Service type", sample: "Roofing" },
  { group: "Project", token: "{{project.stage}}", label: "Status / stage", sample: "In Production" },
  { group: "Project", token: "{{project.value}}", label: "Contract value", sample: "$23,000.00" },
  { group: "Project", token: "{{project.rep}}", label: "Sales rep", sample: "Tyler Brooks" },
  { group: "Project", token: "{{project.pm}}", label: "Project manager", sample: "Sofia Nguyen" },
  { group: "Lead", token: "{{lead.source}}", label: "Lead source", sample: "Referral" },
  { group: "Lead", token: "{{lead.createdDate}}", label: "Created date", sample: "Jun 4, 2026" },
  { group: "Lead", token: "{{lead.status}}", label: "Lead status", sample: "Open" },
  { group: "Company", token: "{{company.name}}", label: "Company name", sample: "Your Company" },
  { group: "Company", token: "{{company.phone}}", label: "Company phone", sample: "(866) 650-9996" },
  { group: "Company", token: "{{company.email}}", label: "Company email", sample: "office@example.com" },
  { group: "Company", token: "{{company.website}}", label: "Website", sample: "example.com" },
  { group: "Company", token: "{{company.street}}", label: "Street address", sample: "500 Main Street" },
  { group: "Company", token: "{{company.city}}", label: "City", sample: "Dallas" },
  { group: "Company", token: "{{company.state}}", label: "State", sample: "TX" },
  { group: "Company", token: "{{company.zip}}", label: "ZIP", sample: "75201" },
  { group: "Company", token: "{{company.full}}", label: "Full address", sample: "500 Main Street, Dallas, TX, 75201" },
  { group: "Company", token: "{{company.ein}}", label: "EIN / Tax ID", sample: "88-1234567" },
  { group: "Signer", token: "{{signer.name}}", label: "Signing for us — name", sample: "Mustafa Joulani" },
  { group: "Signer", token: "{{signer.title}}", label: "Signing for us — title", sample: "Owner" },
  { group: "Signer", token: "{{signer.license}}", label: "Signing for us — licence #", sample: "TX-12345" },
  { group: "Signer", token: "{{signer.date}}", label: "Signing for us — date signed", sample: formatDate(new Date()) },
  { group: "Signer", token: "{{signer.email}}", label: "Signing for us — email", sample: "owner@example.com" },
  { group: "Signer", token: "{{signer.phone}}", label: "Signing for us — phone", sample: "(555) 222-3344" },
  { group: "Permitting", token: "{{permit.ahj}}", label: "AHJ", sample: "City of Dallas" },
  { group: "Permitting", token: "{{permit.ahjContactName}}", label: "AHJ contact name", sample: "Dana Ruiz" },
  { group: "Permitting", token: "{{permit.ahjContact}}", label: "AHJ contact phone / email", sample: "(214) 555-0100" },
  { group: "Permitting", token: "{{permit.number}}", label: "Permit #", sample: "PMT-2026-4471" },
  { group: "Permitting", token: "{{permit.installerContact}}", label: "Installer contact for AHJ & PTO", sample: "office@example.com" },
  { group: "Permitting", token: "{{permit.installerTitle}}", label: "Installer title", sample: "Project Manager" },
  { group: "Permitting", token: "{{permit.notRequired}}", label: "Permit not required", sample: "Yes" },
  { group: "Permitting", token: "{{permit.ptoNotRequired}}", label: "PTO not required", sample: "Yes" },
  { group: "Permitting", token: "{{permit.interconnectionNotRequired}}", label: "Interconnection not required", sample: "Yes" },
  { group: "Permitting", token: "{{permit.otherUtilityStatus}}", label: "Other utility status", sample: "Yes" },
  { group: "Permitting", token: "{{permit.otherUtilityDetail}}", label: "Other utility status — detail", sample: "Awaiting meter swap" },
  { group: "Date", token: "{{today}}", label: "Today's date", sample: formatDate(new Date()) },
];

/**
 * Tokens that still resolve but are no longer offered.
 *
 * `{{customer.coOwner}}` predates the Co-owner group and is mapped on live
 * templates, so it keeps working — it just should not be a second way to pick
 * the same value on a new one. Kept out of the picker, kept in the label map,
 * so an existing field reads "Co-owner · Full name" rather than showing its raw
 * token as though the binding were broken.
 */
const ALIAS_CATALOG: CatalogEntry[] = [
  { group: "Co-owner", token: "{{customer.coOwner}}", label: "Full name", sample: "John Moore" },
];

/**
 * Full catalog = built-ins + this signer's credential lines + this company's
 * custom fields, so both kinds of user-defined field appear without a code
 * change.
 *
 * Credentials come from EVERY signer, de-duplicated by key: a template is
 * authored once and may be signed by any of them, so the picker has to offer
 * the union. Two signers with a "TDLR #" line share one token and each fills it
 * with their own number.
 */
export function buildFieldCatalog(
  customDefs: { key: string; label: string; entity: string }[],
  signerCredentials: { key: string; label: string }[] = []
): CatalogEntry[] {
  const seen = new Set<string>();
  const creds: CatalogEntry[] = [];
  for (const c of signerCredentials) {
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    creds.push({ group: "Signer", token: `{{signer.cred.${c.key}}}`, label: c.label, sample: "—" });
  }
  const custom = customDefs.map((d) => ({
    group: "Custom fields",
    token: `{{custom.${d.key}}}`,
    label: `${d.label} (${titleCase(d.entity)})`,
    sample: "—",
  }));
  return [...BASE_CATALOG, ...creds, ...custom];
}

/** Map of token -> friendly label, for showing bindings on placed fields. */
export function catalogLabelMap(catalog: CatalogEntry[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const e of [...catalog, ...ALIAS_CATALOG]) m[e.token] = `${e.group} · ${e.label}`;
  return m;
}
