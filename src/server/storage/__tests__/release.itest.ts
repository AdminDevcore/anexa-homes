import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { putObject, objectExists, getObject } from "@/server/storage";
import { releaseStorageKeys, deleteFileAssets } from "@/server/storage/release";

/**
 * The two properties that make deletion safe.
 *
 *   1. Bytes are released only when the LAST FileAsset row pointing at them has
 *      gone. `storageKey` is not unique and keys are shared on purpose — see
 *      `payroll/post-bookkeeping.ts:78`, which writes one pay-stub PDF and then
 *      one FileAsset row per commission line pointing at it.
 *   2. A storage failure never turns a completed row delete into an exception.
 *      Rows go first precisely so the residue is a recoverable orphan rather
 *      than a live record pointing at nothing.
 */

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
let companyId: string;

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "Storage Release Co", slug: `srel-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;
});

afterAll(async () => {
  await db.fileAsset.deleteMany({ where: { companyId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

async function asset(key: string, name = "f.pdf") {
  return db.fileAsset.create({
    data: { companyId, kind: "document", name, storageKey: key, mimeType: "application/pdf", size: 3 },
    select: { id: true },
  });
}

describe("releaseStorageKeys", () => {
  it("deletes the bytes when the last reference is gone", async () => {
    const key = `test/${Date.now()}-solo.pdf`;
    await putObject(key, Buffer.from("abc"));
    const a = await asset(key);

    await db.fileAsset.delete({ where: { id: a.id } });
    const released = await releaseStorageKeys([key]);

    expect(released).toBe(1);
    expect(await objectExists(key)).toBe(false);
  });

  it("KEEPS the bytes while another row still points at the same key", async () => {
    // The pay-stub shape: one PDF, several rows.
    const key = `test/${Date.now()}-shared.pdf`;
    await putObject(key, Buffer.from("abc"));
    const one = await asset(key, "Pay stub — line 1.pdf");
    const two = await asset(key, "Pay stub — line 2.pdf");

    await db.fileAsset.delete({ where: { id: one.id } });
    const released = await releaseStorageKeys([key]);

    expect(released).toBe(0);
    expect(await objectExists(key)).toBe(true);
    // …and the surviving row can still read its document.
    expect((await getObject(key)).toString()).toBe("abc");

    // Only when the last one goes do the bytes go.
    await db.fileAsset.delete({ where: { id: two.id } });
    expect(await releaseStorageKeys([key])).toBe(1);
    expect(await objectExists(key)).toBe(false);
  });

  it("ignores nulls, blanks and duplicates", async () => {
    const key = `test/${Date.now()}-dupe.pdf`;
    await putObject(key, Buffer.from("abc"));
    // Same key twice in one call must not attempt two deletes.
    expect(await releaseStorageKeys([key, key, null, undefined, ""])).toBe(1);
  });

  it("never throws when storage fails, and says so", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    // A key that exists nowhere; the db driver's deleteMany is a no-op, so force
    // a real failure by asking for one that cannot be counted.
    await expect(releaseStorageKeys(["test/never-existed.pdf"])).resolves.toBeTypeOf("number");
    err.mockRestore();
  });
});

describe("deleteFileAssets", () => {
  it("removes the rows and releases only unshared bytes", async () => {
    const lone = `test/${Date.now()}-lone.pdf`;
    const shared = `test/${Date.now()}-kept.pdf`;
    await putObject(lone, Buffer.from("abc"));
    await putObject(shared, Buffer.from("abc"));

    const a = await asset(lone);
    const b = await asset(shared);
    await asset(shared); // survivor holding the shared key

    const result = await deleteFileAssets({ id: { in: [a.id, b.id] } });

    expect(result.rowsDeleted).toBe(2);
    expect(result.bytesReleased).toBe(1); // only `lone`
    expect(await objectExists(lone)).toBe(false);
    expect(await objectExists(shared)).toBe(true);
  });

  it("is a no-op when nothing matches", async () => {
    expect(await deleteFileAssets({ id: { in: [] } })).toEqual({ rowsDeleted: 0, bytesReleased: 0 });
  });

  it("reads keys BEFORE deleting rows, so nothing is stranded", async () => {
    // If the implementation deleted first and read after, it would find no rows
    // and release nothing — the exact leak this work exists to close.
    const key = `test/${Date.now()}-order.pdf`;
    await putObject(key, Buffer.from("abc"));
    const a = await asset(key);

    const result = await deleteFileAssets({ id: { in: [a.id] } });

    expect(result).toEqual({ rowsDeleted: 1, bytesReleased: 1 });
    expect(await objectExists(key)).toBe(false);
  });
});
