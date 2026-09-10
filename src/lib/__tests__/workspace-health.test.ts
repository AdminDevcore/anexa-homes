import { describe, it, expect } from "vitest";
import { SETUP_CHECKS, checksFor } from "../../server/modules/settings/workspace-health";
import { VERTICALS } from "../vertical";
import { SETTINGS_SECTIONS, gapBelongsInWorkspace } from "../settings-sections";

/**
 * Pages a check may point at that are not Settings cards.
 *
 * `/portal/team` is where a solar rep's per-battery rate lives — a field on his
 * own profile, so no settings screen owns it. It briefly had a "Rep Pay" card in
 * the menu that only linked out to Team; that card is gone.
 */
const OUTSIDE_SETTINGS = ["/portal/documents", "/portal/team"];

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
      if (!section) continue; // Not a settings card — covered by the href test below.
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
      // Top-level pages, not settings cards. Both are open to every workspace,
      // which is the only reason a check is allowed to point out of Settings:
      // there is no card whose `verticals` could hide the destination.
      if (OUTSIDE_SETTINGS.includes(check.href)) continue;
      expect(hrefs, `${check.key} -> ${check.href}`).toContain(check.href);

      const section = SETTINGS_SECTIONS.find((s) => s.href === check.href)!;
      const shownIn = section.verticals ?? [...VERTICALS];
      const checkedIn = check.verticals ?? [...VERTICALS];
      for (const v of checkedIn) {
        expect(shownIn, `${check.key} is checked in ${v} but its page is hidden there`).toContain(v);
      }
    }
  });

  it("shows every check it runs — nothing is counted and then filtered away", () => {
    // The two halves have to agree. `checksFor` decides what a workspace is
    // WARNED about; `gapBelongsInWorkspace` decides what the hub RENDERS. A check
    // that clears the first and fails the second is the worst outcome available:
    // the workspace has a real gap, the app knows it, and says nothing.
    //
    // That is precisely what happened when three storage checks were keyed by
    // what they counted instead of by their card. It is also what deleting the
    // Rep Pay card would have done to the per-battery pay warning, had the rule
    // stayed "keep only gaps whose key names a visible card".
    for (const v of VERTICALS) {
      for (const check of checksFor(v)) {
        expect(
          gapBelongsInWorkspace(check.key, v),
          `${check.key} is checked in ${v} but the hub would drop it`
        ).toBe(true);
      }
    }
  });

  it("keeps a gap that has no card to be keyed to", () => {
    // Per-battery rep pay is a field on each person's Team profile — no settings
    // screen owns it, so its key names no card. It must survive the hub's filter
    // on that basis rather than by borrowing an unrelated card's key.
    //
    // Note this is NOT the same set as OUTSIDE_SETTINGS: Document Templates also
    // points out of Settings, but it has a card in the menu that links out, so it
    // is keyed to that card like any other gap.
    const cardless = SETUP_CHECKS.filter((c) => !SETTINGS_SECTIONS.some((s) => s.key === c.key));

    // If this ever hits zero the two tests above go vacuous, and the rule they
    // protect would be free to regress unnoticed.
    expect(cardless.map((c) => c.key)).toContain("solar_pay");

    for (const check of cardless) {
      expect(OUTSIDE_SETTINGS, `${check.key} has no card, so it must point out of Settings`)
        .toContain(check.href);
      for (const v of check.verticals ?? [...VERTICALS]) {
        expect(gapBelongsInWorkspace(check.key, v)).toBe(true);
      }
    }
  });

  it("still drops a gap whose card this workspace hides", () => {
    // The other direction, so the rule above cannot be loosened into "keep
    // everything". Scope of Work is roofing-only, and its gap must not appear in
    // a solar workspace that has no such screen to open.
    expect(gapBelongsInWorkspace("scope_template", "roofing")).toBe(true);
    expect(gapBelongsInWorkspace("scope_template", "solar")).toBe(false);
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
