import { describe, expect, it } from "vitest";
import {
  contractSignedMet,
  contractSignedMissing,
  contractSignedStage,
  crossesContractSigned,
  NO_EVIDENCE,
  type MilestoneStage,
} from "@/lib/contract-signed";

/**
 * Production's own shape: the sale stage is at position 1, NAMED "Contract
 * Signed / Hold" with a hand-made key — so nothing here reads a name or a key,
 * only the milestone.
 */
const STAGES: (MilestoneStage & { name: string })[] = [
  { id: "new", name: "New Appointment", position: 0, isLost: false, milestone: null },
  { id: "cs", name: "Contract Signed / Hold", position: 1, isLost: false, milestone: "contract_signed" },
  { id: "permit", name: "Permitting", position: 2, isLost: false, milestone: null },
  { id: "install", name: "Install Complete", position: 3, isLost: false, milestone: null },
  { id: "lost", name: "Cancelled", position: 9, isLost: true, milestone: null },
];
const at = (id: string) => STAGES.find((s) => s.id === id)!;

describe("which stage is Contract Signed", () => {
  it("is the stage marked with the milestone, whatever it is called", () => {
    expect(contractSignedStage(STAGES)?.id).toBe("cs");
    const renamed = STAGES.map((s) => (s.id === "cs" ? { ...s, name: "Signed — waiting on lender" } : s));
    expect(contractSignedStage(renamed)?.id).toBe("cs");
  });

  it("is NOT a stage merely named Contract Signed", () => {
    const unmarked = STAGES.map((s) => ({ ...s, milestone: null }));
    expect(contractSignedStage(unmarked)).toBeNull();
  });
});

describe("crossing the Contract Signed line", () => {
  it("landing on the stage crosses it", () => {
    expect(crossesContractSigned(STAGES, at("new"), at("cs"))).toBe(true);
  });

  it("jumping past the stage crosses it too", () => {
    expect(crossesContractSigned(STAGES, at("new"), at("install"))).toBe(true);
  });

  it("a brand-new deal starting at or past it crosses it", () => {
    expect(crossesContractSigned(STAGES, null, at("permit"))).toBe(true);
  });

  it("moving before the line does not", () => {
    expect(crossesContractSigned(STAGES, null, at("new"))).toBe(false);
  });

  it("a deal already over the line moves on freely", () => {
    expect(crossesContractSigned(STAGES, at("cs"), at("install"))).toBe(false);
    expect(crossesContractSigned(STAGES, at("install"), at("permit"))).toBe(false);
  });

  it("cancelling is never gated", () => {
    expect(crossesContractSigned(STAGES, at("new"), at("lost"))).toBe(false);
  });

  it("reopening a cancelled deal into a live stage past the line has to earn it again", () => {
    expect(crossesContractSigned(STAGES, at("lost"), at("permit"))).toBe(true);
  });

  it("a pipeline with no marked stage has no line", () => {
    const unmarked = STAGES.map((s) => ({ ...s, milestone: null }));
    expect(crossesContractSigned(unmarked, at("new"), at("install"))).toBe(false);
  });
});

describe("both documents, not either", () => {
  const cases: [string, { signedProposal: boolean; contractPackage: boolean; contractFile: boolean }, boolean][] = [
    ["neither", NO_EVIDENCE, false],
    ["signed proposal only", { signedProposal: true, contractPackage: false, contractFile: false }, false],
    ["completed contract only", { signedProposal: false, contractPackage: true, contractFile: false }, false],
    ["both (Anexa e-signed contract)", { signedProposal: true, contractPackage: true, contractFile: false }, true],
    ["both (Amos contract filed into Contract)", { signedProposal: true, contractPackage: false, contractFile: true }, true],
    ["Amos contract filed, no signed proposal", { signedProposal: false, contractPackage: false, contractFile: true }, false],
  ];
  for (const [label, evidence, met] of cases) {
    it(`${label} → ${met ? "met" : "not met"}`, () => {
      expect(contractSignedMet(evidence)).toBe(met);
      expect(contractSignedMissing(evidence) === null).toBe(met);
    });
  }

  it("names exactly what is missing", () => {
    expect(contractSignedMissing({ signedProposal: true, contractPackage: false, contractFile: false }))
      .toMatch(/Still missing: a completed contract in the Contract folder/);
    const onlyContract = contractSignedMissing({ signedProposal: false, contractPackage: true, contractFile: false })!;
    expect(onlyContract).toMatch(/signature on the proposal/);
    expect(onlyContract).not.toMatch(/Contract folder/);
  });
});
