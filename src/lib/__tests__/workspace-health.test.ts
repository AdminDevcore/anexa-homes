import { describe, it, expect } from "vitest";
import { SETUP_CHECKS, checksFor } from "../../server/modules/settings/workspace-health";
import { VERTICALS } from "../vertical";
import { SETTINGS_SECTIONS } from "../settings-sections";

describe("workspace setup checks", () => {
  it("has unique keys", () => {
    const keys = SETUP_CHECKS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("shares its key with the card it points at", () => {
    // The hub renders a gap ON its own card — the lead-sources warning sits on
    // the Lead Sources card, where it can be acted on — and it finds that card
    // by key. A check whose key drifts from its section's would still count
    // towards the banner and then have nowhere to show up.
    for (const check of SETUP_CHECKS) {
      const section = SETTINGS_SECTIONS.find((s) => s.href === check.href);
      if (!section) continue; // /portal/documents: covered by the href test above
      expect(check.key, `${check.key} points at the "${section.title}" card`).toBe(section.key);
    }
  });

  it("only offers a workspace links it can actually open", () => {
    // A gap that sends you to a page hidden in this workspace is worse than no
    // gap at all — you would be told to fix something you cannot reach.
    const hrefs = new Set(
      SETTINGS_SECTIONS.filter((s) => s.href).map((s) => s.href as string)
    );
    for (const check of SETUP_CHECKS) {
      // /portal/documents is a top-level page, not a settings card.
      if (check.href === "/portal/documents") continue;
      expect(hrefs, `${check.key} -> ${check.href}`).toContain(check.href);

      const section = SETTINGS_SECTIONS.find((s) => s.href === check.href)!;
      const shownIn = section.verticals ?? [...VERTICALS];
      const checkedIn = check.verticals ?? [...VERTICALS];
      for (const v of checkedIn) {
        expect(shownIn, `${check.key} is checked in ${v} but its page is hidden there`).toContain(v);
      }
    }
  });

  it("gives every vertical a blocking check, so a dead workspace is never silent", () => {
    for (const v of VERTICALS) {
      expect(checksFor(v).some((c) => c.severity === "blocking")).toBe(true);
    }
  });

  it("states a consequence rather than a row count", () => {
    for (const check of SETUP_CHECKS) {
      expect(check.hint.length).toBeGreaterThan(20);
      expect(check.hint).not.toMatch(/\b0 rows?\b|\bempty table\b/i);
    }
  });
});
