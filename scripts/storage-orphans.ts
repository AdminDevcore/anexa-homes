/**
 * Storage orphan audit — READ-ONLY BY DEFAULT.
 *
 *   npx tsx scripts/storage-orphans.ts                 # report only (default)
 *   npx tsx scripts/storage-orphans.ts --json          # same, machine-readable
 *   npx tsx scripts/storage-orphans.ts --purge --yes-delete-orphaned-bytes
 *                                                      # actually delete (A only)
 *
 * Two independent kinds of drift, because a FileAsset row and the bytes it
 * points at are two different things:
 *
 *   A. STORED BYTES WITH NO REFERENCE — a blob no FileAsset row mentions. This
 *      is what every deletion path left behind before `server/storage/release.ts`
 *      existed. Wasteful, harmless, and the only thing --purge will touch.
 *
 *      PURGE HONOURS A 30-DAY RETENTION WINDOW. An orphan younger than that is
 *      reported but never deleted, because the most likely reason a file lost
 *      its row in the last month is that somebody deleted it by mistake and
 *      wants it back. Thirty days is the grace period; after it the bytes are
 *      genuinely unreachable and only cost money. Override with --older-than=N
 *      for a deliberate, narrower sweep — never widen it below 30 without
 *      deciding that retention question first.
 *
 *   B. REFERENCES WITH NO BYTES — a live FileAsset whose object is missing. The
 *      dangerous direction: a customer opens a proposal and gets a broken
 *      image. **Never** "fixed" by this script — deleting those rows would
 *      destroy the record of a document that may only be temporarily
 *      unavailable (a restore in progress, a bucket outage). Reported so a
 *      human can decide.
 *
 * B is detected for every driver. A can only be enumerated when the driver can
 * list what it holds, which today means STORAGE_DRIVER=db (a `stored_files`
 * scan) or "local" (a directory walk). S3/R2 would need a paginated ListObjects
 * and is reported as unsupported rather than guessed at.
 *
 * Uses a BARE PrismaClient on purpose: this asks a whole-database question
 * across every company and both workspaces, which a vertical-scoped client
 * would silently narrow.
 *
 * WHAT IT WRITES. In its default report mode: nothing at all. Under --purge it
 * makes exactly two kinds of write — it STAMPS `StoredFile.orphanedAt` on keys
 * it finds unreferenced for the first time (and clears the stamp on any key
 * that has regained a reference), and it deletes the bytes of keys stamped
 * longer ago than the window. The stamp is what makes the window mean "time
 * since this became unreferenced" rather than "age of the file" — without it a
 * two-year-old contract deleted yesterday would be purged the same day, which
 * is the exact accident the grace period exists to prevent.
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs/promises";
import path from "node:path";

const prisma = new PrismaClient();

const args = new Set(process.argv.slice(2));
const AS_JSON = args.has("--json");
/** Both flags required. One is a typo; two is a decision. */
const PURGE = args.has("--purge") && args.has("--yes-delete-orphaned-bytes");
const PURGE_REQUESTED = args.has("--purge");

/** Days an orphan must have been orphaned before --purge may touch it. */
const RETENTION_DAYS = (() => {
  const flag = [...args].find((a) => a.startsWith("--older-than="));
  const n = flag ? Number(flag.split("=")[1]) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 30;
})();
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

const DRIVER = (process.env.STORAGE_DRIVER ?? "local").toLowerCase();

/** key -> when the key was first seen orphaned. Empty until a sweep marks it. */
const writtenAt = new Map<string, Date>();
const ageDaysOf = (key: string): number | null => {
  const at = writtenAt.get(key);
  return at ? Math.floor((Date.now() - at.getTime()) / (24 * 60 * 60 * 1000)) : null;
};
const localRoot = () => path.resolve(process.cwd(), process.env.STORAGE_LOCAL_DIR ?? "./storage");

