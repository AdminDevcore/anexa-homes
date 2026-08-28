import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * CI guard for the vertical-isolation boundary.
 *
 * The Prisma client extension in `src/server/vertical/` injects `vertical` into
 * every read and write of a vertical-scoped model. That extension sits on the
 * model API (`prisma.lead.findMany`) — it does NOT intercept `$queryRaw` /
 * `$executeRaw`. A raw query against a scoped table therefore silently reads or
 * writes across workspaces, which is exactly the correctness hole the whole
 * mechanism exists to close.
 *
 * ESLint enforces this for `src/**` (see eslint.config.mjs). This test is the
 * backstop: it also covers `prisma/` and `scripts/`, which eslint doesn't lint,
 * and it fails loudly in `pnpm test` where the whole team will see it.
 *
 * To add a legitimate exception: wrap the call in `rawUnscoped()` and add the
 * file to ALLOWED below with a comment justifying it.
 */

const REPO_ROOT = join(__dirname, "..", "..", "..");
const SCAN_DIRS = ["src", "prisma", "scripts", "worker", "e2e"];
const SCAN_EXT = [".ts", ".tsx", ".mts", ".cts"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".next-e2e", "dist", "build"]);

const RAW_SQL = /\$(?:query|execute)Raw(?:Unsafe)?\b/;

/**
 * Comment lines are documentation, not calls — the vertical modules discuss
 * these identifiers by name. Allowlisting those files instead would blind the
 * guard to a real violation added to them later.
 */
const COMMENT = /^\s*(?:\/\/|\/\*|\*)/;

/**
 * Reviewed exceptions, keyed by repo-relative path (POSIX separators).
 * Every entry must state WHY the call cannot cross a vertical boundary.
 */
const ALLOWED: Record<string, string> = {
  // Full-schema wipe for idempotent dev/e2e seeding. Not a scoped read or write:
  // it truncates every company row regardless of vertical, then reseeds.
  "prisma/seed.ts": 'TRUNCATE TABLE "companies" CASCADE — whole-DB reset, not a scoped query',
  // Fixture reset for the isolation suite, against its own `vertical_test`
  // schema. Also a whole-schema truncate, and deliberately run on the
  // UNextended client so fixtures can span verticals — which is the only way to
  // set up the cross-vertical cases the suite then proves are unreachable.
  "src/server/vertical/__tests__/isolation.itest.ts":
    'TRUNCATE TABLE "companies" CASCADE — isolated test-schema reset',
  // The calendar's per-visit crew suite resets its own `vertical_test` fixtures
  // the same way, and on the UNextended client for the same reason: it builds a
  // solar deal and a roofing deal side by side, because the claim it proves is
  // that per-visit assignment changed the first without touching the second.
  "src/server/modules/calendar/__tests__/visit-crew.itest.ts":
    'TRUNCATE TABLE "companies" CASCADE — isolated test-schema reset',
  // Same pattern as the isolation suite: a whole-schema truncate against
  // `vertical_test` to reset fixtures, on the UNextended client because the
  // cases under test are deliberately cross-vertical (one rep, one deal per
  // side). Not a scoped read or write.
  "src/server/modules/payroll/__tests__/override-vertical.itest.ts":
    'TRUNCATE TABLE "companies" CASCADE — isolated test-schema reset',
  // Same again: the solar payout suite resets its own `vertical_test` fixtures
  // on the UNextended client, because it deliberately builds one rep who works
  // both sides in order to prove the two pay models never reach each other.
  "src/server/modules/payroll/__tests__/solar-pay.itest.ts":
    'TRUNCATE TABLE "companies" CASCADE — isolated test-schema reset',
  // And again for the rule suite, which proves a CommissionRule written for one
  // vertical never pays on the other's deals. Same unextended client, same
  // reason: the fixtures are deliberately cross-vertical.
  "src/server/modules/payroll/__tests__/rule-vertical.itest.ts":
    'TRUNCATE TABLE "companies" CASCADE — isolated test-schema reset',
  // A project number is unique per COMPANY, not per workspace, so the highest
  // one has to be read across every vertical — a scoped read sees only the
  // workspace being acted in, which on a solar deal at a roofing company is
  // none of them, and the number it then picks is one a roofing job already
  // holds. Reads a single shared column and writes nothing.
  "src/server/modules/projects/actions.ts":
    'SELECT "projectNumber" — the number is company-wide by definition',
  // The pay-structure role suite resets its own `vertical_test` fixtures the
  // same way, on the UNextended client: it builds a member of every role and a
  // solar deal sold by an owner, which no single workspace's scope would let it
  // tear down cleanly between cases.
  "src/server/modules/team/__tests__/pay-structure-roles.itest.ts":
    'TRUNCATE TABLE "companies" CASCADE — isolated test-schema reset',
  // The guard itself and its own fixtures mention the identifiers in strings.
  "src/lib/__tests__/no-raw-sql.test.ts": "this guard",
};

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // directory doesn't exist (e.g. empty worker/) — nothing to scan
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SCAN_EXT.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

describe("vertical isolation — raw SQL guard", () => {
  const files = SCAN_DIRS.flatMap((d) => walk(join(REPO_ROOT, d)));

  it("scans a non-trivial number of source files", () => {
    // Cheap sanity check: if the walker silently broke, the guard below would
    // pass vacuously and we'd lose the protection without noticing.
    expect(files.length).toBeGreaterThan(200);
  });

  it("no raw SQL outside the reviewed allowlist", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const rel = relative(REPO_ROOT, file).split(sep).join("/");
      if (rel in ALLOWED) continue;
      const src = readFileSync(file, "utf8");
      src.split("\n").forEach((line, i) => {
        if (COMMENT.test(line)) return;
        if (RAW_SQL.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
      });
    }

    expect(
      offenders,
      `Raw SQL bypasses vertical scoping (the Prisma extension only wraps the model API).\n` +
        `Use the scoped client, or wrap a reviewed exception in rawUnscoped() and add it to\n` +
        `ALLOWED in this file with a justification.\n\n${offenders.join("\n")}\n`
    ).toEqual([]);
  });

  it("every allowlist entry still exists and still contains raw SQL", () => {
    // Keeps the allowlist honest: a stale entry would silently widen the hole
    // for a future file that happens to reuse the path.
    for (const [rel, why] of Object.entries(ALLOWED)) {
      if (rel === "src/lib/__tests__/no-raw-sql.test.ts") continue;
      const src = readFileSync(join(REPO_ROOT, rel), "utf8");
      expect(RAW_SQL.test(src), `${rel} no longer uses raw SQL — drop it from ALLOWED (${why})`).toBe(true);
    }
  });
});
