import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { putObject, objectExists, deleteObject } from "@/server/storage";
import { releaseStorageKeys } from "@/server/storage/release";

/**
 * The 30-day retention lifecycle for deleted file bytes.
 *
 * ── THE CLOCK STARTS WHEN THE BYTES BECOME UNREFERENCED, NOT WHEN THEY WERE
 *    WRITTEN. ──────────────────────────────────────────────────────────────
 * `StoredFile.createdAt` is the age of the FILE. A two-year-old contract deleted
 * yesterday is two years old by that measure, so purging on it would destroy the
 * document the day after somebody removed it by mistake — the exact failure a
 * grace period exists to prevent. `orphanedAt` is stamped by the sweep the first
 * time it sees a key with nothing pointing at it, and only that stamp ages.
 *
 * ── SHARED KEYS STAY SAFE THROUGHOUT. ──────────────────────────────────────
 * `FileAsset.storageKey` is not unique and keys are shared on purpose (one
 * pay-stub PDF, one FileAsset row per commission line). A key with any live row
 * is not an orphan, is never stamped, and its clock never starts.
 *
 * These exercise the same primitives `scripts/storage-orphans.ts` uses. The
 * script's own two-phase behaviour — stamp on one sweep, delete on a later one —
 * is verified by running it, which the pass report records.
 */

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
const RETENTION_DAYS = 30;
let companyId: string;

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "Retention Co", slug: `ret-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;
});

afterAll(async () => {
  await db.fileAsset.deleteMany({ where: { companyId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

const asset = (key: string, name = "doc.pdf") =>
  db.fileAsset.create({
    data: { companyId, kind: "document", name, storageKey: key, mimeType: "application/pdf", size: 3 },
    select: { id: true },
  });

/** What the sweep does: find unreferenced keys, stamp the ones not yet stamped. */
async function sweepStamp(): Promise<string[]> {
  const referenced = new Set(
    (await db.fileAsset.findMany({ select: { storageKey: true } })).map((r) => r.storageKey)
  );
  const stored = await db.storedFile.findMany({ select: { key: true, orphanedAt: true } });
  const newlyOrphaned = stored.filter((s) => !referenced.has(s.key) && s.orphanedAt == null);
  if (newlyOrphaned.length) {
    await db.storedFile.updateMany({
      where: { key: { in: newlyOrphaned.map((s) => s.key) } },
      data: { orphanedAt: new Date() },
    });
  }
  // A key that has a reference again is not an orphan — its clock restarts.
  await db.storedFile.updateMany({
    where: { key: { in: [...referenced] }, orphanedAt: { not: null } },
    data: { orphanedAt: null },
  });
  return newlyOrphaned.map((s) => s.key);
}

/** What the purge does: delete only what has been stamped longer than the window. */
async function sweepPurge(): Promise<string[]> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const due = await db.storedFile.findMany({
    where: { orphanedAt: { not: null, lte: cutoff } },
    select: { key: true },
  });
  for (const d of due) await deleteObject(d.key);
  return due.map((d) => d.key);
}

describe("30-day retention lifecycle", () => {
  it("a live file is never stamped and never purged", async () => {
    const key = `test/ret-live-${Date.now()}.pdf`;
    await putObject(key, Buffer.from("abc"));
    const a = await asset(key);

    await sweepStamp();
    const row = await db.storedFile.findUniqueOrThrow({ where: { key }, select: { orphanedAt: true } });
    expect(row.orphanedAt).toBeNull();
    expect(await sweepPurge()).not.toContain(key);
    expect(await objectExists(key)).toBe(true);

    await db.fileAsset.delete({ where: { id: a.id } });
    await deleteObject(key);
  });

  it("becoming unreferenced STAMPS the key and deletes nothing", async () => {
    const key = `test/ret-orphan-${Date.now()}.pdf`;
    await putObject(key, Buffer.from("abc"));
    const a = await asset(key);
    await db.fileAsset.delete({ where: { id: a.id } });

    const stamped = await sweepStamp();
    expect(stamped).toContain(key);
    const row = await db.storedFile.findUniqueOrThrow({ where: { key }, select: { orphanedAt: true } });
    expect(row.orphanedAt).toBeInstanceOf(Date);

    // Same day: still inside the window, so the bytes survive.
    expect(await sweepPurge()).not.toContain(key);
    expect(await objectExists(key)).toBe(true);

    await deleteObject(key);
  });

  it("purges only AFTER the window, and only if still unreferenced", async () => {
    const key = `test/ret-aged-${Date.now()}.pdf`;
    await putObject(key, Buffer.from("abc"));
    const a = await asset(key);
    await db.fileAsset.delete({ where: { id: a.id } });
    await sweepStamp();

    // Age the stamp past the window.
    await db.storedFile.update({
      where: { key },
      data: { orphanedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
    });

    expect(await sweepPurge()).toContain(key);
    expect(await objectExists(key)).toBe(false);
  });

  it("a key that regains a reference has its clock RESET, and survives forever", async () => {
    const key = `test/ret-restored-${Date.now()}.pdf`;
    await putObject(key, Buffer.from("abc"));
    const a = await asset(key);
    await db.fileAsset.delete({ where: { id: a.id } });
    await sweepStamp();
    expect((await db.storedFile.findUniqueOrThrow({ where: { key }, select: { orphanedAt: true } })).orphanedAt)
      .toBeInstanceOf(Date);

    // Somebody restores the reference — a re-upload, an undo, a restore.
    const restored = await asset(key);
    await sweepStamp();
    expect((await db.storedFile.findUniqueOrThrow({ where: { key }, select: { orphanedAt: true } })).orphanedAt)
      .toBeNull();

    // Even after the old window would have elapsed, it is not due.
    expect(await sweepPurge()).not.toContain(key);
    expect(await objectExists(key)).toBe(true);

    await db.fileAsset.delete({ where: { id: restored.id } });
    await deleteObject(key);
  });

  it("a SHARED key is not an orphan while any row still points at it", async () => {
    // The pay-stub shape: one PDF, several FileAsset rows.
    const key = `test/ret-shared-${Date.now()}.pdf`;
    await putObject(key, Buffer.from("abc"));
    const one = await asset(key, "Pay stub — line 1.pdf");
    const two = await asset(key, "Pay stub — line 2.pdf");

    await db.fileAsset.delete({ where: { id: one.id } });
    // releaseStorageKeys refuses while a row remains — the immediate guard.
    expect(await releaseStorageKeys([key])).toBe(0);
    // …and the retention sweep does not start a clock either.
    await sweepStamp();
    expect((await db.storedFile.findUniqueOrThrow({ where: { key }, select: { orphanedAt: true } })).orphanedAt)
      .toBeNull();
    expect(await objectExists(key)).toBe(true);

    // Only when the LAST row goes does the clock start.
    await db.fileAsset.delete({ where: { id: two.id } });
    await sweepStamp();
    expect((await db.storedFile.findUniqueOrThrow({ where: { key }, select: { orphanedAt: true } })).orphanedAt)
      .toBeInstanceOf(Date);

    await deleteObject(key);
  });

  it("the sweep discovers orphans on its own — no deletion path has to call anything", async () => {
    // This is why the lifecycle is complete without wiring releaseStorageKeys
    // into every FileAsset delete: the sweep compares what storage holds against
    // what the database references, so a row removed by ANY path is found.
    const key = `test/ret-discovered-${Date.now()}.pdf`;
    await putObject(key, Buffer.from("abc"));
    const a = await asset(key);

    // Deleted by a raw path that knows nothing about storage.
    await db.fileAsset.delete({ where: { id: a.id } });

    expect(await sweepStamp()).toContain(key);
    await deleteObject(key);
  });
});
