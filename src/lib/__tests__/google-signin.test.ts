import { describe, expect, it } from "vitest";
import {
  GOOGLE_ERROR_COPY,
  decideGoogleSignIn,
  normalizeEmail,
  screenGoogleAttempt,
  type GoogleCandidate,
} from "../google-signin";

const staff = (over: Partial<GoogleCandidate> = {}): GoogleCandidate => ({
  id: "u1",
  email: "dana@anexahomes.com",
  status: "active",
  role: "sales_rep",
  ...over,
});

describe("screenGoogleAttempt", () => {
  it("normalizes the address before anything else looks at it", () => {
    const out = screenGoogleAttempt({ email: "  Dana@AnexaHomes.com " });
    expect(out).toEqual({ ok: true, email: "dana@anexahomes.com" });
  });

  it("refuses an attempt carrying no email", () => {
    for (const email of [null, undefined, "", "   "]) {
      expect(screenGoogleAttempt({ email })).toEqual({
        ok: false,
        reason: "google_email_missing",
      });
    }
  });

  // Without this, whoever controls a Google account on an unverified address
  // could claim the staff account holding that address.
  it("refuses an unverified Google address", () => {
    expect(screenGoogleAttempt({ email: "a@b.com", emailVerified: false })).toEqual({
      ok: false,
      reason: "google_email_unverified",
    });
  });

  it("treats an absent verified flag as acceptable, not as false", () => {
    // Google omits the claim in some flows. Refusing on absence would lock out
    // valid accounts for a signal that was never sent.
    expect(screenGoogleAttempt({ email: "a@b.com" }).ok).toBe(true);
    expect(screenGoogleAttempt({ email: "a@b.com", emailVerified: null }).ok).toBe(true);
  });

  describe("hosted-domain restriction", () => {
    it("lets the matching Workspace domain through", () => {
      const out = screenGoogleAttempt({
        email: "a@anexahomes.com",
        hostedDomain: "anexahomes.com",
        requiredHostedDomain: "anexahomes.com",
      });
      expect(out.ok).toBe(true);
    });

    it("refuses another domain", () => {
      expect(
        screenGoogleAttempt({
          email: "a@other.com",
          hostedDomain: "other.com",
          requiredHostedDomain: "anexahomes.com",
        })
      ).toEqual({ ok: false, reason: "google_domain_not_allowed" });
    });

    // A consumer Gmail carries no `hd` at all, so it fails by construction —
    // which is the point of turning the restriction on.
    it("refuses a personal account, which carries no hd", () => {
      expect(
        screenGoogleAttempt({
          email: "someone@gmail.com",
          hostedDomain: null,
          requiredHostedDomain: "anexahomes.com",
        })
      ).toEqual({ ok: false, reason: "google_domain_not_allowed" });
    });

    it("applies no restriction when none is configured", () => {
      expect(screenGoogleAttempt({ email: "someone@gmail.com" }).ok).toBe(true);
    });
  });
});

describe("decideGoogleSignIn", () => {
  const email = "dana@anexahomes.com";

  // The whole point: Google proves who you are, it does not enrol you.
  it("refuses an address with no user row — Google never creates one", () => {
    expect(decideGoogleSignIn(email, [])).toEqual({ ok: false, reason: "no_account" });
  });

  it("admits an active staff user", () => {
    expect(decideGoogleSignIn(email, [staff()])).toEqual({ ok: true, userId: "u1" });
  });

  // Accepting an invite by signing in with Google is a legitimate route, and
  // the credentials path admits `invited` too. They must agree.
  it("admits an invited user, matching the credentials path", () => {
    expect(decideGoogleSignIn(email, [staff({ status: "invited" })])).toEqual({
      ok: true,
      userId: "u1",
    });
  });

  it("separates a disabled account from a missing one", () => {
    for (const status of ["disabled", "suspended"]) {
      expect(decideGoogleSignIn(email, [staff({ status })])).toEqual({
        ok: false,
        reason: "account_inactive",
      });
    }
  });

  // "There is no customer portal" has to be a property of the system, not a
  // missing button — the credentials path refuses this role too.
  it("refuses a non-staff role", () => {
    expect(decideGoogleSignIn(email, [staff({ role: "customer" })])).toEqual({
      ok: false,
      reason: "account_not_staff",
    });
  });

  it("matches case-insensitively, since email is not uniquely cased", () => {
    expect(decideGoogleSignIn(email, [staff({ email: "Dana@AnexaHomes.com" })])).toEqual({
      ok: true,
      userId: "u1",
    });
  });

  it("breaks a tie on the exactly-matching address", () => {
    const out = decideGoogleSignIn(email, [
      staff({ id: "mixed", email: "Dana@AnexaHomes.com" }),
      staff({ id: "exact", email }),
    ]);
    expect(out).toEqual({ ok: true, userId: "exact" });
  });

  // Two accounts differing only by case, or the same address in two companies:
  // choosing one would be authenticating as the wrong person.
  it("refuses rather than guesses when several still match", () => {
    const out = decideGoogleSignIn(email, [
      staff({ id: "a", email: "Dana@AnexaHomes.com" }),
      staff({ id: "b", email: "DANA@anexahomes.com" }),
    ]);
    expect(out).toEqual({ ok: false, reason: "account_ambiguous" });
  });

  it("ignores unsignable rows when deciding ambiguity", () => {
    const out = decideGoogleSignIn(email, [
      staff({ id: "gone", status: "disabled" }),
      staff({ id: "live" }),
    ]);
    expect(out).toEqual({ ok: true, userId: "live" });
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  A@B.COM ")).toBe("a@b.com");
    expect(normalizeEmail(null)).toBe("");
  });
});

describe("GOOGLE_ERROR_COPY", () => {
  // Every refusal the gate can return has to be sayable, or the user lands on
  // an unchanged login form with nothing to read — the exact failure this
  // whole reason enum exists to prevent.
  it("has a distinct sentence for every denial reason", () => {
    const reasons = [
      "google_email_missing",
      "google_email_unverified",
      "google_domain_not_allowed",
      "no_account",
      "account_inactive",
      "account_not_staff",
      "account_ambiguous",
    ] as const;
    for (const r of reasons) {
      expect(GOOGLE_ERROR_COPY[r]?.length ?? 0).toBeGreaterThan(0);
    }
    expect(new Set(Object.values(GOOGLE_ERROR_COPY)).size).toBe(reasons.length);
  });

  it("never leaks which addresses exist to an anonymous visitor beyond the invite rule", () => {
    // The copy deliberately DOES say "no account uses that email" — this app is
    // invite-only and an admin has to add you, so that is the actionable truth
    // rather than an enumeration oracle worth hiding. Asserted so the choice is
    // deliberate rather than drifting.
    expect(GOOGLE_ERROR_COPY.no_account).toMatch(/ask an admin/i);
  });
});
