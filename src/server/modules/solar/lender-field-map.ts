import type { AmosApplicationPayload } from "./amos-payload";

/**
 * MAPPING A PARTNER'S FIELDS BY HAND.
 *
 * The Submission tab publishes what every field on the wire is fed from, and
 * five of those rows are settings because more than one figure is true and only
 * the partner knows which. The rest were stated as fixed — right in the sense
 * that each has one obvious source, and useless the first time a partner wants
 * something else in a box we had decided the answer to.
 *
 * So: an admin may point any of the fields below at a different value, or at a
 * constant they type. No deploy, no migration, no code.
 *
 * WHAT IS DELIBERATELY NOT MAPPABLE, and it is a short list:
 *
 *   requestedAmount        the loan amount. Its three true readings are the
 *                          amount-basis setting, which is a choice between
 *                          FIGURES THE DOCUMENT COMPUTED. A free-typed constant
 *                          here is a fabricated credit application on every
 *                          deal, and nothing legitimate needs it.
 *   estMonthly/AnnualSaving  same, via the saving basis and horizon.
 *   salesRepName           already three choices, one of which is a typed name.
 *   equipment brand/model  the Equipment tab maps these per item, against that
 *                          partner's approved-vendor list, which is where the
 *                          matching actually has to happen.
 *   delivery               whose device the household finishes on, which is
 *                          already the setting above and has two answers.
 *
 * NOT MAPPABLE IS NOT THE SAME AS NOT SENT, and the screen used to say the
 * second by omission: it listed only the boxes below and called that the
 * application, so eleven fields the partner really does receive were nowhere on
 * it. They are in `STATED_FIELDS` and render as ordinary rows with no picker.
 *
 * Everything else is here. A row that names a source this build does not know
 * FALLS BACK to the built-in one rather than sending nothing — same rule the
 * basis resolvers follow, and for the same reason: a column outlives the code.
 */

/** What shape a box takes, and therefore what may be put in it. */
export type FieldKind = "string" | "number" | "boolean" | "rate";

/** Everything a mapping can read, assembled once per submission. */
export type FieldMapContext = {
  lead: {
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  };
  /** Already resolved through the partner's rep-name setting. */
  repName: string;
  submitterName: string | null;
  companyName: string;
  design: {
    id: string;
    reference: string;
    systemSizeKwDc: number;
    moduleQty: number;
    inverterQty: number;
    batteryQty: number;
  };
  productSlug: string;
  ownerOccupied: boolean;
  system: {
    annualProductionKwh: number;
    annualConsumptionKwh: number;
    /** Tenths of a cent, the snapshot's own unit. One conversion, at the end. */
    retailRateMillsPerKwh: number;
  };
  termMonths: number;
};

type Resolved = string | number | boolean | null;

export type FieldSource = {
  key: string;
  label: string;
  /** How the picker groups them. */
  group: string;
  kind: FieldKind;
  /** Null means "this deal cannot answer", and the built-in source stands. */
  resolve: (c: FieldMapContext) => Resolved;
};

const digits = (s: string | null) => (s ?? "").replace(/[\s()\-.]/g, "");
const text = (s: string | null) => (s ?? "").trim();

/**
 * EVERY ANEXA VALUE A FIELD MAY BE POINTED AT.
 *
 * A whitelist, not a path expression. Somebody typing `lead.ssn` into a mapping
 * box is the failure this shape makes impossible: what is not on this list
 * cannot cross the wire, so the promise under the table — no social security
 * number, no date of birth, no consent flag — survives the feature that lets an
 * admin change the mapping.
 */