type Report = {
  driver: string;
  referencedKeys: number;
  storedObjects: number | null;
  /** `age` is null when the driver cannot say when the object was written. */
  orphanedBytes: { key: string; size: number | null; ageDays: number | null }[];
  missingObjects: { fileId: string; key: string; name: string; companyId: string }[];
  unsupported?: string;
};

/** Every storageKey any FileAsset still points at. */
async function referencedKeys(): Promise<Set<string>> {
  const rows = await prisma.fileAsset.findMany({ select: { storageKey: true } });
  return new Set(rows.map((r) => r.storageKey));
}

/** Every key the storage layer actually holds, or null when it cannot be listed. */
async function storedKeys(): Promise<Map<string, number | null> | null> {
  if (DRIVER === "db") {
    const rows = await prisma.storedFile.findMany({
      select: { key: true, size: true, orphanedAt: true },
    });
    // The retention clock starts when a key was first SEEN orphaned, not when
    // the bytes were written. A key with no stamp yet has no age.
    for (const r of rows) if (r.orphanedAt) writtenAt.set(r.key, r.orphanedAt);
    return new Map(rows.map((r) => [r.key, r.size]));
  }
  if (DRIVER === "local") {
    const root = localRoot();
    const out = new Map<string, number | null>();
    async function walk(dir: string) {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return; // no storage tree yet
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else {
          const stat = await fs.stat(full);
          const rel = path.relative(root, full).split(path.sep).join("/");
          // The local driver has nowhere to stamp, so mtime is the only clock
          // available. It is the age of the FILE, not of the orphaning, which
          // is why --purge on `local` is a dev convenience and production runs
          // on the `db` driver where the stamp is real.
          writtenAt.set(rel, stat.mtime);
          out.set(rel, stat.size);
        }
      }
    }
    await walk(root);
    return out;
  }
  return null; // s3 — needs paginated ListObjectsV2
}

