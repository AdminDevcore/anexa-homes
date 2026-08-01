export type Branding = {
  companyName: string;
  recordPrefix: string;
  supportPhone: string | null;
  supportEmail: string | null;
  currencyCode: string;
  locale: string;
  timeZone: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  accentColor: string;
  fontFamily: string | null;
  emailFromName: string | null;
  customDomain: string | null;
  removePoweredBy: boolean;
};

export const DEFAULT_BRANDING = {
  recordPrefix: "",
  currencyCode: "USD",
  locale: "en-US",
  timeZone: "America/Chicago",
  primaryColor: "#0B0B0C",
  accentColor: "#F4631E",
  removePoweredBy: false,
} as const;

/** First letters of up to the first 3 words, uppercased, e.g. "Summit Roofing" -> "SR-".
 *  Single-word names use the first two letters, e.g. "Solo" -> "SO-". */
export function derivePrefix(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const letters =
    words.length === 1
      ? words[0].slice(0, 2)
      : words.slice(0, 3).map((w) => w[0]).join("");
  return letters.toUpperCase() + "-";
}

type CompanyInput = { name: string; timezone?: string | null };
type SettingsInput = Partial<{
  /** Per-vertical brand name. Not a column — arrives via verticalOverrides. */
  brandName: string;
  recordPrefix: string;
  supportPhone: string | null;
  supportEmail: string | null;
  currencyCode: string;
  locale: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  accentColor: string;
  fontFamily: string | null;
  emailFromName: string | null;
  customDomain: string | null;
  removePoweredBy: boolean;
}> | null;

export function resolveBranding(input: {
  company: CompanyInput;
  settings: SettingsInput;
}): Branding {
  const s = input.settings ?? {};
  return {
    // A vertical may carry its own brand name (Solar = Prime Solar). Unset
    // falls back to the company name, which is what Roofing always shows — so
    // this line is a no-op until someone fills Solar's brand in.
    companyName: s.brandName?.trim() || input.company.name,
    recordPrefix:
      s.recordPrefix?.trim() || derivePrefix(s.brandName?.trim() || input.company.name),
    supportPhone: s.supportPhone ?? null,
    supportEmail: s.supportEmail ?? null,
    currencyCode: s.currencyCode || DEFAULT_BRANDING.currencyCode,
    locale: s.locale || DEFAULT_BRANDING.locale,
    timeZone: input.company.timezone || DEFAULT_BRANDING.timeZone,
    logoUrl: s.logoUrl ?? null,
    faviconUrl: s.faviconUrl ?? null,
    primaryColor: s.primaryColor || DEFAULT_BRANDING.primaryColor,
    accentColor: s.accentColor || DEFAULT_BRANDING.accentColor,
    fontFamily: s.fontFamily ?? null,
    emailFromName: s.emailFromName ?? null,
    customDomain: s.customDomain ?? null,
    removePoweredBy: s.removePoweredBy ?? DEFAULT_BRANDING.removePoweredBy,
  };
}
