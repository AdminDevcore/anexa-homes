// Property value (AVM) adapter. One interface, swappable providers via env so we
// can change data sources without touching the UI or the calling code.
//
// Provider selection:  PROPERTY_VALUE_PROVIDER = rentcast | estated | attom | fixture | none
// API key (real ones): PROPERTY_VALUE_API_KEY
//
// Zillow has no public Zestimate API, so we use sanctioned AVMs. RentCast is the
// default real provider: it returns an AVM value + range plus full property
// records (last sale, assessed value, beds/baths/sqft/year-built) for honest,
// source-attributed estimates. With no key/provider configured we return null
// ("Estimate unavailable / unverified") — we never invent a number.
//
// `fixture` is an OFFLINE deterministic provider used ONLY by the E2E suite
// (set via the test web-server env). It is never the default and is clearly
// labeled "Test Fixture" so it can't be mistaken for real data.

export type Confidence = "high" | "medium" | "low" | null;

export type PropertyEstimate = {
  value: number | null; // estimated market value, CENTS (null = no estimate)
  low: number | null; // value range low, cents
  high: number | null; // value range high, cents
  confidence: Confidence;
  matched: boolean; // did we confidently match a real parcel?
  source: string; // human label shown in the UI
  asOfDate: string; // ISO date the estimate is "as of"
  formattedAddress: string | null; // the parcel address the provider matched
  lastSalePrice: number | null; // cents
  lastSaleDate: string | null; // ISO date
  assessedValue: number | null; // cents
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  yearBuilt: number | null;
};

export type PropertyQuery = {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  lat?: number | null;
  lng?: number | null;
};

export interface PropertyValueProvider {
  readonly name: string;
  /** Whether this provider keys off a street address (caller should geocode first). */
  readonly needsAddress: boolean;
  getEstimate(q: PropertyQuery): Promise<PropertyEstimate | null>;
}

const dollarsToCents = (d: number | null | undefined): number | null =>
  d == null || Number.isNaN(d) ? null : Math.round(d * 100);
const todayISO = () => new Date().toISOString().slice(0, 10);

export function fullAddress(q: PropertyQuery): string | null {
  const line = [q.address, q.city, q.state, q.zip].filter(Boolean).join(", ");
  return line || null;
}

// House number + first street token, lowercased — used to sanity-check that the
// provider matched the parcel we asked for (the #1 source of wrong values).
function streetSignature(addr: string | null | undefined): string | null {
  if (!addr) return null;
  const m = addr.trim().toLowerCase().match(/^(\d+)\s+([a-z0-9]+)/);
  return m ? `${m[1]} ${m[2]}` : null;
}

function confidenceFromRange(value: number | null, low: number | null, high: number | null): Confidence {
  if (!value || low == null || high == null) return value ? "low" : null;
  const spread = (high - low) / value;
  if (spread <= 0.15) return "high";
  if (spread <= 0.3) return "medium";
  return "low";
}

// --- RentCast (default real provider) --------------------------------------
// Docs: https://developers.rentcast.io
//   GET /v1/avm/value?address=...     -> price, priceRangeLow, priceRangeHigh
//   GET /v1/properties?address=...    -> record: beds/baths/sqft/yearBuilt,
//                                        lastSalePrice/Date, taxAssessments
class RentCastProvider implements PropertyValueProvider {
  readonly name = "RentCast";
  readonly needsAddress = true;
  constructor(private apiKey: string) {}

  private async get(path: string): Promise<unknown | null> {
    const res = await fetch(`https://api.rentcast.io/v1${path}`, {
      headers: { "X-Api-Key": this.apiKey, Accept: "application/json" },
      next: { revalidate: 60 * 60 * 24 * 7 },
    });
    if (!res.ok) return null;
    return res.json().catch(() => null);
  }

