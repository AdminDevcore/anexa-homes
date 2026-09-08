import { describe, it, expect } from "vitest";
import { withCustomerContact } from "@/lib/solar-proposal";
import { tel, addressLine } from "@/components/proposal/solar/cover";

/**
 * The cover's "Prepared for" block: who the document is addressed to.
 *
 * All three of these exist because of ONE rule — a frozen document is never
 * rewritten. The contact details are filled in only where the snapshot predates
 * the field, and the punctuation and the phone shape are fixed at RENDER for
 * the documents already in the database.
 */

const frozen = {
  customer: { name: "Tessa Vaughn", address: "1903 N Depot St, Victoria, TX, 77901" },
};
const lead = { email: "tessa@example.com", phone: "3615550134" };

describe("withCustomerContact", () => {
  it("fills the block on a document frozen before it existed", () => {
    expect(withCustomerContact(frozen, lead).customer).toEqual({
      name: "Tessa Vaughn",
      address: "1903 N Depot St, Victoria, TX, 77901",
      email: "tessa@example.com",
      phone: "3615550134",
    });
  });

  it("NEVER overwrites what the document already froze — including a frozen null", () => {
    const current = {
      customer: { ...frozen.customer, email: null, phone: "8005551000" },
    };
    // The lead has an email now. This document recorded that it did not the day
    // it was generated, and that is what it keeps saying.
    expect(withCustomerContact(current, lead).customer.email).toBeNull();
    expect(withCustomerContact(current, lead).customer.phone).toBe("8005551000");
  });

  it("fills each field on its own, and survives a deal with no contact details", () => {
    const half = { customer: { ...frozen.customer, phone: null } };
    const filled = withCustomerContact(half, lead).customer;
    expect(filled.email).toBe("tessa@example.com");
    expect(filled.phone).toBeNull();

    expect(withCustomerContact(frozen, null).customer.email).toBeNull();
    expect(withCustomerContact(frozen, { email: null, phone: null }).customer.phone).toBeNull();
  });

  it("leaves a complete snapshot untouched, object identity and all", () => {
    const done = { customer: { ...frozen.customer, email: "a@b.com", phone: "2145550000" } };
    expect(withCustomerContact(done, lead)).toBe(done);
  });
});

describe("tel", () => {
  it("writes a ten-digit number the way it is spoken", () => {
    expect(tel("3615550134")).toBe("(361) 555-0134");
    expect(tel("13615550134")).toBe("(361) 555-0134");
    expect(tel("361-555-0134")).toBe("(361) 555-0134");
  });

  it("passes anything that is not a plain US number through untouched", () => {
    expect(tel("+44 20 7946 0958")).toBe("+44 20 7946 0958");
    expect(tel("361-555-0134 ext 22")).toBe("361-555-0134 ext 22");
    expect(tel("555-0134")).toBe("555-0134");
  });

  it("is null, never an empty line on the cover, when there is no number", () => {
    expect(tel(null)).toBeNull();
    expect(tel("")).toBeNull();
  });
});

describe("addressLine", () => {
  it("takes back the comma the old generator put in front of the ZIP", () => {
    expect(addressLine("1903 N Depot St, Victoria, TX, 77901")).toBe(
      "1903 N Depot St, Victoria, TX 77901",
    );
    expect(addressLine("1903 N Depot St, Victoria, TX, 77901-2043")).toBe(
      "1903 N Depot St, Victoria, TX 77901-2043",
    );
  });

  it("touches nothing else — an address already written correctly, or one with no ZIP", () => {
    const good = "1420 Oak St, Plano, TX 75024";
    expect(addressLine(good)).toBe(good);
    expect(addressLine("1420 Oak St, Plano, TX")).toBe("1420 Oak St, Plano, TX");
    // A house number that happens to be five digits is not a ZIP.
    expect(addressLine("75024 Ranch Rd, Plano, TX")).toBe("75024 Ranch Rd, Plano, TX");
    expect(addressLine(null)).toBeNull();
  });
});