export const FIELD_SOURCES: FieldSource[] = [
  // ── The household ──────────────────────────────────────────────────────
  { key: "lead.firstName", label: "First name", group: "The customer", kind: "string", resolve: (c) => text(c.lead.firstName) },
  { key: "lead.lastName", label: "Last name", group: "The customer", kind: "string", resolve: (c) => text(c.lead.lastName) },
  {
    key: "lead.fullName",
    label: "Full name",
    group: "The customer",
    kind: "string",
    resolve: (c) => `${text(c.lead.firstName)} ${text(c.lead.lastName)}`.trim(),
  },
  { key: "lead.email", label: "Email address", group: "The customer", kind: "string", resolve: (c) => text(c.lead.email).toLowerCase() },
  { key: "lead.phone", label: "Telephone, digits only", group: "The customer", kind: "string", resolve: (c) => digits(c.lead.phone) },

  // ── The property ───────────────────────────────────────────────────────
  { key: "property.line1", label: "Street address", group: "The property", kind: "string", resolve: (c) => text(c.lead.address) },
  { key: "property.city", label: "City", group: "The property", kind: "string", resolve: (c) => text(c.lead.city) },
  { key: "property.state", label: "State, upper case", group: "The property", kind: "string", resolve: (c) => text(c.lead.state).toUpperCase() },
  { key: "property.postalCode", label: "ZIP code", group: "The property", kind: "string", resolve: (c) => text(c.lead.zip) },
  {
    key: "property.oneLine",
    label: "The whole address on one line",
    group: "The property",
    kind: "string",
    resolve: (c) =>
      [text(c.lead.address), text(c.lead.city), `${text(c.lead.state).toUpperCase()} ${text(c.lead.zip)}`.trim()]
        .filter((p) => p.length > 0)
        .join(", "),
  },
  { key: "deal.ownerOccupied", label: "The occupancy answer given at send", group: "The property", kind: "boolean", resolve: (c) => c.ownerOccupied },

  // ── People ─────────────────────────────────────────────────────────────
  { key: "people.dealRep", label: "The seller, as this partner's name setting resolves it", group: "People", kind: "string", resolve: (c) => c.repName },
  { key: "people.submitter", label: "Whoever pressed the button", group: "People", kind: "string", resolve: (c) => (c.submitterName ?? "").trim() || null },
  { key: "company.name", label: "This company's name", group: "People", kind: "string", resolve: (c) => text(c.companyName) },

  // ── The reference ──────────────────────────────────────────────────────
  { key: "design.reference", label: "The submission reference", group: "The reference", kind: "string", resolve: (c) => c.design.reference },
  { key: "design.id", label: "The design's id, without any retry suffix", group: "The reference", kind: "string", resolve: (c) => c.design.id },
  { key: "lender.productSlug", label: "This partner's product", group: "The reference", kind: "string", resolve: (c) => text(c.productSlug) },

  // ── The system ─────────────────────────────────────────────────────────
  { key: "system.panelCount", label: "Panels on the drawing", group: "The system", kind: "number", resolve: (c) => c.design.moduleQty },
  { key: "system.inverterCount", label: "Inverters, from array watts ÷ rated watts", group: "The system", kind: "number", resolve: (c) => c.design.inverterQty },
  { key: "system.batteryCount", label: "Batteries on the design", group: "The system", kind: "number", resolve: (c) => c.design.batteryQty },
  { key: "system.sizeKwDc", label: "System size, kW DC", group: "The system", kind: "number", resolve: (c) => c.design.systemSizeKwDc },
  { key: "system.sizeWattsDc", label: "System size, watts DC", group: "The system", kind: "number", resolve: (c) => Math.round(c.design.systemSizeKwDc * 1000) },
  { key: "system.annualProductionKwh", label: "Year-one production the proposal quotes", group: "The system", kind: "number", resolve: (c) => c.system.annualProductionKwh },
  { key: "system.annualConsumptionKwh", label: "Annual usage the proposal quotes", group: "The system", kind: "number", resolve: (c) => c.system.annualConsumptionKwh },
  { key: "system.retailRate", label: "The utility rate the proposal was priced at", group: "The system", kind: "rate", resolve: (c) => c.system.retailRateMillsPerKwh },

  // ── Financing ──────────────────────────────────────────────────────────
  { key: "finance.termMonths", label: "The proposal's loan term, in months", group: "Financing", kind: "number", resolve: (c) => c.termMonths },
  { key: "finance.termYears", label: "The proposal's loan term, in whole years", group: "Financing", kind: "number", resolve: (c) => Math.round(c.termMonths / 12) },
];

const SOURCE_BY_KEY = new Map(FIELD_SOURCES.map((s) => [s.key, s]));

