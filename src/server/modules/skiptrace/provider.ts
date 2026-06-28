// Homeowner skip-trace adapter. One interface, swappable providers via env so we
// can change data sources without touching the UI or the calling code — mirrors
// the property-value provider.
//
// Provider selection:  SKIP_TRACE_PROVIDER = batchdata | fixture | none
// API key (real ones):  SKIP_TRACE_API_KEY
//
// TruePeopleSearch has no API and blocks automation, so we use a sanctioned
// skip-trace API. BatchData is the default real provider: address → owner name(s),
// phone number(s), and email(s). With no key/provider configured we return null
// ("owner lookup unavailable") — we never invent contact data.
//
// `fixture` is an OFFLINE deterministic provider used ONLY by the E2E suite. It is
// never the default and its data is clearly fake.

export type OwnerResult = {
  names: string[]; // owner full name(s), most-likely first
  phones: string[]; // phone numbers, most-likely first
  emails: string[]; // emails, most-likely first
  source: string; // human label shown in the UI ("BatchData", "Test Fixture")
  asOfDate: string; // ISO date the lookup ran
};

export type SkipTraceQuery = {
  address: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

export interface SkipTraceProvider {
  readonly name: string;
  lookup(q: SkipTraceQuery): Promise<OwnerResult | null>;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

function uniqNonEmpty(values: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const s = (v ?? "").trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// --- BatchData (api.batchdata.com) — property skip trace --------------------
// Docs: POST /api/v1/property/skip-trace with a `requests[].propertyAddress`.
// Response shape varies slightly by account, so parsing is defensive.
class BatchDataProvider implements SkipTraceProvider {
  readonly name = "BatchData";
  constructor(private key: string) {}

  async lookup(q: SkipTraceQuery): Promise<OwnerResult | null> {
    try {
      const res = await fetch("https://api.batchdata.com/api/v1/property/skip-trace", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.key}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          requests: [
            { propertyAddress: { street: q.address, city: q.city ?? "", state: q.state ?? "", zip: q.zip ?? "" } },
          ],
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as unknown;
      return parseBatchData(json);
    } catch {
      return null;
    }
  }
}

/** Pull owner names / phones / emails out of BatchData's response, defensively.
 *  Exported for unit testing against representative payloads. */
export function parseBatchData(json: unknown): OwnerResult | null {
  const root = (json ?? {}) as Record<string, unknown>;
  const results = (root.results ?? root.data ?? root) as Record<string, unknown>;
  // Persons can live under results.persons, results.meta..., or per-request.
  const persons: unknown[] =
    (results.persons as unknown[]) ??
    ((results.output as Record<string, unknown>)?.persons as unknown[]) ??
    (Array.isArray((root as Record<string, unknown>).persons) ? ((root as Record<string, unknown>).persons as unknown[]) : []) ??
    [];

  const names: string[] = [];
  const phones: string[] = [];
  const emails: string[] = [];

  for (const p of Array.isArray(persons) ? persons : []) {
    const person = (p ?? {}) as Record<string, unknown>;
    const nameObj = (person.name ?? {}) as Record<string, unknown>;
    const full =
      (typeof nameObj.full === "string" && nameObj.full) ||
      [nameObj.first, nameObj.middle, nameObj.last].filter((x) => typeof x === "string" && x).join(" ") ||
      (typeof person.fullName === "string" ? person.fullName : "");
    if (full) names.push(String(full));

    const phoneArr = (person.phoneNumbers ?? person.phones ?? []) as unknown[];
    for (const ph of Array.isArray(phoneArr) ? phoneArr : []) {
      const o = (ph ?? {}) as Record<string, unknown>;
      const num = (typeof o.number === "string" && o.number) || (typeof ph === "string" ? ph : "");
      if (num) phones.push(String(num));
    }

    const emailArr = (person.emails ?? person.emailAddresses ?? []) as unknown[];
    for (const em of Array.isArray(emailArr) ? emailArr : []) {
      const o = (em ?? {}) as Record<string, unknown>;
      const addr = (typeof o.email === "string" && o.email) || (typeof em === "string" ? em : "");
      if (addr) emails.push(String(addr));
    }
  }

  const out: OwnerResult = {
    names: uniqNonEmpty(names),
    phones: uniqNonEmpty(phones),
    emails: uniqNonEmpty(emails),
    source: "BatchData",
    asOfDate: todayISO(),
  };
  if (!out.names.length && !out.phones.length && !out.emails.length) return null;
  return out;
}

// --- Fixture (E2E only) -----------------------------------------------------
class FixtureProvider implements SkipTraceProvider {
  readonly name = "Test Fixture";
  async lookup(q: SkipTraceQuery): Promise<OwnerResult | null> {
    // Deterministic, obviously-fake data derived from the address.
    const tag = (q.address || "home").replace(/[^a-z0-9]/gi, "").slice(0, 6) || "home";
    return {
      names: [`Owner ${tag}`],
      phones: ["(555) 010-1234", "(555) 010-5678"],
      emails: [`owner.${tag.toLowerCase()}@example.com`],
      source: "Test Fixture",
      asOfDate: todayISO(),
    };
  }
}

// --- None (no key / not configured) -----------------------------------------
class NoneProvider implements SkipTraceProvider {
  readonly name = "Unavailable";
  async lookup(): Promise<OwnerResult | null> {
    return null;
  }
}

let cached: SkipTraceProvider | null = null;

export function getSkipTraceProvider(): SkipTraceProvider {
  if (cached) return cached;
  const which = (process.env.SKIP_TRACE_PROVIDER ?? "").toLowerCase();
  const key = process.env.SKIP_TRACE_API_KEY ?? "";
  if (which === "batchdata" && key) cached = new BatchDataProvider(key);
  else if (which === "fixture") cached = new FixtureProvider();
  else cached = new NoneProvider(); // no key / unknown → honest "unavailable"
  return cached;
}

/** True when a real skip-trace provider is configured (drives whether the UI shows the button). */
export function skipTraceEnabled(): boolean {
  return getSkipTraceProvider().name !== "Unavailable";
}
