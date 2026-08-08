import { describe, it, expect } from "vitest";
import { proposalEmail, type ProposalEmailInput } from "../email";

const BRAND = { companyName: "Anexa Homes", accentColor: "#F4631E", appUrl: "https://anexahomes.com" };

function build(over: Partial<ProposalEmailInput> = {}) {
  return proposalEmail({
    brand: BRAND,
    customerName: "Barbara Savage",
    propertyAddress: "5551 Parker Henderson Rd, Fort Worth, TX 76119",
    dealType: "cash",
    repName: "Mustafa Joulani",
    outOfPocketCents: 1_800_000,
    financing: { enabled: false, termsMonths: [] },
    url: "https://anexahomes.com/present/tok123",
    ...over,
  });
}

describe("proposalEmail", () => {
  it("quotes a cash bid as a total, and an insurance claim as out-of-pocket", () => {
    expect(build({ dealType: "cash" }).text).toContain("Your total is $18,000.");
    expect(build({ dealType: "insurance", outOfPocketCents: 250_000 }).text).toContain(
      "Your out-of-pocket is $2,500.",
    );
  });

  it("leads with the lowest monthly when financing is on", () => {
    const { text } = build({ financing: { enabled: true, termsMonths: [24, 60] } });
    // $18,000 over the longest term (60 mo) at 0% is $300/mo.
    expect(text).toContain("Your total is $18,000 — or as low as $300/mo for 60 months at 0% interest.");
  });

  it("quotes no price at all when nothing has been priced yet", () => {
    const { text } = build({ outOfPocketCents: 0, financing: { enabled: true, termsMonths: [60] } });
    expect(text).not.toContain("$0");
    expect(text).not.toMatch(/Your total|Your out-of-pocket/);
    expect(text).toContain("Here is your roofing proposal for");
  });

  it("greets by first name and carries the rep's note verbatim", () => {
    const { text } = build({ message: "Great meeting you today — call me with any questions." });
    expect(text).toContain("Hi Barbara,");
    expect(text).toContain("Great meeting you today — call me with any questions.");
  });

  it("falls back to a neutral greeting when there is no name on the deal", () => {
    expect(build({ customerName: "  " }).text).toContain("Hi there,");
  });

  it("names the rep only when the deal has one assigned", () => {
    expect(build({ repName: "Mustafa Joulani" }).text).toContain("Mustafa Joulani will follow up");
    expect(build({ repName: null }).text).not.toContain("will follow up");
  });

  it("puts the private link in the subject-line brand, the CTA and the plain-text fallback", () => {
    const { subject, html, text } = build();
    expect(subject).toBe("Your Anexa Homes proposal for 5551 Parker Henderson Rd, Fort Worth, TX 76119");
    expect(html).toContain("https://anexahomes.com/present/tok123");
    expect(text).toContain("View my proposal: https://anexahomes.com/present/tok123");
  });

  it("never leaks internal money into the customer's copy", () => {
    const body = build({ financing: { enabled: true, termsMonths: [60] } }).html.toLowerCase();
    for (const leak of ["profit", "commission", "overhead", "cost"]) expect(body).not.toContain(leak);
  });
});
