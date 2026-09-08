import { describe, it, expect } from "vitest";
import { entryStage } from "../pipeline-entry";

/** The two pipelines this product ships, trimmed to their front. */
const ROOFING = [
  { id: "r0", key: "new_lead", name: "New Appointment" },
  { id: "r1", key: "appointment_set", name: "Appointment Set" },
  { id: "r2", key: "inspection_complete", name: "Inspection Complete" },
];
const SOLAR = [
  { id: "s0", key: "new_appt", name: "New Appointment" },
  { id: "s1", key: "site_survey", name: "Site Survey" },
  { id: "s2", key: "proposal_sent", name: "Proposal Sent" },
];

describe("entryStage", () => {
  it("puts a dateless deal in the first stage", () => {
    expect(entryStage(ROOFING, false)?.name).toBe("New Appointment");
    expect(entryStage(SOLAR, false)?.name).toBe("New Appointment");
  });

  it("books a dated roofing deal into Appointment Set", () => {
    expect(entryStage(ROOFING, true)?.id).toBe("r1");
  });

  it("keeps a dated solar deal at the front — that pipeline has no Appointment Set", () => {
    expect(entryStage(SOLAR, true)?.id).toBe("s0");
  });

  it("never reaches past the two front stages", () => {
    for (const hasAppointment of [true, false]) {
      expect(entryStage(ROOFING, hasAppointment)?.id).not.toBe("r2");
      expect(entryStage(SOLAR, hasAppointment)?.id).not.toBe("s2");
    }
  });

  it("returns null for a pipeline with no stages", () => {
    expect(entryStage([], false)).toBeNull();
    expect(entryStage([], true)).toBeNull();
  });
});
