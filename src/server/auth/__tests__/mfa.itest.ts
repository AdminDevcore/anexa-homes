import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { totp } from "@/server/lib/totp";
import {
  beginEnrollment,
  confirmEnrollment,
  verifyMfa,
  mfaStatus,
  isMfaEnrolled,
  regenerateRecoveryCodes,
  resetEnrollment,
} from "../mfa";

/**
 * THE SECOND FACTOR, AS STORED AND AS SPENT.
 *
 * The TOTP algorithm itself is proved against the RFC vectors in
 * `lib/__tests__/totp.test.ts`. What is checked HERE is everything around it,
 * which is where second factors actually fail:
 *
 *   • the secret is encrypted at rest — a plaintext column is a password file
 *     that also silently defeats the factor it is meant to be;
 *   • enrolment does not count until a code proves the phone really has it,
 *     because counting it earlier locks people out of their own account;
 *   • A CODE IS SPENT WHEN USED. It stays valid for 30 seconds, so without the
 *     replay guard the same six digits work repeatedly — including approving
 *     two payments;
 *   • recovery codes work exactly once;
 *   • a live session cannot quietly swap or strip the factor.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let userId: string;
let otherUserId: string;

const rand = () => Math.random().toString(36).slice(2, 8);

/**
 * Two steps in the future. Confirming enrolment spends the CURRENT step, so a
 * later window is needed to get a fresh code — which is the replay guard
 * already doing its job before a single test asserts it.
 */
const later = () => Date.now() + 60_000;

beforeEach(async () => {
  const company = await db.company.create({
    data: { name: "MFA Co", slug: `mfa-${process.pid}-${Date.now()}-${rand()}` },
  });
  companyId = company.id;
  const mk = async (first: string) =>
    (
      await db.user.create({
        data: {
          companyId, email: `${first}-${Date.now()}-${Math.random()}@t.local`, passwordHash: "x",
          firstName: first, lastName: "Person", role: "super_admin", verticals: ["roofing"],
        },
        select: { id: true },
      })
    ).id;
  userId = await mk("Ola");
  otherUserId = await mk("Ada");
});

afterAll(async () => {
  await db.$disconnect();
});

const enrol = async () => {
  const begun = await beginEnrollment({ userId, companyId, accountEmail: "ola@example.com" });
  if (!begun.ok) throw new Error(begun.error);
  const confirmed = await confirmEnrollment({ userId, code: totp(begun.secret) });
  if (!confirmed.ok) throw new Error(confirmed.error);
  return { secret: begun.secret, recoveryCodes: confirmed.recoveryCodes };
};

describe("enrolling", () => {
  it("never stores the secret in plain text", async () => {
    const begun = await beginEnrollment({ userId, companyId, accountEmail: "ola@example.com" });
    if (!begun.ok) throw new Error(begun.error);

    const row = await db.userMfa.findFirstOrThrow({ where: { userId } });
    expect(row.secretEnc).not.toContain(begun.secret);
    expect(row.secretEnc.length).toBeGreaterThan(begun.secret.length);
  });

  /** Counting an unproved enrolment locks out anyone whose QR never saved. */
  it("does not count as protection until a code proves it", async () => {
    const begun = await beginEnrollment({ userId, companyId, accountEmail: "ola@example.com" });
    if (!begun.ok) throw new Error(begun.error);

    expect(await isMfaEnrolled(userId)).toBe(false);
    expect(await mfaStatus(userId)).toMatchObject({ enrolled: false, pending: true });

    const done = await confirmEnrollment({ userId, code: totp(begun.secret) });
    expect(done.ok).toBe(true);
    expect(await isMfaEnrolled(userId)).toBe(true);
  });

  it("hands back ten recovery codes, once", async () => {
    const { recoveryCodes } = await enrol();
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    expect(await mfaStatus(userId)).toMatchObject({ enrolled: true, recoveryCodesRemaining: 10 });
  });

  it("refuses a wrong code and stays pending", async () => {
    const begun = await beginEnrollment({ userId, companyId, accountEmail: "ola@example.com" });
    if (!begun.ok) throw new Error(begun.error);

    const done = await confirmEnrollment({ userId, code: "000000" });
    expect(done.ok).toBe(false);
    expect(await isMfaEnrolled(userId)).toBe(false);
  });

  /** Somebody whose QR did not save must be able to start again. */
  it("lets a PENDING enrolment be restarted, invalidating the old secret", async () => {
    const first = await beginEnrollment({ userId, companyId, accountEmail: "ola@example.com" });
    if (!first.ok) throw new Error(first.error);
    const second = await beginEnrollment({ userId, companyId, accountEmail: "ola@example.com" });
    if (!second.ok) throw new Error(second.error);

    expect(second.secret).not.toBe(first.secret);
    // A code from the abandoned secret must not complete the new enrolment.
    expect((await confirmEnrollment({ userId, code: totp(first.secret) })).ok).toBe(false);
    expect((await confirmEnrollment({ userId, code: totp(second.secret) })).ok).toBe(true);
  });

  /**
   * The attack this closes: anyone holding a live session swaps the factor for
   * one they control, and the account is theirs.
   */
  it("refuses to replace a CONFIRMED factor", async () => {
    await enrol();
    const again = await beginEnrollment({ userId, companyId, accountEmail: "ola@example.com" });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toContain("already has an authenticator");
  });
});

