import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";

// Address autocomplete for entry forms (e.g. the New Appointment / lead form).
// Proxies OpenStreetMap Nominatim — same polite User-Agent + caching + US-only
// scope as /api/canvassing/geocode — but parses each hit into structured parts
// (street / city / state / zip) so picking a suggestion can fill those fields.
// Gated to any logged-in portal user (NOT the Canvassing permission), since
// anyone who can create an appointment needs it.

export type AddressSuggestion = {
  label: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
};

type NominatimAddress = {
  house_number?: string;
  road?: string;
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  municipality?: string;
  county?: string;
  state?: string;
  postcode?: string;
  ["ISO3166-2-lvl4"]?: string;
};

// Full state name → USPS code. Nominatim returns the spelled-out state name
// (e.g. "Texas"); the form's State field holds the 2-letter code.
const STATE_ABBR: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY", "puerto rico": "PR",
};

/** Resolve a 2-letter state code from Nominatim's address block. Prefers the
 *  ISO3166-2 tag (e.g. "US-TX"), then falls back to the spelled-out name. */
function stateCode(a: NominatimAddress): string {
  const iso = a["ISO3166-2-lvl4"];
  if (iso && /^US-[A-Z]{2}$/.test(iso)) return iso.slice(3);
  const name = (a.state ?? "").trim().toLowerCase();
  return STATE_ABBR[name] ?? (a.state ?? "");
}

function streetLine(a: NominatimAddress): string {
  return [a.house_number, a.road].filter(Boolean).join(" ").trim();
}

function cityName(a: NominatimAddress): string {
  return a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality ?? "";
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ results: [] }, { status: 401 });

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 3) return NextResponse.json({ results: [] });

  try {
    const url =
      `https://nominatim.openstreetmap.org/search?format=jsonv2` +
      `&addressdetails=1&countrycodes=us&limit=6&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "AnexaHomesCRM/1.0 (lead-form)",
        "Accept-Language": "en-US",
      },
      // Cache identical lookups for an hour (matches the canvassing proxy).
      next: { revalidate: 3600 },
    });
    if (!res.ok) return NextResponse.json({ results: [] });

    const data = (await res.json()) as Array<{
      lat: string;
      lon: string;
      display_name?: string;
      address?: NominatimAddress;
    }>;

    const results: AddressSuggestion[] = data
      .map((d) => {
        const a = d.address ?? {};
        return {
          label: d.display_name ?? "",
          address: streetLine(a),
          city: cityName(a),
          state: stateCode(a),
          zip: a.postcode ?? "",
          lat: Number(d.lat),
          lng: Number(d.lon),
        };
      })
      .filter((r) => r.label && Number.isFinite(r.lat) && Number.isFinite(r.lng));

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [] });
  }
}