  async getEstimate(q: PropertyQuery): Promise<PropertyEstimate | null> {
    const address = fullAddress(q);
    if (!address) return null;
    const enc = encodeURIComponent(address);

    const [avmRaw, propsRaw] = await Promise.all([
      this.get(`/avm/value?address=${enc}`),
      this.get(`/properties?address=${enc}`),
    ]);

    const avm = (avmRaw ?? {}) as { price?: number; priceRangeLow?: number; priceRangeHigh?: number };
    const record = (Array.isArray(propsRaw) ? propsRaw[0] : propsRaw) as
      | {
          formattedAddress?: string;
          bedrooms?: number;
          bathrooms?: number;
          squareFootage?: number;
          yearBuilt?: number;
          lastSalePrice?: number;
          lastSaleDate?: string;
          taxAssessments?: Record<string, { value?: number; year?: number }>;
        }
      | undefined;

    const value = dollarsToCents(avm.price);
    const low = dollarsToCents(avm.priceRangeLow);
    const high = dollarsToCents(avm.priceRangeHigh);

    // Latest tax assessment value.
    let assessedValue: number | null = null;
    if (record?.taxAssessments) {
      const years = Object.keys(record.taxAssessments).sort();
      const latest = years.length ? record.taxAssessments[years[years.length - 1]] : undefined;
      assessedValue = dollarsToCents(latest?.value);
    }

    const formattedAddress = record?.formattedAddress ?? null;

    // Guard against parcel mismatch: if we got an estimate but the matched
    // address's street doesn't line up with what we asked for, flag it.
    const askedSig = streetSignature(address);
    const gotSig = streetSignature(formattedAddress);
    const streetOk = !askedSig || !gotSig || askedSig === gotSig;
    const matched = value != null && streetOk;

    if (value == null && record == null) return null; // genuine no-match

    return {
      value, // caller hides this when matched === false
      low,
      high,
      confidence: confidenceFromRange(value, low, high),
      matched,
      source: this.name,
      asOfDate: todayISO(),
      formattedAddress,
      lastSalePrice: dollarsToCents(record?.lastSalePrice),
      lastSaleDate: record?.lastSaleDate ? record.lastSaleDate.slice(0, 10) : null,
      assessedValue,
      beds: record?.bedrooms ?? null,
      baths: record?.bathrooms ?? null,
      sqft: record?.squareFootage ?? null,
      yearBuilt: record?.yearBuilt ?? null,
    };
  }
}

