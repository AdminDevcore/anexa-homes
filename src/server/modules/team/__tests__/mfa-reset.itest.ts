import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { Role } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";

/**
 * REMOVING SOMEBODY'S SECOND FACTOR — through the door, not the module.
 *
 * mfa.itest.ts covers `resetEnrollment` itself. This covers the only thing a
 * real person can reach: the action. That distinction is the whole reason this
 * slice exists — enrolment was fully tested at module level for weeks while
 * being impossible to perform, because the tests called past the product.
 *
 * The three rules, and where each is enforced, are what these cases pin down:
 *
 *   • `Not allowed.`      — the ACTION's gate, `can(…, "update", "User")`;
 *   • `User not found.`   — the ACTION's tenant resolution, so an id typed by
 *                           the browser cannot name somebody else's user;
 *   • owner-only and self-removal — the MODULE, which is why an ADMIN is
 *                           refused here despite holding `User:update` and
 *                           sailing straight through the action's gate.
 *
 * That last one is the point of the admin case below. If owner-only ever gets
 * "simplified" into the action's `can()` call, an admin starts being able to
 * strip the control that guards money movement, and this is what fails.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const session = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/server/auth/session", () => session);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { resetMemberMfaAction } = await import("../actions");
const { beginEnrollment, confirmEnrollment, isMfaEnrolled } = await import("@/server/auth/mfa");
const { totp } = await import("@/server/lib/totp");

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

const rand = () => Math.random().toString(36).slice(2, 8);

let companyId: string;
let otherCompanyId: string;
let ownerId: string;
let adminId: string;
let repId: string;
let targetId: string;
let foreignTargetId: string;

const member = (company: string, role: Role, tag: string) =>
  db.user.create({
    data: {
      companyId: company,
      email: `${tag}-${process.pid}-${rand()}@test.local`,
      passwordHash: "x",
      firstName: tag,
      lastName: "Member",
      role,
      verticals: ["roofing"],
    },
  });

/**
 * The actor must be a REAL user row: the audit entry's `actorId` is a foreign
 * key, so a fabricated session id would fail on insert rather than in the check
 * under test.
 */
function actAs(userId: string, role: Role) {
  session.requireUser.mockResolvedValue({
    userId,
    companyId,
    role,
    permissions: {},
    fullName: "Ola Owner",
  });
}

async function enrol(userId: string, company: string) {
  const begun = await beginEnrollment({ userId, companyId: company, accountEmail: `${userId}@t.local` });
  if (!begun.ok) throw new Error(begun.error);
  const done = await confirmEnrollment({ userId, code: totp(begun.secret) });
  if (!done.ok) throw new Error(done.error);
}

beforeAll(async () => {
  const a = await db.company.create({
    data: { name: "Reset Co", slug: `reset-${process.pid}-${Date.now()}-${rand()}` },
  });
  const b = await db.company.create({
    data: { name: "Other Co", slug: `reset-other-${process.pid}-${Date.now()}-${rand()}` },
  });
  companyId = a.id;
  otherCompanyId = b.id;
});

beforeEach(async () => {
  // Activity logs first: they reference the users about to go.
  await db.activityLog.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
  await db.user.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });

  ownerId = (await member(companyId, "super_admin", "owner")).id;
  adminId = (await member(companyId, "admin", "admin")).id;
  repId = (await member(companyId, "sales_rep", "rep")).id;
  targetId = (await member(companyId, "accounting", "target")).id;
  foreignTargetId = (await member(otherCompanyId, "accounting", "foreign")).id;

  await enrol(targetId, companyId);
  await enrol(foreignTargetId, otherCompanyId);

  actAs(ownerId, "super_admin");
});

afterAll(async () => {
  await db.activityLog.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
  await db.user.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
  await db.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
  await db.$disconnect();
});

describe("the lost-phone path", () => {
  it("lets the owner remove a factor, so a new one can be set up", async () => {
    expect(await isMfaEnrolled(targetId)).toBe(true);

    const res = await resetMemberMfaAction(targetId);
    expect(res.ok, "the owner was refused").toBe(true);
    if (res.ok) expect(res.removed).toBe(true);

    expect(await isMfaEnrolled(targetId)).toBe(false);
  });

  it("records who did it, because nothing else about a team change is audited", async () => {
    await resetMemberMfaAction(targetId);

    const log = await db.activityLog.findFirst({
      where: { companyId, actorId: ownerId },
      orderBy: { createdAt: "desc" },
    });
    expect(log, "no audit row was written").not.toBeNull();
    expect(log!.message).toContain("authenticator");
    expect(log!.metadata).toMatchObject({ subjectUserId: targetId, removed: true });
  });

  /** Nothing to remove is not an error — but it must not claim it removed one. */
  it("is honest when there was no factor to remove", async () => {
    const res = await resetMemberMfaAction(repId);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.removed).toBe(false);

    const log = await db.activityLog.findFirst({
      where: { companyId, actorId: ownerId },
      orderBy: { createdAt: "desc" },
    });
    expect(log!.metadata).toMatchObject({ removed: false });
  });
});

describe("who may remove one", () => {
  /**
   * The case that matters most. An admin HOLDS `User:update`, so the action's
   * own gate lets them through — the refusal can only come from the module.
   */
  it("refuses an admin, even though the action's gate admits them", async () => {
    actAs(adminId, "admin");

    const res = await resetMemberMfaAction(targetId);
    expect(res.ok, "an admin stripped a second factor").toBe(false);
    if (!res.ok) expect(res.error).not.toBe("Not allowed.");

    expect(await isMfaEnrolled(targetId)).toBe(true);
  });

  it("refuses a sales rep at the action's own gate", async () => {
    actAs(repId, "sales_rep");

    const res = await resetMemberMfaAction(targetId);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Not allowed.");

    expect(await isMfaEnrolled(targetId)).toBe(true);
  });

  /**
   * A factor you can remove yourself protects nothing: anyone holding a live
   * session would strip it before moving money.
   */
  it("refuses an owner removing their own", async () => {
    await enrol(ownerId, companyId);
    actAs(ownerId, "super_admin");

    const res = await resetMemberMfaAction(ownerId);
    expect(res.ok).toBe(false);

    expect(await isMfaEnrolled(ownerId)).toBe(true);
  });
});

describe("the tenant boundary", () => {
  /**
   * The id comes from the browser. Resolving it through the caller's own
   * company is what stops it naming a stranger — and the module's WHERE clause
   * is a second lock behind it.
   */
  it("cannot name a user in another company", async () => {
    const res = await resetMemberMfaAction(foreignTargetId);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("User not found.");

    expect(
      await isMfaEnrolled(foreignTargetId),
      "another company's second factor was removed"
    ).toBe(true);
  });

  it("writes no audit row for a target it refused", async () => {
    await resetMemberMfaAction(foreignTargetId);
    expect(await db.activityLog.count({ where: { companyId } })).toBe(0);
  });
});