/** One box on the partner's application that an admin may re-point. */
export type WireField = {
  /** The partner's own path, and the id this mapping is stored under. */
  field: string;
  kind: FieldKind;
  /** The source used when nobody has mapped it — today's behaviour, exactly. */
  defaultSource: string;
  /** Which deal screen owns the default's value, for the table's third column. */
  changedOn: string;
  /**
   * Whether an empty result blocks the submission. The lender rejects the whole
   * application over a blank required box, so a mapping that resolves to
   * nothing must not quietly produce one — see `mappingProblems`.
   */
  required: boolean;
  /** The deal-preflight message this field's own check produces, if any. */
  preflightsOn?: "email" | "phone" | "address" | "city" | "state" | "zip";
};

export const WIRE_FIELDS: WireField[] = [
  { field: "applicant.firstName", kind: "string", defaultSource: "lead.firstName", changedOn: "the deal", required: true },
  { field: "applicant.lastName", kind: "string", defaultSource: "lead.lastName", changedOn: "the deal", required: true },
  { field: "applicant.email", kind: "string", defaultSource: "lead.email", changedOn: "the deal", required: true, preflightsOn: "email" },
  { field: "applicant.phone", kind: "string", defaultSource: "lead.phone", changedOn: "the deal", required: true, preflightsOn: "phone" },
  { field: "property.line1", kind: "string", defaultSource: "property.line1", changedOn: "the deal", required: true, preflightsOn: "address" },
  { field: "property.city", kind: "string", defaultSource: "property.city", changedOn: "the deal", required: true, preflightsOn: "city" },
  { field: "property.state", kind: "string", defaultSource: "property.state", changedOn: "the deal", required: true, preflightsOn: "state" },
  { field: "property.postalCode", kind: "string", defaultSource: "property.postalCode", changedOn: "the deal", required: true, preflightsOn: "zip" },
  { field: "property.ownerOccupied", kind: "boolean", defaultSource: "deal.ownerOccupied", changedOn: "the send dialog", required: true },
  { field: "productSlug", kind: "string", defaultSource: "lender.productSlug", changedOn: "Details → Direct submission", required: true },
  { field: "externalId", kind: "string", defaultSource: "design.reference", changedOn: "“Start a new reference”", required: true },
  { field: "termMonths", kind: "number", defaultSource: "finance.termMonths", changedOn: "Financing, then regenerate", required: true },
  { field: "system.annualProductionKwh", kind: "number", defaultSource: "system.annualProductionKwh", changedOn: "the designer, then regenerate", required: true },
  { field: "system.annualConsumptionKwh", kind: "number", defaultSource: "system.annualConsumptionKwh", changedOn: "Energy, then regenerate", required: true },
  { field: "system.retailRatePerKwh", kind: "rate", defaultSource: "system.retailRate", changedOn: "Energy, then regenerate", required: true },
  { field: "equipment.panel.quantity", kind: "number", defaultSource: "system.panelCount", changedOn: "the designer", required: false },
  { field: "equipment.inverter.quantity", kind: "number", defaultSource: "system.inverterCount", changedOn: "Solar Equipment → Rated W", required: false },
  { field: "equipment.battery.quantity", kind: "number", defaultSource: "system.batteryCount", changedOn: "the designer", required: false },
];

/**
 * THE FIELDS THAT CROSS THE WIRE WITH NO BOX ON THIS SCREEN.
 *
 * Listed anyway, and that is the whole point of them. The table held only the
 * mappable rows while calling itself the application, so an admin looking for
 * the panel brand — or the loan amount, or the saving — found nothing there and
 * had no way to tell whether we send it at all. ELEVEN of the wire's fields
 * were invisible. A field nobody may re-point is still a field the partner
 * receives.
 *
 * They carry no picker for the reasons in this module's header, which is the
 * distinction the screen has to make: not "we don't send this" but "this is
 * decided somewhere a constant cannot fabricate it".
 *
 * `setting` marks the ones a panel on this same tab decides; the rest belong to
 * another screen, and `changedOn` names it either way.
 */
export type StatedField = {
  /** The partner's own path, spelled as `WIRE_FIELDS` spells its own. */
  field: string;
  /** What fills it, in the words the third column of that table uses. */
  fedFrom: string;
  /** Where somebody goes to change it. */
  changedOn: string;
  /** True where a panel above decides it, and `changedOn` names that panel. */
  setting?: boolean;
};

