import { describe, expect, it } from "vitest";
import { ctxForLead, type LeadForCtx } from "@/server/modules/esign/context";
import { fillTokens } from "@/server/modules/esign/autofill";

const company = { name: "Anexa Homes", email: "office@anexahomes.com" };

function lead(over: Partial<LeadForCtx> = {}): LeadForCtx {
  return {
    firstName: "Nancy",
    lastName: "Moore",
    coOwnerName: null,
    coOwnerEmail: null,
    coOwnerPhone: null,
    email: null,
    phone: null,
    address: "107 Oak Street",
    city: "Dallas",
    state: "TX",
    zip: "75201",
    status: "open",
    createdAt: new Date("2026-06-04T00:00:00Z"),
    customFields: {},
    source: null,
    assignedRep: null,
    project: null,
    ...over,
  };
}

describe("custom fields reaching a document", () => {
  it("fills {{custom.*}} from the PROJECT, not just the lead", () => {
    const ctx = ctxForLead(
      lead({
        customFields: { gate_code: "1234" },
        project: {
          projectNumber: "AH-1004",
          serviceType: "solar",
          status: "not_started",
          contractValue: 2300000,
          customFields: { permit_packet_notes: "Left with the city 8/12" },
          manager: null,
        },
      }),
      company
    );

    expect(fillTokens("{{custom.gate_code}}", ctx)).toBe("1234");
    expect(fillTokens("{{custom.permit_packet_notes}}", ctx)).toBe("Left with the city 8/12");
  });

  it("lets the project's value win when both carry the same key", () => {
    // The job is the later, more specific answer — a field renamed on the deal
    // should not be shadowed by whatever intake once typed.
    const ctx = ctxForLead(
      lead({
        customFields: { crew_notes: "from intake" },
        project: {
          projectNumber: "AH-1004",
          serviceType: "solar",
          status: "not_started",
          contractValue: 0,
          customFields: { crew_notes: "from the job" },
          manager: null,
        },
      }),
      company
    );
    expect(ctx.custom.crew_notes).toBe("from the job");
  });

  it("prints nothing for a field this deal never filled", () => {
    const ctx = ctxForLead(lead(), company);
    expect(fillTokens("Notes: {{custom.permit_packet_notes}}", ctx)).toBe("Notes: ");
  });
});
