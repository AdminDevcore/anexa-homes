import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";

/**
 * THE BACKUP LIST AS ITS SCREEN SAVES IT.
 *
 * The profiles moved onto Settings → Solar → Backup when the Storage screen was
 * deleted, and with them the way they are edited: they were a rail of panels
 * with a Save each, and they are one list with one Save now. That Save works out
 * a DIFF and replays it through these two actions, which is the shape every
 * other list screen uses.
 *
 * Two things about that replay can only fail against a real database, so they
 * are asserted here rather than on the pure functions:
 *
 *   1. DELETES RUN FIRST. A profile is unique on (companyId, name), so renaming
 *      "Whole home" onto a name a row being deleted still holds collides — and
 *      the action returns that collision as an error rather than throwing, so a
 *      wrong order fails silently and leaves the list half-saved.
 *   2. RANK IS THE INDEX. The order on the screen is the order the customer's
 *      cover reads them in; rank 0 is the row it headlines. A reorder that does
 *      not write every moved row leaves two profiles claiming the same rank.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const session = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/server/auth/session", () => session);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { saveBackupProfileAction, deleteBackupProfileAction } = await import("../storage");
const { listBackupProfiles } = await import("../storage-queries");

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;

/** One row as the Backup tab holds it while it is being edited. */
type Row = { profileId: string | null; label: string; watts: string; active: boolean };

/**
 * What the tab's Save does, in the order it does it.
 *
 * Deliberately a copy of the component's `saveBackup`: the logic under test is
 * the ORDER and the rank arithmetic, and a test that imported the real thing
 * would need a DOM to reach it. Kept to the same shape so a change to one is
 * visible against the other.
 */
async function saveList(before: Row[], next: Row[]) {
  const kept = new Set(next.map((r) => r.profileId).filter(Boolean));
  for (const row of before) {
    if (kept.has(row.profileId)) continue;
    const res = await deleteBackupProfileAction({ id: row.profileId });
    if (!res.ok) return res;
  }
  for (const [rank, row] of next.entries()) {
    const res = await saveBackupProfileAction({
      ...(row.profileId ? { id: row.profileId } : {}),
      name: row.label.trim(),
      loadWatts: Math.round(Number(row.watts)),
      rank,
      isActive: row.active,
    });
    if (!res.ok) return res;
  }
  return { ok: true as const };
}

const asOwner = () =>
  session.requireUser.mockResolvedValue({
    userId: "owner-session",
    companyId,
    role: "super_admin",
    permissions: {},
  });

const current = async (): Promise<Row[]> =>
  (await listBackupProfiles(companyId, false)).map((p) => ({
    profileId: p.id,
    label: p.name,
    watts: String(p.loadWatts),
    active: p.isActive,
  }));

beforeAll(async () => {
  const company = await db.company.create({
    data: { name: "Backup Profiles Co", slug: `bp-${process.pid}-${Date.now()}` },
  });
  companyId = company.id;
  asOwner();
});

beforeEach(async () => {
  await db.solarBackupProfile.deleteMany({ where: { companyId } });
  await db.solarBackupProfile.createMany({
    data: [
      { companyId, name: "Essentials", loadWatts: 1000, rank: 0 },
      { companyId, name: "Essentials + AC", loadWatts: 3500, rank: 1 },
      { companyId, name: "Whole home", loadWatts: 5000, rank: 2 },
    ],
  });
  asOwner();
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

describe("the Backup tab's one Save", () => {
  it("adds a row, and the new profile lands at the rank it was dropped at", async () => {
    const before = await current();
    const next = [
      ...before,
      { profileId: null, label: "Medical equipment", watts: "600", active: true },
    ];
    expect(await saveList(before, next)).toMatchObject({ ok: true });

    const after = await listBackupProfiles(companyId, false);
    expect(after.map((p) => p.name)).toEqual([
      "Essentials",
      "Essentials + AC",
      "Whole home",
      "Medical equipment",
    ]);
    expect(after.map((p) => p.rank)).toEqual([0, 1, 2, 3]);
    expect(after[3].loadWatts).toBe(600);
  });

  it("reorders, and every moved row's rank follows its position", async () => {
    const before = await current();
    const next = [before[2], before[0], before[1]];
    expect(await saveList(before, next)).toMatchObject({ ok: true });

    // Rank order IS the order the customer's cover reads them in, so the list
    // comes back in the new order rather than the one it was created in.
    const after = await listBackupProfiles(companyId);
    expect(after.map((p) => p.name)).toEqual(["Whole home", "Essentials", "Essentials + AC"]);
    expect(after.map((p) => p.rank)).toEqual([0, 1, 2]);
  });

  it("renames a row onto the name of one being deleted in the same Save", async () => {
    // The collision this proves is not hypothetical: (companyId, name) is
    // unique, and the action answers a clash with an error rather than an
    // exception — so a Save that wrote before it deleted would report
    // "There is already a profile called ..." and stop half-way.
    const before = await current();
    const next = [
      { ...before[0], label: "Whole home" },
      before[1],
    ];
    expect(await saveList(before, next)).toMatchObject({ ok: true });

    const after = await listBackupProfiles(companyId, false);
    expect(after.map((p) => p.name)).toEqual(["Whole home", "Essentials + AC"]);
    // The renamed row is the ORIGINAL row, not a new one: the id survived.
    expect(after[0].id).toBe(before[0].profileId);
    expect(after[0].loadWatts).toBe(1000);
  });

  it("switches a profile off without deleting it, and off it stays off customer reads", async () => {
    const before = await current();
    const next = before.map((r, i) => (i === 1 ? { ...r, active: false } : r));
    expect(await saveList(before, next)).toMatchObject({ ok: true });

    expect((await listBackupProfiles(companyId, false)).map((p) => p.name)).toHaveLength(3);
    // What a proposal reads: the retired one is not offered.
    expect((await listBackupProfiles(companyId)).map((p) => p.name)).toEqual([
      "Essentials",
      "Whole home",
    ]);
  });

  it("lets the last profile go — readiness is what says so, not a refusal here", async () => {
    const before = await current();
    expect(await saveList(before, [])).toMatchObject({ ok: true });
    expect(await listBackupProfiles(companyId, false)).toEqual([]);
  });

  it("refuses a load of zero, because hours are capacity divided by it", async () => {
    const before = await current();
    const res = await saveList(before, [{ ...before[0], watts: "0" }]);
    expect(res.ok).toBe(false);
  });

  it("writes nothing for another company, whatever the session says", async () => {
    // The actions take no companyId: they resolve it from the session, which is
    // the whole reason they are allowed to be server actions at all.
    const other = await db.company.create({
      data: { name: "Someone Else", slug: `else-${process.pid}-${Date.now()}` },
    });
    const theirs = await db.solarBackupProfile.create({
      data: { companyId: other.id, name: "Theirs", loadWatts: 2000, rank: 0 },
    });

    const res = await saveBackupProfileAction({
      id: theirs.id,
      name: "Hijacked",
      loadWatts: 9000,
      rank: 0,
      isActive: true,
    });
    expect(res.ok).toBe(false);

    const untouched = await db.solarBackupProfile.findUnique({ where: { id: theirs.id } });
    expect(untouched?.name).toBe("Theirs");
    expect(untouched?.loadWatts).toBe(2000);

    await db.company.deleteMany({ where: { id: other.id } });
  });
});