export const STATED_FIELDS: StatedField[] = [
  {
    field: "system.estAnnualSaving",
    fedFrom: "The saving the proposal works out, on the basis and horizon chosen above",
    changedOn: "\u201CWhat they mean by a saving\u201D",
    setting: true,
  },
  {
    field: "system.estMonthlySaving",
    fedFrom: "The annual figure \u00F7 12, rounded once so the two agree",
    changedOn: "\u201CWhat they mean by a saving\u201D",
    setting: true,
  },
  {
    field: "equipment.panel.brand",
    fedFrom: "This partner's own name for the panel, or ours where nobody has mapped it",
    changedOn: "the Equipment tab",
  },
  {
    field: "equipment.panel.model",
    fedFrom: "This partner's own model for the panel, or ours where nobody has mapped it",
    changedOn: "the Equipment tab",
  },
  {
    field: "equipment.inverter.brand",
    fedFrom: "This partner's own name for the inverter, or ours where nobody has mapped it",
    changedOn: "the Equipment tab",
  },
  {
    field: "equipment.inverter.model",
    fedFrom: "This partner's own model for the inverter, or ours where nobody has mapped it",
    changedOn: "the Equipment tab",
  },
  {
    field: "equipment.battery.brand",
    fedFrom: "This partner's own name for the battery, or ours where nobody has mapped it",
    changedOn: "the Equipment tab",
  },
  {
    field: "equipment.battery.model",
    fedFrom: "This partner's own model for the battery, or ours where nobody has mapped it",
    changedOn: "the Equipment tab",
  },
  {
    field: "requestedAmount",
    fedFrom: "The figure the proposal quotes, on the basis chosen above",
    changedOn: "\u201CThe amount they are asked to fund\u201D",
    setting: true,
  },
  {
    field: "salesRepName",
    fedFrom: "The seller chosen above",
    changedOn: "\u201CWhose name goes on it\u201D",
    setting: true,
  },
  {
    field: "delivery",
    fedFrom: "Whose device the household finishes on, chosen above",
    changedOn: "\u201CWho completes the application\u201D",
    setting: true,
  },
];

/**
 * THE ORDER THE REQUEST BODY CARRIES THEM, which is the order to read them in.
 *
 * `WIRE_FIELDS` is ordered for the server's convenience and `STATED_FIELDS` is
 * a second list entirely, so neither one is a reading of the application. This
 * is: the same walk as `buildAmosPayload`, so a body printed beside this screen
 * lines up row for row.
 *
 * A NAME MISSING FROM HERE IS STILL RENDERED, at the end — see `wireInventory`.
 * Ordering is a nicety; a field silently disappearing off the screen is the
 * defect this whole inventory exists to stop, and a third list to keep in sync
 * must not be able to cause it.
 */
const WIRE_ORDER: string[] = [
  "externalId",
  "productSlug",
  "applicant.firstName",
  "applicant.lastName",
  "applicant.email",
  "applicant.phone",
  "property.line1",
  "property.city",
  "property.state",
  "property.postalCode",
  "property.ownerOccupied",
  "system.annualProductionKwh",
  "system.annualConsumptionKwh",
  "system.retailRatePerKwh",
  "system.estMonthlySaving",
  "system.estAnnualSaving",
  "equipment.panel.brand",
  "equipment.panel.model",
  "equipment.panel.quantity",
  "equipment.inverter.brand",
  "equipment.inverter.model",
  "equipment.inverter.quantity",
  "equipment.battery.brand",
  "equipment.battery.model",
  "equipment.battery.quantity",
  "requestedAmount",
  "termMonths",
  "salesRepName",
  "delivery",
];

/** One line of the application: a box to re-point, or a figure decided elsewhere. */
export type InventoryRow =
  | { field: string; mapped: WireField; stated?: undefined }
  | { field: string; mapped?: undefined; stated: StatedField };

/**
 * EVERY FIELD ON THE WIRE, mappable or not, in body order.
 *
 * Anything neither list knows about cannot appear, and anything `WIRE_ORDER`
 * has not been told about appears at the end rather than not at all.
 */
