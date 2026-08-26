import { describe, it, expect } from "vitest";
import {
  findGateStage,
  commissionGateLabel,
  eligibleStageIds,
  type EligibilityStage,
} from "@/server/modules/payroll/gate";

/**
 * These two lists are LIVE's actual pipelines, names and keys verbatim, because
 * that is the thing the gate has to match. Both were seeded once and then
 * rebuilt by hand in Settings, which is why half the keys carry a numeric
 * suffix and why the solar gate's key still says `partial_funding` — the stage
 * was created under that name and renamed to "M1 Funding" afterwards.
 */
const LIVE_SOLAR: [string, string][] = [
  ["new_appt", "New Appointment"],
  ["contract_signed", "Contract Signed / Hold"],
  ["ntp_submitted_9", "NTP Submitted"],
  ["ntp_action_required_10", "NTP Action Required"],
  ["ntp_approved_11", "NTP Approved"],
  ["design_submitted_12", "Design Submitted"],
  ["design_action_required_13", "Design Action Required"],
  ["design_complete_14", "Design Complete"],
  ["interconnection_application_submitted_17", "Interconnection Application Submitted"],
  ["permitting", "Permit Submitted"],
  ["permit_action_required_15", "Permit Action Required"],
  ["permit_complete_16", "Permit Complete"],
  ["install_ready_18", "Install Ready"],
  ["install_scheduled", "Install Scheduled"],
  ["install_in_progress_mpu_19", "Install In Progress / MPU"],
  ["installed", "Install Complete"],
  ["partial_funding_26", "M1 Funding"],
  ["inspection_scheduled_20", "Inspection Scheduled"],
  ["inspection_action_required_21", "Inspection Action Required"],
  ["inspection_complete_22", "Inspection Complete"],
  ["monitoring_requested_23", "Monitoring Requested"],
  ["monitoring_action_required_29", "Monitoring Action Required"],
  ["monitoring_complete_24", "Monitoring Complete"],
  ["interconnection_action_required_25", "Interconnection Action Required"],
  ["pto", "Interconnection Complete ( PTO )"],
  ["paid", "m2 Funded"],
  ["install_closed_28", "Install Closed"],
  ["cancelled_27", "Cancelled"],
];

const LIVE_ROOFING: [string, string][] = [
  ["new_lead", "New Appointment"],
  ["appointment_set", "Appointment Set"],
  ["inspection_complete", "Inspection Complete"],
  ["claim_opened", "Insurance Claim Opened"],
  ["adjuster_meeting", "Adjuster Meeting Scheduled"],
  ["adjuster_meeting_complete_16", "Adjuster Meeting Complete"],
  ["scope_received", "Scope Received"],
  ["scope_complete_17", "Scope Complete"],
  ["supplement_needed", "Supplement Needed"],
  ["supplement_submitted_18", "Supplement Submitted"],
  ["supplement_approved_19", "Supplement Approved"],
  ["contract_signed", "Contract Signed"],
  ["front_check_received_20", "Front check received"],
  ["material_ordered", "Material Ordered"],
  ["scheduled", "Scheduled"],
  ["in_production", "In Production"],
  ["qc_inspection", "QC Inspection"],
  ["invoice_sent", "Invoice Sent"],
  ["depreciation_requested", "Depreciation Requested"],
  ["paid", "Paid"],
  ["closed", "Closed"],
  ["cancelled_21", "Cancelled"],
];

/** Turn a [key, name] list into stage rows, flagging won/lost the way live does. */
function stages(
  pairs: [string, string][],
  flags: { won?: string[]; lost?: string[] } = {}
): EligibilityStage[] {
  return pairs.map(([key, name], position) => ({
    id: key,
    key,
    name,
    position,
    isWon: (flags.won ?? []).includes(key),
    isLost: (flags.lost ?? []).includes(key),
  }));
}

const solar = stages(LIVE_SOLAR, { won: ["paid"] });
// Live's roofing Cancelled IS flagged lost; live's solar Cancelled is NOT.
const roofing = stages(LIVE_ROOFING, { won: ["paid", "closed"], lost: ["cancelled_21"] });

describe("the solar gate is M1 Funding", () => {
  it("finds live's hand-made M1 stage despite its partial_funding key", () => {
    expect(findGateStage("solar", solar)?.name).toBe("M1 Funding");
  });

  it("never gates on Contract Signed — the rep is not paid at the sale", () => {
    expect(findGateStage("solar", solar)?.key).not.toBe("contract_signed");
  });

  it("never mistakes the SECOND milestone for the first", () => {
    const m2Only = solar.filter((s) => s.name !== "M1 Funding");
    expect(findGateStage("solar", m2Only)).toBeUndefined();
  });

  it.each(["M1 Funding", "M-1 Funding", "M 1 Funding", "M1 Funded", "Partial Funding"])(
    "matches a gate named %s",
    (name) => {
      expect(findGateStage("solar", [{ key: "made_up_44", name }])?.name).toBe(name);
    }
  );

  it.each(["m1_funding", "m1_funding_12", "partial_funding", "partial_funding_26"])(
    "matches a gate keyed %s even if somebody renames the stage",
    (key) => {
      expect(findGateStage("solar", [{ key, name: "Lender Milestone 1" }])?.key).toBe(key);
    }
  );

  it("labels the gate M1 Funding for the UI", () => {
    expect(commissionGateLabel("solar")).toBe("M1 Funding");
  });
});

describe("roofing is untouched", () => {
  it("still gates on Depreciation Requested", () => {
    expect(findGateStage("roofing", roofing)?.key).toBe("depreciation_requested");
    expect(commissionGateLabel("roofing")).toBe("Depreciation Requested");
  });

  it("falls back to roofing's gate for an unknown vertical", () => {
    expect(commissionGateLabel("gutters")).toBe("Depreciation Requested");
    expect(findGateStage("gutters", roofing)?.key).toBe("depreciation_requested");
  });
});

describe("which stages can generate a commission", () => {
  const ids = eligibleStageIds([
    { vertical: "solar", stages: solar },
    { vertical: "roofing", stages: roofing },
  ]);

  it("opens at M1 Funding and stays open for everything after it", () => {
    expect(ids.has("partial_funding_26")).toBe(true);
    for (const k of ["inspection_complete_22", "pto", "paid", "install_closed_28"]) {
      expect(ids.has(k), `${k} should still pay`).toBe(true);
    }
  });

  it("pays nothing on a solar deal that has not been funded", () => {
    for (const k of ["contract_signed", "ntp_approved_11", "permit_complete_16", "install_scheduled", "installed"]) {
      expect(ids.has(k), `${k} is before M1 and must not pay`).toBe(false);
    }
  });

  it("never pays a dead deal, however far down the pipeline its Lost stage sits", () => {
    // Roofing's Cancelled is position 21 — past the depreciation gate at 18.
    expect(ids.has("cancelled_21")).toBe(false);
  });

  it("falls back to the won stages when a pipeline has no gate at all", () => {
    const custom = stages([["a", "A"], ["b", "B"], ["c", "Closed Won"]], { won: ["c"] });
    const only = eligibleStageIds([{ vertical: "gutters", stages: custom }]);
    expect([...only]).toEqual(["c"]);
  });
});
