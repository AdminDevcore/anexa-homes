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
/**
 * The three storage gaps, BY THE CARD EACH LANDS ON.
 *
 * They were keyed by what they count — `solar_backup_profiles`,
 * `solar_storage_lenders`, `solar_storage_redline` — and the hub, which finds a
 * gap's card by key, silently dropped all three. A key here is a card id, and
 * workspace-health.test.ts is what holds the two lists to each other.
 *
 * The backup-profile gap lands on `solar_settings`: the profiles live on that
 * screen's Backup tab since the Storage card was deleted.
 */
const STORAGE_CHECKS = ["solar_settings", "solar_lenders", "solar_pay"];

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
    for (const key of STORAGE_CHECKS) {
      expect(roofing).not.toContain(key);
    }
  });

  it("the storage checks reach solar", () => {
    const solar = checksFor("solar").map((c) => c.key);
    for (const key of STORAGE_CHECKS) expect(solar).toContain(key);
  });

  it("none of the storage checks blocks — a panels-only company is fine", () => {
    const storage = SETUP_CHECKS.filter((c) => STORAGE_CHECKS.includes(c.key));
    expect(storage).toHaveLength(3);
    for (const c of storage) expect(c.severity).toBe("silent");
  });
});
