import { formatCents, formatDate } from "@/lib/format";

/** Resolved values for every mappable token, for a specific lead/project record. */
export type AutofillContext = {
  customer: { fullName: string; firstName: string; lastName: string; email: string; phone: string };
  property: { street: string; city: string; state: string; zip: string; full: string };
  // `address` kept as an alias of property.full for backward-compatible templates.
  project: { number: string; address: string; type: string; stage: string; value: string; rep: string; pm: string };
  lead: { source: string; createdDate: string; status: string };
  company: { name: string; phone: string };
  today: string;
  custom: Record<string, string>;
};

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function buildAutofillContext(a: {
  firstName: string;
  lastName: string;
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
  custom?: Record<string, string>;
}): AutofillContext {
  const full = [a.street, [a.city, a.state, a.zip].filter(Boolean).join(", ")].filter(Boolean).join(", ");
  return {
    customer: {
      fullName: `${a.firstName} ${a.lastName}`.trim(),
      firstName: a.firstName,
      lastName: a.lastName,
      email: a.email ?? "",
      phone: a.phone ?? "",
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
    company: { name: a.companyName, phone: a.companyPhone ?? "" },
    today: formatDate(new Date()),
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
  { group: "Date", token: "{{today}}", label: "Today's date", sample: formatDate(new Date()) },
];

/** Full catalog = built-ins + this company's custom fields (so new fields appear automatically). */
export function buildFieldCatalog(
  customDefs: { key: string; label: string; entity: string }[]
): CatalogEntry[] {
  const custom = customDefs.map((d) => ({
    group: "Custom fields",
    token: `{{custom.${d.key}}}`,
    label: `${d.label} (${titleCase(d.entity)})`,
    sample: "—",
  }));
  return [...BASE_CATALOG, ...custom];
}

/** Map of token -> friendly label, for showing bindings on placed fields. */
export function catalogLabelMap(catalog: CatalogEntry[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const e of catalog) m[e.token] = `${e.group} · ${e.label}`;
  return m;
}