export function wireInventory(): InventoryRow[] {
  const mapped = new Map(WIRE_FIELDS.map((f) => [f.field, f]));
  const stated = new Map(STATED_FIELDS.map((f) => [f.field, f]));

  const rows: InventoryRow[] = [];
  const seen = new Set<string>();
  const take = (name: string) => {
    if (seen.has(name)) return;
    const m = mapped.get(name);
    if (m) {
      seen.add(name);
      rows.push({ field: name, mapped: m });
      return;
    }
    const s = stated.get(name);
    if (s) {
      seen.add(name);
      rows.push({ field: name, stated: s });
    }
  };

  for (const name of WIRE_ORDER) take(name);
  // The safety net: a field added to either list and forgotten here still shows.
  for (const f of WIRE_FIELDS) take(f.field);
  for (const f of STATED_FIELDS) take(f.field);

  return rows;
}

const FIELD_BY_NAME = new Map(WIRE_FIELDS.map((f) => [f.field, f]));

/** The sources that may legally fill a given box. */
export function sourcesFor(kind: FieldKind): FieldSource[] {
  return FIELD_SOURCES.filter((s) => s.kind === kind);
}

/** One stored override. `literal` wins when set; otherwise `sourceKey` does. */
export type FieldMapEntry = {
  wireField: string;
  sourceKey: string | null;
  literal: string | null;
};

/**
 * A typed constant out of the box an admin typed in.
 *
 * Returns null for anything it cannot read, and null means the mapping is
 * ignored and the built-in source stands. Never a zero, never an empty string:
 * those are values somebody meant, and a typo must not become one.
 */
