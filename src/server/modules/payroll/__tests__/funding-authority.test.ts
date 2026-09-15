import { describe, it, expect } from "vitest";
import type { Role } from "@prisma/client";
import {
  canCertifyFunding,
  crossesFundingGate,
} from "@/server/modules/payroll/funding-authority";

/**
 * WHO MAY SAY A LENDER FUNDED A DEAL.
 *
 * Commission is released by two facts standing together — the deal's stage at
 * or past M1 Funding, and the rep milestone stamped paid. Both were ordinary
 * `Lead:update` writes, which every `sales_rep` holds on their own deals, so a
 * rep could manufacture every precondition for their own payout.
 *
 * The pure half of the fix is proved here; the server actions that enforce it
 * are proved in `funding-gate.itest.ts`.
 */

const user = (role: Role, permissions: Record<string, boolean> = {}) => ({
  userId: `u-${role}`,
  companyId: "co-1",
  role,
  permissions,
});

describe("only the funding desk may certify that money arrived", () => {
  it("grants the three roles whose job it is", () => {
    expect(canCertifyFunding(user("super_admin"))).toBe(true);
    expect(canCertifyFunding(user("admin"))).toBe(true);
    // The funding desk. It watches the bank; this is precisely its call.
    expect(canCertifyFunding(user("accounting"))).toBe(true);
  });

  it("REFUSES the rep whose own commission it releases", () => {
    expect(canCertifyFunding(user("sales_rep"))).toBe(false);
    expect(canCertifyFunding(user("canvasser"))).toBe(false);
  });

  it("refuses a manager — running the sales floor is not watching the bank", () => {
    // A manager holds Commission:read and nothing more, and frequently earns an
    // override on the very deals they would be certifying.
    expect(canCertifyFunding(user("manager"))).toBe(false);
  });

  it("refuses every other staff role", () => {
    expect(canCertifyFunding(user("installer"))).toBe(false);
    expect(canCertifyFunding(user("marketing"))).toBe(false);
  });

  it("honours an explicit per-user grant, and an explicit per-user revocation", () => {
    // The override mechanism is how a company deputises one person without
    // moving them to another role — and how it takes it back.
    expect(canCertifyFunding(user("sales_rep", { "Commission:approve": true }))).toBe(true);
    expect(canCertifyFunding(user("admin", { "Commission:approve": false }))).toBe(false);
  });
});

/**
 * LIVE's actual solar pipeline, verbatim — the same list `commission-gate.test.ts`
 * pins against, and for the same reason: half the keys carry a numeric suffix
 * because the stages were rebuilt by hand in Settings, and the funding stage's
 * key still says `partial_funding` because it was renamed to "M1 Funding"
 * afterwards. A matcher written against a tidy key would leave the gate open on
 * the only pipeline that matters.
 */
const LIVE_SOLAR = [
  "new_appt", "contract_signed", "ntp_submitted_9", "ntp_action_required_10",
  "ntp_approved_11", "design_submitted_12", "design_action_required_13",
  "design_complete_14", "interconnection_application_submitted_17", "permitting",
  "permit_action_required_15", "permit_complete_16", "install_ready_18",
  "install_scheduled", "install_in_progress_mpu_19", "installed",
  "partial_funding_26", "inspection_scheduled_20", "inspection_action_required_21",
  "inspection_complete_22", "monitoring_requested_23", "monitoring_action_required_29",
  "monitoring_complete_24", "interconnection_action_required_25", "pto", "paid",
  "install_closed_28", "cancelled_27",
].map((key, position) => ({
  id: key,
  key,
  name: key === "partial_funding_26" ? "M1 Funding" : key,
  position,
  isLost: key === "cancelled_27",
}));

const stage = (key: string) => LIVE_SOLAR.find((s) => s.key === key)!;

describe("which stages sit past the funding line", () => {
  it("recognises the live gate through its renamed key", () => {
    expect(crossesFundingGate("solar", LIVE_SOLAR, stage("partial_funding_26"))).toBe(true);
  });

  it("treats everything after it as past the line too", () => {
    // `eligibleStageIds` is positional — a deal parked at Inspection Complete is
    // already eligible — so jumping straight there clears the same bar.
    expect(crossesFundingGate("solar", LIVE_SOLAR, stage("inspection_complete_22"))).toBe(true);
    expect(crossesFundingGate("solar", LIVE_SOLAR, stage("pto"))).toBe(true);
    expect(crossesFundingGate("solar", LIVE_SOLAR, stage("paid"))).toBe(true);
  });

  it("leaves everything before it alone", () => {
    expect(crossesFundingGate("solar", LIVE_SOLAR, stage("contract_signed"))).toBe(false);
    expect(crossesFundingGate("solar", LIVE_SOLAR, stage("installed"))).toBe(false);
    expect(crossesFundingGate("solar", LIVE_SOLAR, stage("install_scheduled"))).toBe(false);
  });

  it("never treats Cancelled as past the line, wherever it sits", () => {
    // Cancelled is at position 27, the very end — so a positional rule would
    // stop a rep killing their own dead deal, which is both wrong and nothing
    // to do with money arriving.
    expect(stage("cancelled_27").position).toBeGreaterThan(stage("partial_funding_26").position);
    expect(crossesFundingGate("solar", LIVE_SOLAR, stage("cancelled_27"))).toBe(false);
  });

  it("finds nothing to cross in a pipeline with no funding stage", () => {
    const noGate = LIVE_SOLAR.filter((s) => s.key !== "partial_funding_26");
    expect(crossesFundingGate("solar", noGate, stage("pto"))).toBe(false);
  });

  it("does not apply roofing's gate to a solar question, or the reverse", () => {
    // Roofing gates at the depreciation request, which is not a claim that cash
    // arrived. Asked about roofing, this list has no such stage.
    expect(crossesFundingGate("roofing", LIVE_SOLAR, stage("pto"))).toBe(false);
  });
});
