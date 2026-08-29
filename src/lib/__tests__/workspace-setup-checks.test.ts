import { describe, it, expect } from "vitest";
import { SETUP_CHECKS, checksFor } from "@/server/modules/settings/workspace-health";

/**
 * The gap list is a promise that the app will announce its own empty tables.
 *
 * Tested at the SHAPE level rather than by counting rows: the counts need a
 * database, but the thing that actually breaks is a check pointing at a screen
 * that does not exist, or a solar-only check leaking into roofing, and neither
 * needs one.
 */
describe("workspace setup checks", () => {
  it("has no duplicate keys — a gap lands on its card by key", () => {
    const keys = SETUP_CHECKS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every check points somewhere in the portal", () => {
    for (const c of SETUP_CHECKS) {
      expect(c.href.startsWith("/portal")).toBe(true);
    }
  });

  it("every hint says what goes wrong, not that a table is empty", () => {
    for (const c of SETUP_CHECKS) {
      expect(c.hint.length).toBeGreaterThan(20);
      expect(c.hint.toLowerCase()).not.toContain("no rows");
    }
  });

  it("the storage checks are solar-only", () => {
    // A roofing workspace with no battery lenders is not misconfigured, and a
    // warning nobody can ever clear is a warning everybody learns to ignore.
    const roofing = checksFor("roofing").map((c) => c.key);
    for (const key of [
      "solar_backup_profiles",
      "solar_storage_lenders",
      "solar_storage_redline",
    ]) {
      expect(roofing).not.toContain(key);
    }
  });

  it("the storage checks reach solar", () => {
    const solar = checksFor("solar").map((c) => c.key);
    expect(solar).toContain("solar_backup_profiles");
    expect(solar).toContain("solar_storage_lenders");
    expect(solar).toContain("solar_storage_redline");
  });

  it("none of the storage checks blocks — a panels-only company is fine", () => {
    const storage = SETUP_CHECKS.filter((c) => c.key.startsWith("solar_storage") || c.key === "solar_backup_profiles");
    expect(storage).toHaveLength(3);
    for (const c of storage) expect(c.severity).toBe("silent");
  });
});