// --- Estated ---------------------------------------------------------------
// GET /v4/property?token=...&combined_address=... -> valuation + parcel + sale
class EstatedProvider implements PropertyValueProvider {
  readonly name = "Estated";
  readonly needsAddress = true;
  constructor(private apiKey: string) {}
  async getEstimate(q: PropertyQuery): Promise<PropertyEstimate | null> {
    const address = fullAddress(q);
    if (!address) return null;
    const params = new URLSearchParams({ token: this.apiKey, combined_address: address });
    const res = await fetch(`https://apis.estated.com/v4/property?${params}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 60 * 60 * 24 * 7 },
    });
    if (!res.ok) return null;
    const d = (await res.json().catch(() => null)) as
      | {
          data?: {
            address?: { formatted_street_address?: string };
            valuation?: { value?: number; low?: number; high?: number };
            structure?: { beds_count?: number; baths?: number; total_area_sq_ft?: number; year_built?: number };
            assessments?: { total_value?: number }[];
            market_assessments?: { total_value?: number }[];
            deeds?: { sale_price?: number; recording_date?: string }[];
          };
        }
      | null;
    const data = d?.data;
    const value = dollarsToCents(data?.valuation?.value);
    if (value == null && !data?.structure) return null;
    const low = dollarsToCents(data?.valuation?.low);
    const high = dollarsToCents(data?.valuation?.high);
    const deed = data?.deeds?.[0];
    const assessed = data?.assessments?.[0]?.total_value ?? data?.market_assessments?.[0]?.total_value;
    return {
      value,
      low,
      high,
      confidence: confidenceFromRange(value, low, high),
      matched: value != null,
      source: this.name,
      asOfDate: todayISO(),
      formattedAddress: data?.address?.formatted_street_address ?? null,
      lastSalePrice: dollarsToCents(deed?.sale_price),
      lastSaleDate: deed?.recording_date ? deed.recording_date.slice(0, 10) : null,
      assessedValue: dollarsToCents(assessed),
      beds: data?.structure?.beds_count ?? null,
      baths: data?.structure?.baths ?? null,
      sqft: data?.structure?.total_area_sq_ft ?? null,
      yearBuilt: data?.structure?.year_built ?? null,
    };
  }
}

// --- ATTOM Data ------------------------------------------------------------
// GET /propertyapi/v1.0.0/attomavm/detail?address1=&address2= -> avm + building
class AttomProvider implements PropertyValueProvider {
  readonly name = "ATTOM";
  readonly needsAddress = true;
  constructor(private apiKey: string) {}
  async getEstimate(q: PropertyQuery): Promise<PropertyEstimate | null> {
    if (!q.address) return null;
    const address1 = q.address;
    const address2 = [q.city, q.state, q.zip].filter(Boolean).join(", ");
    const params = new URLSearchParams({ address1, address2 });
    const res = await fetch(`https://api.gateway.attomdata.com/propertyapi/v1.0.0/attomavm/detail?${params}`, {
      headers: { apikey: this.apiKey, Accept: "application/json" },
      next: { revalidate: 60 * 60 * 24 * 7 },
    });
    if (!res.ok) return null;
    const d = (await res.json().catch(() => null)) as { property?: Record<string, unknown>[] } | null;
    const p = d?.property?.[0] as
      | {
          avm?: { amount?: { value?: number; high?: number; low?: number; scr?: number } };
          address?: { oneLine?: string };
          sale?: { amount?: { saleamt?: number }; salesearchdate?: string };
          assessment?: { assessed?: { assdttlvalue?: number } };
          building?: { rooms?: { beds?: number; bathstotal?: number }; size?: { livingsize?: number }; summary?: { yearbuilt?: number } };
        }
      | undefined;
    if (!p) return null;
    const value = dollarsToCents(p.avm?.amount?.value);
    const score = p.avm?.amount?.scr;
    return {
      value,
      low: dollarsToCents(p.avm?.amount?.low),
      high: dollarsToCents(p.avm?.amount?.high),
      confidence: score == null ? confidenceFromRange(value, dollarsToCents(p.avm?.amount?.low), dollarsToCents(p.avm?.amount?.high)) : score >= 80 ? "high" : score >= 60 ? "medium" : "low",
      matched: value != null,
      source: this.name,
      asOfDate: todayISO(),
      formattedAddress: p.address?.oneLine ?? null,
      lastSalePrice: dollarsToCents(p.sale?.amount?.saleamt),
      lastSaleDate: p.sale?.salesearchdate ? p.sale.salesearchdate.slice(0, 10) : null,
      assessedValue: dollarsToCents(p.assessment?.assessed?.assdttlvalue),
      beds: p.building?.rooms?.beds ?? null,
      baths: p.building?.rooms?.bathstotal ?? null,
      sqft: p.building?.size?.livingsize ?? null,
      yearBuilt: p.building?.summary?.yearbuilt ?? null,
    };
  }
}

