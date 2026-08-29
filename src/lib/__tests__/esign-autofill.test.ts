import { describe, expect, it } from "vitest";
import {
  BASE_CATALOG,
  buildAutofillContext,
  buildFieldCatalog,
  fillTokens,
} from "@/server/modules/esign/autofill";

const base = {
  firstName: "Nancy",
  lastName: "Moore",
  companyName: "Anexa Homes",
};

describe("company autofill tokens", () => {
  it("resolves every Company token in the picker's catalog", () => {
    const ctx = buildAutofillContext({
      ...base,
      companyPhone: "(866) 650-9996",
      companyEmail: "support@anexahomes.com",
      companyWebsite: "anexahomes.com",
      companyStreet: "500 Main Street",
      companyCity: "Dallas",
      companyState: "TX",
      companyZip: "75201",
      companyEin: "88-1234567",
    });

    // Every Company entry offered in the template builder must actually fill —
    // a token in the picker that renders blank is worse than no token at all.
    for (const entry of BASE_CATALOG.filter((e) => e.group === "Company")) {
      expect(fillTokens(entry.token, ctx), entry.token).not.toBe("");
    }
    expect(fillTokens("{{company.email}}", ctx)).toBe("support@anexahomes.com");
    expect(fillTokens("{{company.ein}}", ctx)).toBe("88-1234567");
  });

  it("composes the full company address from its parts", () => {
    const ctx = buildAutofillContext({
      ...base,
      companyStreet: "500 Main Street",
      companyCity: "Dallas",
      companyState: "TX",
      companyZip: "75201",
    });
    expect(ctx.company.full).toBe("500 Main Street, Dallas, TX, 75201");
  });

  it("prints blank rather than 'undefined' when the company record is empty", () => {
    const ctx = buildAutofillContext(base);
    expect(ctx.company.full).toBe("");
    expect(fillTokens("Contact: {{company.email}}", ctx)).toBe("Contact: ");
  });

  it("keeps custom fields appended after the built-ins", () => {
    const catalog = buildFieldCatalog([{ key: "gate_code", label: "Gate Code", entity: "lead" }]);
    expect(catalog.at(-1)).toMatchObject({ token: "{{custom.gate_code}}", group: "Custom fields" });
    expect(catalog.filter((e) => e.group === "Company").length).toBe(10);
  });
});

describe("permitting tokens", () => {
  const permit = {
    ahjName: "City of Dallas",
    ahjContactName: "Dana Ruiz",
    ahjContactInfo: "(214) 555-0100",
    permitNumber: "PMT-2026-4471",
    installerContact: "pm@example.com",
    installerTitle: "Project Manager",
    permitNotRequired: true,
    ptoNotRequired: false,
    interconnectionNotRequired: false,
    otherUtilityStatus: true,
    otherUtilityStatusDetail: "Awaiting meter swap",
  };

  it("resolves every Permitting token in the picker's catalog", () => {
    const ctx = buildAutofillContext({ ...base, permit });
    // Every Permitting token must carry the value set above. The two flags left
    // false are excluded — an unticked box is *supposed* to print nothing.
    const unticked = ["{{permit.ptoNotRequired}}", "{{permit.interconnectionNotRequired}}"];
    for (const entry of BASE_CATALOG.filter((e) => e.group === "Permitting")) {
      if (unticked.includes(entry.token)) continue;
      expect(fillTokens(entry.token, ctx), entry.token).not.toBe("");
    }
    expect(fillTokens("{{permit.ahj}}", ctx)).toBe("City of Dallas");
    expect(fillTokens("{{permit.number}}", ctx)).toBe("PMT-2026-4471");
    expect(fillTokens("{{permit.otherUtilityDetail}}", ctx)).toBe("Awaiting meter swap");
  });

  it("ticks a checked box and prints nothing for an unchecked one", () => {
    const ctx = buildAutofillContext({ ...base, permit });
    // "Yes" is what pdf.ts stamps an X for; false must never reach the page as
    // the word "false".
    expect(fillTokens("{{permit.notRequired}}", ctx)).toBe("Yes");
    expect(fillTokens("{{permit.ptoNotRequired}}", ctx)).toBe("");
    expect(fillTokens("{{permit.interconnectionNotRequired}}", ctx)).toBe("");
  });

  it("answers the AHJ with the company contact when the job names nobody", () => {
    const ctx = buildAutofillContext({
      ...base,
      companyEmail: "office@anexahomes.com",
      permit: { ...permit, installerContact: null },
    });
    expect(fillTokens("{{permit.installerContact}}", ctx)).toBe("office@anexahomes.com");
  });

  it("leaves every permitting token blank on a deal with no solar design", () => {
    const ctx = buildAutofillContext(base);
    for (const entry of BASE_CATALOG.filter((e) => e.group === "Permitting")) {
      expect(fillTokens(entry.token, ctx), entry.token).toBe("");
    }
  });
});