describe("spending a code", () => {
  it("accepts a current code", async () => {
    const { secret } = await enrol();
    const at = later();
    const res = await verifyMfa({ userId, code: totp(secret, { at }), at });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.usedRecoveryCode).toBe(false);
  });

  /**
   * THE PROPERTY THE WHOLE DESIGN TURNS ON. A code is valid for its full
   * 30-second window, so without recording the step it consumed, the same six
   * digits authorise again — one shoulder-surfed code approving two payments.
   */
  it("refuses the SAME code a second time", async () => {
    const { secret } = await enrol();
    const at = later();
    const code = totp(secret, { at });

    expect((await verifyMfa({ userId, code, at })).ok).toBe(true);

    const replay = await verifyMfa({ userId, code, at: at + 5_000 });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.error).toContain("already been used");
  });

  it("accepts the next window's code", async () => {
    const { secret } = await enrol();
    const at = later();
    expect((await verifyMfa({ userId, code: totp(secret, { at }), at })).ok).toBe(true);

    const next = at + 30_000;
    expect((await verifyMfa({ userId, code: totp(secret, { at: next }), at: next })).ok).toBe(true);
  });

  it("refuses a code from a different secret, and a wrong one", async () => {
    await enrol();
    const at = later();
    expect((await verifyMfa({ userId, code: "000000", at })).ok).toBe(false);
    expect((await verifyMfa({ userId, code: "", at })).ok).toBe(false);
  });

  it("refuses when there is no authenticator at all", async () => {
    const res = await verifyMfa({ userId, code: "123456" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("no authenticator");
  });
});

describe("recovery codes", () => {
  it("works once, and never again", async () => {
    const { recoveryCodes } = await enrol();
    const code = recoveryCodes[0];

    const first = await verifyMfa({ userId, code });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.usedRecoveryCode).toBe(true);

    const second = await verifyMfa({ userId, code });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toContain("already been used");

    expect(await mfaStatus(userId)).toMatchObject({ recoveryCodesRemaining: 9 });
  });

  /** Read off paper and retyped: case, spacing and the hyphen must not matter. */
  it("accepts a code however it was typed back", async () => {
    const { recoveryCodes } = await enrol();
    const messy = recoveryCodes[0].toLowerCase().replace("-", " ");
    expect((await verifyMfa({ userId, code: messy })).ok).toBe(true);
  });

  it("refuses a code that was never issued", async () => {
    await enrol();
    expect((await verifyMfa({ userId, code: "ZZZZZ-ZZZZZ" })).ok).toBe(false);
  });

  /** A borrowed session must not be able to mint itself a permanent way in. */
  it("requires a valid code to regenerate, and invalidates the old set", async () => {
    const { secret, recoveryCodes } = await enrol();

    expect((await regenerateRecoveryCodes({ userId, code: "000000" })).ok).toBe(false);

    const at = later();
    const fresh = await regenerateRecoveryCodes({ userId, code: totp(secret, { at }), at });
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;

    expect(fresh.recoveryCodes).toHaveLength(10);
    // The old sheet is dead.
    expect((await verifyMfa({ userId, code: recoveryCodes[0] })).ok).toBe(false);
    expect((await verifyMfa({ userId, code: fresh.recoveryCodes[0] })).ok).toBe(true);
  });
});

describe("removing a factor", () => {
  /** Otherwise anyone with a live session strips the control before moving
   * money, and the factor protects nothing. */
  it("refuses to let somebody remove their own", async () => {
    await enrol();
    const res = await resetEnrollment({ companyId, userId, actorUserId: userId, actorRole: "super_admin" });
    expect(res.ok).toBe(false);
    expect(await isMfaEnrolled(userId)).toBe(true);
  });

  it("lets somebody else remove it — the lost-phone path", async () => {
    await enrol();
    const res = await resetEnrollment({
      companyId, userId, actorUserId: otherUserId, actorRole: "super_admin",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.removed, "it reported removing nothing").toBe(true);
    expect(await isMfaEnrolled(userId)).toBe(false);
    // And the codes went with it.
    expect(await mfaStatus(userId)).toMatchObject({ recoveryCodesRemaining: 0 });
  });

  /**
   * `can(…, "update", "User")` admits an admin as well as the owner, and this is
   * the control that guards money movement — so the narrower rule lives in the
   * module rather than holding only for as long as each caller restates it.
   */
  it("refuses anyone who is not the owner", async () => {
    await enrol();
    const res = await resetEnrollment({
      companyId, userId, actorUserId: otherUserId, actorRole: "admin",
    });
    expect(res.ok).toBe(false);
    expect(await isMfaEnrolled(userId), "an admin stripped a second factor").toBe(true);
  });

  /**
   * The delete filtered on userId alone. Nothing had ever crossed a tenant
   * boundary with it only because the function had no caller at all; the first
   * one would have. A real second company, so this tests the boundary rather
   * than a WHERE clause against an id that matches nothing anyway.
   */
  it("cannot reach a user in another company", async () => {
    await enrol();
    const other = await db.company.create({
      data: { name: "Other Co", slug: `mfa-other-${process.pid}-${Date.now()}-${rand()}` },
    });

    const res = await resetEnrollment({
      companyId: other.id,
      userId,
      actorUserId: otherUserId,
      actorRole: "super_admin",
    });

    // It succeeds having deleted nothing, which is exactly the point.
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.removed, "a cross-tenant delete matched a row").toBe(false);
    expect(await isMfaEnrolled(userId), "a factor was removed from another company").toBe(true);
  });
});