// --- BatchData -------------------------------------------------------------
// POST /api/v1/property/search -> property record incl. valuation + address +
// characteristics. Same vendor/key as the homeowner skip-trace, so one BatchData
// account fills the whole popup (value + address + owner name/phone/email).
// Response shape varies by account, so parsing is defensive — verify field names
// against your account's first live response.
class BatchDataProvider implements PropertyValueProvider {
  readonly name = "BatchData";
  readonly needsAddress = true;
  constructor(private apiKey: string) {}
  async getEstimate(q: PropertyQuery): Promise<PropertyEstimate | null> {
    const address = fullAddress(q);
    if (!address) return null;
    let json: unknown;
    try {
      const res = await fetch("https://api.batchdata.com/api/v1/property/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          searchCriteria: { query: address },
          options: { take: 1 },
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      json = await res.json();
    } catch {
      return null;
    }
    const root = (json ?? {}) as Record<string, unknown>;
    const results = (root.results ?? root.data ?? root) as Record<string, unknown>;
    const propsArr = (results.properties ?? results.property ?? []) as unknown[];
    const p = (Array.isArray(propsArr) ? propsArr[0] : propsArr) as Record<string, unknown> | undefined;
    if (!p) return null;

    const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
    const valuation = (p.valuation ?? p.value ?? {}) as Record<string, unknown>;
    const value = dollarsToCents(num(valuation.estimatedValue) ?? num(valuation.value) ?? num(valuation.avm) ?? num(valuation.price));
    const low = dollarsToCents(num(valuation.low) ?? num(valuation.estimatedValueLow));
    const high = dollarsToCents(num(valuation.high) ?? num(valuation.estimatedValueHigh));
    const addr = (p.address ?? {}) as Record<string, unknown>;
    const formatted =
      (typeof addr.formattedAddress === "string" && addr.formattedAddress) ||
      [addr.street, addr.city, addr.state, addr.zip].filter((x) => typeof x === "string" && x).join(", ") ||
      null;
    const building = (p.building ?? p.structure ?? {}) as Record<string, unknown>;
    const sale = ((p.sale ?? p.lastSale ?? {}) as Record<string, unknown>);
    const assessment = (p.assessment ?? {}) as Record<string, unknown>;
    if (value == null && !formatted) return null;
    return {
      value,
      low,
      high,
      confidence: confidenceFromRange(value, low, high),
      matched: value != null,
      source: this.name,
      asOfDate: todayISO(),
      formattedAddress: formatted,
      lastSalePrice: dollarsToCents(num(sale.price) ?? num(sale.amount)),
      lastSaleDate: typeof sale.date === "string" ? sale.date.slice(0, 10) : null,
      assessedValue: dollarsToCents(num(assessment.totalValue) ?? num(assessment.assessedValue)),
      beds: num(building.bedroomCount) ?? num(building.beds) ?? null,
      baths: num(building.bathroomCount) ?? num(building.baths) ?? null,
      sqft: num(building.livingArea) ?? num(building.sqft) ?? null,
      yearBuilt: num(building.yearBuilt) ?? null,
    };
  }
}

// --- Test fixture (E2E only, offline, clearly labeled) ---------------------
class FixtureProvider implements PropertyValueProvider {
  readonly name = "Test Fixture";
  readonly needsAddress = false;
  async getEstimate(q: PropertyQuery): Promise<PropertyEstimate | null> {
    const seed = fullAddress(q) ?? (q.lat != null && q.lng != null ? `${q.lat.toFixed(5)},${q.lng.toFixed(5)}` : "");
    if (!seed) return null;
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const frac = (h >>> 0) / 0xffffffff;
    const value = Math.round((185_000 + frac * 665_000) / 1000) * 1000;
    return {
      value: dollarsToCents(value),
      low: dollarsToCents(Math.round(value * 0.92)),
      high: dollarsToCents(Math.round(value * 1.08)),
      confidence: "medium",
      matched: true,
      source: this.name,
      asOfDate: todayISO(),
      formattedAddress: q.address ?? null,
      lastSalePrice: dollarsToCents(Math.round(value * 0.78)),
      lastSaleDate: "2019-06-01",
      assessedValue: dollarsToCents(Math.round(value * 0.85)),
      beds: 3,
      baths: 2,
      sqft: 1800 + Math.round(frac * 1200),
      yearBuilt: 1980 + Math.round(frac * 40),
    };
  }
}

// --- None (no key / not configured) ----------------------------------------
class NoneProvider implements PropertyValueProvider {
  readonly name = "Unavailable";
  readonly needsAddress = false;
  async getEstimate(): Promise<PropertyEstimate | null> {
    return null;
  }
}

let cached: PropertyValueProvider | null = null;

export function getPropertyValueProvider(): PropertyValueProvider {
  if (cached) return cached;
  const which = (process.env.PROPERTY_VALUE_PROVIDER ?? "").toLowerCase();
  const key = process.env.PROPERTY_VALUE_API_KEY ?? "";
  // BatchData reuses the skip-trace key so ONE BatchData key powers both value + owner.
  const batchKey = key || process.env.SKIP_TRACE_API_KEY || "";
  if (which === "rentcast" && key) cached = new RentCastProvider(key);
  else if (which === "estated" && key) cached = new EstatedProvider(key);
  else if (which === "attom" && key) cached = new AttomProvider(key);
  else if (which === "batchdata" && batchKey) cached = new BatchDataProvider(batchKey);
  else if (which === "fixture") cached = new FixtureProvider();
  else cached = new NoneProvider(); // no key / unknown → honest "unavailable"
  return cached;
}

/** Whether the active provider keys off a street address (caller geocodes first). */
export function providerNeedsAddress(): boolean {
  return getPropertyValueProvider().needsAddress;
}

/** Resolve an estimate via the configured provider (no caching here — caller caches). */
export async function getPropertyEstimate(q: PropertyQuery): Promise<PropertyEstimate | null> {
  try {
    return await getPropertyValueProvider().getEstimate(q);
  } catch {
    return null;
  }
}