async function main() {
  const referenced = await referencedKeys();
  const stored = await storedKeys();

  const report: Report = {
    driver: DRIVER,
    referencedKeys: referenced.size,
    storedObjects: stored ? stored.size : null,
    orphanedBytes: [],
    missingObjects: [],
  };

  // A. bytes nothing points at
  if (stored) {
    for (const [key, size] of stored) {
      if (!referenced.has(key)) report.orphanedBytes.push({ key, size, ageDays: ageDaysOf(key) });
    }
  } else {
    report.unsupported =
      `STORAGE_DRIVER="${DRIVER}" cannot be enumerated by this script, so orphaned ` +
      `objects (direction A) were NOT checked. Direction B below is still complete.`;
  }

  // B. references whose bytes are gone
  const assets = await prisma.fileAsset.findMany({
    select: { id: true, storageKey: true, name: true, companyId: true },
  });
  for (const a of assets) {
    const present = stored
      ? stored.has(a.storageKey)
      : await (async () => {
          const { objectExists } = await import("../src/server/storage/index");
          return objectExists(a.storageKey);
        })();
    if (!present) {
      report.missingObjects.push({
        fileId: a.id,
        key: a.storageKey,
        name: a.name,
        companyId: a.companyId,
      });
    }
  }

  if (AS_JSON) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const bytes = report.orphanedBytes.reduce((n, o) => n + (o.size ?? 0), 0);
    console.log(`\nStorage orphan audit — driver "${report.driver}"`);
    console.log(`  FileAsset rows / distinct keys referenced : ${report.referencedKeys}`);
    console.log(`  objects held by storage                   : ${report.storedObjects ?? "n/a"}`);
    if (report.unsupported) console.log(`\n  ⚠ ${report.unsupported}`);

    console.log(`\nA. ORPHANED BYTES (nothing references them): ${report.orphanedBytes.length}`);
    if (bytes > 0) console.log(`   reclaimable: ${(bytes / 1024 / 1024).toFixed(1)} MB`);
    for (const o of report.orphanedBytes.slice(0, 40)) {
      const age = o.ageDays == null ? "not yet stamped" : `orphaned ${o.ageDays}d ago`;
      const held = o.ageDays == null || o.ageDays < RETENTION_DAYS ? "  [retained]" : "";
      console.log(`   ${o.key}  (${age})${held}`);
    }
    if (report.orphanedBytes.length > 40) {
      console.log(`   … and ${report.orphanedBytes.length - 40} more (use --json for all)`);
    }

    console.log(`\nB. MISSING OBJECTS (a live row points at nothing): ${report.missingObjects.length}`);
    if (report.missingObjects.length > 0) {
      console.log(`   ⚠ These are NOT deleted by --purge. A row here may be a customer's`);
      console.log(`     document that is only temporarily unavailable. Investigate first.`);
    }
    for (const m of report.missingObjects.slice(0, 40)) {
      console.log(`   file ${m.fileId}  "${m.name}"  → ${m.key}`);
    }
    if (report.missingObjects.length > 40) {
      console.log(`   … and ${report.missingObjects.length - 40} more (use --json for all)`);
    }
  }

  if (PURGE_REQUESTED && !PURGE) {
    console.log(
      `\n--purge ignored. Deleting bytes is irreversible, so it also needs ` +
        `--yes-delete-orphaned-bytes on the same command line.`
    );
  }

  if (PURGE) {
    // TWO-PHASE, and that is the retention guarantee. Anything orphaned that
    // carries no stamp yet is stamped NOW and deleted by a later sweep — never
    // by this one. Only keys stamped longer ago than the window are deleted.
    if (DRIVER === "db") {
      const unstamped = report.orphanedBytes.filter((o) => o.ageDays == null).map((o) => o.key);
      if (unstamped.length) {
        await prisma.storedFile.updateMany({
          where: { key: { in: unstamped }, orphanedAt: null },
          data: { orphanedAt: new Date() },
        });
        console.log(
          `\nStamped ${unstamped.length} newly-orphaned object(s). They become eligible for ` +
            `deletion in ${RETENTION_DAYS} days; this run will not touch them.`
        );
      }
      // A key that has a reference again is not an orphan — restart its clock.
      const stillReferenced = [...referenced];
      if (stillReferenced.length) {
        await prisma.storedFile.updateMany({
          where: { key: { in: stillReferenced }, orphanedAt: { not: null } },
          data: { orphanedAt: null },
        });
      }
    }

    // An object whose age cannot be determined is treated as YOUNG — the safe
    // reading, because the cost of keeping it is storage and the cost of
    // deleting it is a customer's document.
    const purgeable = report.orphanedBytes.filter(
      (o) => o.ageDays != null && o.ageDays * 24 * 60 * 60 * 1000 >= RETENTION_MS
    );
    const held = report.orphanedBytes.length - purgeable.length;
    if (held > 0) {
      console.log(
        `\n${held} orphan(s) are inside the ${RETENTION_DAYS}-day retention window (or were only ` +
          `just stamped) and will NOT be deleted.`
      );
    }
    if (purgeable.length === 0) {
      console.log("\nNothing to purge.");
    } else {
      console.log(`\nPURGING ${purgeable.length} orphaned objects older than ${RETENTION_DAYS} days…`);
      const { deleteObject } = await import("../src/server/storage/index");
      let done = 0;
      for (const o of purgeable) {
        try {
          await deleteObject(o.key);
          done += 1;
        } catch (err) {
          console.error(`  failed: ${o.key} — ${String(err)}`);
        }
      }
      console.log(`Purged ${done}/${purgeable.length}.`);
    }
  } else if (report.orphanedBytes.length > 0) {
    console.log(
      `\nRead-only run. To delete direction A only:\n` +
        `  npx tsx scripts/storage-orphans.ts --purge --yes-delete-orphaned-bytes\n` +
        `Only orphans older than ${RETENTION_DAYS} days are eligible; the rest are held.`
    );
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