export function parseLiteral(raw: string, kind: FieldKind): Resolved {
  const t = raw.trim();
  if (t === "") return null;

  if (kind === "boolean") {
    if (/^(true|yes|y|1)$/i.test(t)) return true;
    if (/^(false|no|n|0)$/i.test(t)) return false;
    return null;
  }
  if (kind === "number") {
    const n = Number(t.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  if (kind === "rate") {
    // Typed in DOLLARS per kWh, the way the customer's document prints it, and
    // held as mills so the single conversion in `buildAmosPayload` stays the
    // only one. $0.01 to $2.00 rejects both the misplaced decimal points.
    const n = Number(t.replace(/^\$/, ""));
    if (!Number.isFinite(n) || n < 0.01 || n > 2) return null;
    return Math.round(n * 1000);
  }
  return t;
}

/** What a mapping resolves to, or null when the built-in source should stand. */
function valueFor(entry: FieldMapEntry, def: WireField, c: FieldMapContext): Resolved {
  if (entry.literal != null && entry.literal.trim() !== "") {
    return parseLiteral(entry.literal, def.kind);
  }
  const source = entry.sourceKey ? SOURCE_BY_KEY.get(entry.sourceKey) : undefined;
  // A source this build does not know, or one of the wrong shape for the box,
  // is not a reason to send nothing — the built-in one stands.
  if (!source || source.kind !== def.kind) return null;
  const v = source.resolve(c);
  if (v == null) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  return v;
}

/**
 * THE MAPPING, APPLIED TO A BUILT PAYLOAD.
 *
 * Deliberately a pass OVER the finished body rather than a rewrite of
 * `buildAmosPayload`. That function is pure, exhaustively tested and is what
 * every unmapped partner — which is all of them until somebody changes one —
 * still goes through unaltered. An override that resolves to nothing leaves
 * what that builder produced exactly where it was.
 */
export function applyFieldMap(
  payload: AmosApplicationPayload,
  entries: FieldMapEntry[],
  c: FieldMapContext,
): AmosApplicationPayload {
  if (entries.length === 0) return payload;

  const next: AmosApplicationPayload = {
    ...payload,
    applicant: { ...payload.applicant },
    property: { ...payload.property },
    system: { ...payload.system },
    ...(payload.equipment ? { equipment: payload.equipment.map((l) => ({ ...l })) } : {}),
  };

  for (const entry of entries) {
    const def = FIELD_BY_NAME.get(entry.wireField);
    if (!def) continue;
    const v = valueFor(entry, def, c);
    if (v == null) continue;
    write(next, def, v);
  }

  return next;
}

/** Put one resolved value in its box. Explicit, so no path string can miss. */
function write(p: AmosApplicationPayload, def: WireField, v: Resolved) {
  const s = () => String(v);
  const n = () => Math.round(Number(v));

  switch (def.field) {
    case "applicant.firstName": p.applicant.firstName = s(); return;
    case "applicant.lastName": p.applicant.lastName = s(); return;
    case "applicant.email": p.applicant.email = s(); return;
    case "applicant.phone": p.applicant.phone = s(); return;
    case "property.line1": p.property.line1 = s(); return;
    case "property.city": p.property.city = s(); return;
    case "property.state": p.property.state = s(); return;
    case "property.postalCode": p.property.postalCode = s(); return;
    case "property.ownerOccupied": p.property.ownerOccupied = v === true; return;
    case "productSlug": p.productSlug = s(); return;
    case "externalId": p.externalId = s(); return;
    case "termMonths": p.termMonths = n(); return;
    case "system.annualProductionKwh": p.system.annualProductionKwh = n(); return;
    case "system.annualConsumptionKwh": p.system.annualConsumptionKwh = n(); return;
    // Mills in, dollars out, with the same three decimals the document prints.
    case "system.retailRatePerKwh": p.system.retailRatePerKwh = (n() / 1000).toFixed(3); return;
    case "equipment.panel.quantity": setQty(p, "panel", n()); return;
    case "equipment.inverter.quantity": setQty(p, "inverter", n()); return;
    case "equipment.battery.quantity": setQty(p, "battery", n()); return;
  }
}

/**
 * A quantity on a line that is actually being sent.
 *
 * A design with no battery on it has no battery line, and a mapping must not
 * invent one: the lender matches the item against its approved-vendor list, and
 * a line with a quantity and no name it recognises is a 422. Under one is
 * dropped for the same reason — that is how `line()` itself reads a zero.
 */
function setQty(p: AmosApplicationPayload, kind: "panel" | "inverter" | "battery", qty: number) {
  if (!p.equipment) return;
  const line = p.equipment.find((l) => l.kind === kind);
  if (!line) return;
  if (qty < 1) {
    p.equipment = p.equipment.filter((l) => l.kind !== kind);
    return;
  }
  line.quantity = qty;
}

/**
 * WHICH DEAL-LEVEL CHECKS THIS MAPPING HAS TAKEN OVER.
 *
 * The preflight refuses a deal whose customer has no email, because that box is
 * fed from the lead. Once an admin has pointed it somewhere else, the lead's
 * own email stops being the question — and a rep should not be sent to fill in
 * a field the partner is no longer told about. Only overrides that actually
 * RESOLVE count: a mapping that comes out empty leaves the original check, and
 * therefore the original blocker, exactly where it was.
 */
export function suppliedByMapping(entries: FieldMapEntry[], c: FieldMapContext): Set<string> {
  const supplied = new Set<string>();
  for (const entry of entries) {
    const def = FIELD_BY_NAME.get(entry.wireField);
    if (!def?.preflightsOn) continue;
    if (valueFor(entry, def, c) != null) supplied.add(def.preflightsOn);
  }
  return supplied;
}

/**
 * A MAPPING THAT WILL PRODUCE AN EMPTY REQUIRED BOX, said before it is sent.
 *
 * The failure this prevents: an admin points `applicant.email` at a source that
 * is null on this deal, the override is ignored, the built-in source is empty
 * too, and the partner refuses the whole application over a blank field with a
 * message nobody here can act on. Caught on the rep's screen instead.
 */
export function mappingProblems(entries: FieldMapEntry[], c: FieldMapContext): string[] {
  const problems: string[] = [];
  for (const entry of entries) {
    const def = FIELD_BY_NAME.get(entry.wireField);
    if (!def || !def.required) continue;
    if (entry.literal != null && entry.literal.trim() !== "" && parseLiteral(entry.literal, def.kind) == null) {
      problems.push(
        `The mapping for “${def.field}” has a constant this build cannot read as ${describeKind(def.kind)}: “${entry.literal.trim()}”. ` +
          `Fix it in Settings → Lenders → Submission.`,
      );
    }
  }
  return problems;
}

function describeKind(kind: FieldKind): string {
  if (kind === "number") return "a number";
  if (kind === "boolean") return "yes or no";
  if (kind === "rate") return "a rate between $0.01 and $2.00 per kWh";
  return "text";
}
