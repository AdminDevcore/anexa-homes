import { prisma } from "@/server/db/client";
import { deleteObject } from "./index";

/**
 * Release the bytes behind storage keys whose last metadata row has gone.
 *
 * ── WHY THE ORDER IS METADATA FIRST, BYTES SECOND ──────────────────────────
 * Object storage cannot join a Postgres transaction. One of the two writes will
 * always be able to fail on its own, so the only choice is WHICH failure you
 * get:
 *
 *   bytes first  → if the row delete then fails, a LIVE FileAsset points at
 *                  bytes that are gone. A customer opens a proposal and gets a
 *                  broken image, and nothing in the database says why.
 *   row first    → if the byte delete then fails, some bytes are left with
 *                  nothing pointing at them. Wasted space, nothing broken, and
 *                  the orphan audit (`scripts/storage-orphans.ts`) finds them.
 *
 * The second is strictly recoverable and the first is not, so callers delete
 * their FileAsset rows first — inside whatever transaction they already use —
 * and then call this. It is why this function NEVER THROWS: by the time it
 * runs, the caller's real work has committed, and a storage hiccup must not
 * turn a completed delete into a 500.
 *
 * ── WHY IT COUNTS REFERENCES ───────────────────────────────────────────────
 * `FileAsset.storageKey` is NOT unique and keys are deliberately shared. The
 * clearest case is `payroll/post-bookkeeping.ts:78` — "One pay stub per
 * recipient, stored once and reused across that rep's lines" — which writes one
 * PDF and then one FileAsset row per commission line pointing at it. Deleting
 * one of those lines must not blank the stub on the other two.
 *
 * So a key is only released when NO FileAsset row references it any more.
 * Checked after the caller's delete has committed, which is the moment the
 * answer is true.
 */
export async function releaseStorageKeys(keys: (string | null | undefined)[]): Promise<number> {
  const unique = [...new Set(keys.filter((k): k is string => !!k))];
  if (unique.length === 0) return 0;

  let released = 0;
  for (const key of unique) {
    try {
      // Unscoped by design: the question is "does ANY row anywhere still use
      // these bytes", and a company- or vertical-scoped count would answer a
      // narrower one and delete a file another workspace is still showing.
      const stillReferenced = await prisma.fileAsset.count({ where: { storageKey: key } });
      if (stillReferenced > 0) continue;
      await deleteObject(key);
      released += 1;
    } catch (err) {
      // Best-effort, and loud enough to be found later. The row is already
      // gone, so the worst case is an orphan the audit script will report.
      console.error(
        `[storage] could not release orphaned bytes for a deleted file. ` +
          `Run scripts/storage-orphans.ts to list them. ${String(err)}`
      );
    }
  }
  return released;
}

/**
 * Delete FileAsset rows by id and release any bytes that nothing else uses.
 *
 * The common shape, wrapped once so call sites cannot get the order wrong.
 * Returns what actually happened, so a caller can log or assert on it.
 */
export async function deleteFileAssets(
  where: { id: { in: string[] } } | Record<string, unknown>
): Promise<{ rowsDeleted: number; bytesReleased: number }> {
  // Read the keys BEFORE the delete — afterwards there is nothing to read them
  // from. Selecting only the key keeps this cheap on a wide table.
  const doomed = await prisma.fileAsset.findMany({
    where: where as never,
    select: { id: true, storageKey: true },
  });
  if (doomed.length === 0) return { rowsDeleted: 0, bytesReleased: 0 };

  const { count } = await prisma.fileAsset.deleteMany({
    where: { id: { in: doomed.map((f) => f.id) } },
  });

  const bytesReleased = await releaseStorageKeys(doomed.map((f) => f.storageKey));
  return { rowsDeleted: count, bytesReleased };
}
