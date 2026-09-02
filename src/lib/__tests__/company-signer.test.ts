import { describe, expect, it } from "vitest";
import {
  credentialKey,
  parseCredentials,
  pickSigner,
  toResolvedSigner,
  uniqueCredentialKey,
} from "@/lib/company-signer";
import { defaultSignersForLead } from "@/server/modules/esign/household-signers";
import { buildAutofillContext, buildFieldCatalog, fillTokens } from "@/server/modules/esign/autofill";

describe("credential keys", () => {
  it("makes a token-safe key from a label", () => {
    // The token grammar is [\w.]+ — anything else produces a token the
    // resolver cannot see.
    expect(credentialKey("NABCEP #")).toBe("nabcep");
    expect(credentialKey("State of TX")).toBe("state_of_tx");
    expect(credentialKey("TDLR # / RCE")).toBe("tdlr_rce");
  });

  it("never returns an empty key", () => {
    expect(credentialKey("###")).toBe("credential");
  });

  it("suffixes a key already taken, so both lines stay reachable", () => {
    const taken = new Set(["licence"]);
    expect(uniqueCredentialKey("Licence", taken)).toBe("licence_2");
  });

  it("keeps the stored key when a label is renamed", () => {
    // This is the whole point of freezing the key: a template mapping
    // {{signer.cred.nabcep}} must survive the label being corrected.
    const stored = parseCredentials([{ key: "nabcep", label: "NABCEP Certificate #", value: "PV-1" }]);
    expect(stored[0].key).toBe("nabcep");
  });

  it("keeps a key the signer already owns, and mints one for a new line", () => {
    // The save path's rule, in miniature: a submitted key is honoured only when
    // the signer already owns it. This is what survives a rename — matching on
    // the label instead would mint a fresh key the moment the label changed,
    // and silently orphan every template mapped to the old token.
    const owned = new Set(["nabcep"]);
    const taken = new Set<string>();
    const resolve = (c: { key?: string; label: string }) => {
      const key =
        c.key && owned.has(c.key) && !taken.has(c.key)
          ? c.key
          : uniqueCredentialKey(c.label, taken);
      taken.add(key);
      return key;
    };

    // Renamed, same line: the key holds.
    expect(resolve({ key: "nabcep", label: "NABCEP Certificate #" })).toBe("nabcep");
    // Brand new line: a key of its own.
    expect(resolve({ label: "TDLR #" })).toBe("tdlr");
    // A key this signer does not own cannot be claimed.
    expect(resolve({ key: "somebody_elses", label: "State of TX" })).toBe("state_of_tx");
  });

  it("drops unreadable rows rather than throwing", () => {
    const rows = parseCredentials([null, "x", { value: "no label" }, { label: "Good", value: "1" }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("Good");
  });

  it("recovers a key from the label when one was never written", () => {
    const rows = parseCredentials([{ label: "NABCEP #", value: "PV-1" }]);
    expect(rows[0].key).toBe("nabcep");
  });
});

describe("which signer signs", () => {
  const signers = [
    { id: "a", active: true, isDefault: true },
    { id: "b", active: true, isDefault: false },
    { id: "c", active: false, isDefault: false },
  ];

  it("prefers the template's own choice", () => {
    expect(pickSigner(signers, "b")?.id).toBe("b");
  });

  it("falls back to the company default when the template names nobody", () => {
    expect(pickSigner(signers, null)?.id).toBe("a");
  });

  it("falls back to the default when the named signer has been retired", () => {
    // Refusing to send over a retired colleague helps nobody — the document
    // still needs signing.
    expect(pickSigner(signers, "c")?.id).toBe("a");
  });

  it("resolves to nobody when there is no default and no valid choice", () => {
    expect(pickSigner([{ id: "z", active: true, isDefault: false }], null)).toBeNull();
  });
});

describe("resolved signer", () => {
  const row = {
    id: "s1",
    name: "Mustafa Joulani",
    title: null,
    email: null,
    phone: null,
    licenseNumber: null,
    credentials: [],
    signatureData: "data:image/png;base64,SIG",
    initialsData: null,
  };

  it("falls back to the signature for initials, so no slot prints blank", () => {
    expect(toResolvedSigner(row).initialsData).toBe("data:image/png;base64,SIG");
  });

  it("keeps a separate initials mark when one is saved", () => {
    expect(toResolvedSigner({ ...row, initialsData: "data:image/png;base64,INI" }).initialsData).toBe(
      "data:image/png;base64,INI"
    );
  });
});

describe("who signs for a household", () => {
  const base = {
    firstName: "Nancy",
    lastName: "Moore",
    email: "nancy@example.com",
    coOwnerName: null,
    coOwnerEmail: null,
  };

  it("is the customer alone when there is no co-owner", () => {
    const signers = defaultSignersForLead(base);
    expect(signers).toHaveLength(1);
    expect(signers[0]).toMatchObject({ role: "customer", name: "Nancy Moore", order: 1 });
  });

  it("adds the co-owner at the SAME order, so either may sign first", () => {
    const signers = defaultSignersForLead({
      ...base,
      coOwnerName: "John Moore",
      coOwnerEmail: "john@example.com",
    });
    expect(signers).toHaveLength(2);
    expect(signers[1]).toMatchObject({ role: "co_customer", name: "John Moore", order: 1 });
    expect(signers[0].order).toBe(signers[1].order);
  });

  it("leaves out a co-owner with no email — there is nowhere to send it", () => {
    // Adding them would hold the envelope open forever waiting on a signature
    // that can never arrive.
    const signers = defaultSignersForLead({ ...base, coOwnerName: "John Moore" });
    expect(signers).toHaveLength(1);
  });

  it("leaves out an email with no name", () => {
    const signers = defaultSignersForLead({ ...base, coOwnerEmail: "john@example.com" });
    expect(signers).toHaveLength(1);
  });
});

describe("signer and co-owner tokens", () => {
  const signer = {
    id: "s1",
    name: "Mustafa Joulani",
    title: "Owner",
    email: "owner@example.com",
    phone: "(555) 222-3344",
    licenseNumber: "TX-12345",
    credentials: [{ key: "nabcep", label: "NABCEP #", value: "PV-041234" }],
    signatureData: null,
    initialsData: null,
  };

  const ctx = (over: Parameters<typeof buildAutofillContext>[0] | object = {}) =>
    buildAutofillContext({
      firstName: "Nancy",
      lastName: "Moore",
      companyName: "Anexa Homes",
      ...(over as object),
    } as Parameters<typeof buildAutofillContext>[0]);

  it("fills the signer's identity and licence", () => {
    const c = ctx({ signer, signedOn: new Date("2026-09-02T12:00:00Z") });
    expect(fillTokens("{{signer.name}}, {{signer.title}}", c)).toBe("Mustafa Joulani, Owner");
    expect(fillTokens("{{signer.license}}", c)).toBe("TX-12345");
  });

  it("fills a credential line by its own token", () => {
    expect(fillTokens("{{signer.cred.nabcep}}", ctx({ signer }))).toBe("PV-041234");
  });

  it("leaves signer tokens blank when nobody has signed", () => {
    // Blank rather than missing: a preview must render, and a date on an
    // unsigned document would be a claim nobody made.
    const c = ctx();
    expect(fillTokens("[{{signer.name}}][{{signer.date}}]", c)).toBe("[][]");
  });

  it("dates the signature only once there is one", () => {
    const c = ctx({ signer, signedOn: new Date("2026-09-02T12:00:00Z") });
    expect(fillTokens("{{signer.date}}", c)).not.toBe("");
  });

  it("fills the co-owner's own contact details", () => {
    const c = ctx({
      coOwnerName: "John Moore",
      coOwnerEmail: "john@example.com",
      coOwnerPhone: "(555) 987-6543",
    });
    expect(fillTokens("{{coOwner.fullName}} {{coOwner.email}} {{coOwner.phone}}", c)).toBe(
      "John Moore john@example.com (555) 987-6543"
    );
  });

  it("keeps {{customer.coOwner}} working for templates already mapped to it", () => {
    const c = ctx({ coOwnerName: "John Moore" });
    expect(fillTokens("{{customer.coOwner}}", c)).toBe("John Moore");
  });
});

describe("field catalogue", () => {
  it("offers one entry per credential, de-duplicated across signers", () => {
    const catalog = buildFieldCatalog(
      [],
      [
        { key: "tdlr", label: "TDLR #" },
        { key: "tdlr", label: "TDLR #" },
        { key: "nabcep", label: "NABCEP #" },
      ]
    );
    const creds = catalog.filter((e) => e.token.startsWith("{{signer.cred."));
    expect(creds.map((c) => c.token)).toEqual(["{{signer.cred.tdlr}}", "{{signer.cred.nabcep}}"]);
  });

  it("does not offer the co-owner alias as a second way to pick the same value", () => {
    const tokens = buildFieldCatalog([]).map((e) => e.token);
    expect(tokens).toContain("{{coOwner.fullName}}");
    expect(tokens).not.toContain("{{customer.coOwner}}");
  });
});
