import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * CI guard for the server-action boundary.
 *
 * EVERY export of a `"use server"` module is a public RPC endpoint. Next.js
 * registers one action id per exported function whether or not any client
 * component imports it, so an "internal helper" that happens to live in such a
 * file is reachable from outside the app.
 *
 * That makes one parameter shape uniquely dangerous: a function that takes the
 * TENANT (`companyId`) as an ARGUMENT. Inside a `"use server"` file the caller
 * supplies it, so the tenant boundary becomes whatever the caller typed — and no
 * amount of downstream scoping can recover from that. On 2026-09-05
 * `solar/storage.ts` shipped five such exports, one of them a write
 * (`syncDealRebateQuantities`), and they were only ever called from server code
 * that had already resolved the id from the session — so nothing needed them to
 * be actions at all.
 *
 * The fix, and the rule this guard enforces: a server action resolves its
 * company from `requireUser()` and never accepts one. Reads that take a
 * `companyId` live in a plain module beside it — `readiness.ts`, `adders.ts`,
 * `layout-asset.ts`, `esign/final-docs.ts` and `solar/storage-queries.ts` are
 * all that split, and each says so in its header.
 *
 * To add a legitimate exception: add the `file#export` to ALLOWED below with a
 * comment explaining why a caller-supplied id cannot cross a tenant boundary
 * there.
 */

const REPO_ROOT = join(__dirname, "..", "..", "..");
const SCAN_DIRS = ["src"];
const SCAN_EXT = [".ts", ".tsx"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".next-e2e", "dist", "build"]);

/**
 * The parameter name that carries the TENANT boundary.
 *
 * Deliberately only `companyId`. A `leadId` / `projectId` parameter is normal
 * and unavoidable — the browser has to say which row it is acting on, and the
 * action then proves ownership with `requireUser()` plus a `companyId`-scoped
 * read or `listScope()`. `companyId` is different in kind: it is the tenant key
 * itself, so accepting one lets the caller DECLARE which tenant they are, and
 * no amount of downstream scoping can recover from that.
 */
const SCOPE_PARAM = /\bcompanyId\b/;

/**
 * Reviewed exceptions, keyed by `repo/relative/path.ts#exportName`.
 * Every entry must state why a caller-supplied id is safe there.
 */
const ALLOWED: Record<string, string> = {
  // No entries. Every current server action resolves its company from the
  // session. Keep it that way.
};

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SCAN_EXT.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

/** A module is a server-action module only when the DIRECTIVE is its first statement. */
function isUseServerModule(src: string): boolean {
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    // Skip a leading licence//doc block before the directive.
    if (line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) continue;
    return line === '"use server";' || line === "'use server';";
  }
  return false;
}

/**
 * Exported async functions and their parameter list, read from the source text.
 * Deliberately textual rather than a real parse: this has to run in the unit
 * suite with no build step, and the shape it looks for is unambiguous.
 */
function exportedFunctions(src: string): { name: string; params: string }[] {
  const out: { name: string; params: string }[] = [];
  const re = /^export\s+(?:async\s+)?function\s+(\w+)\s*\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    // Walk the balanced parameter list from the opening paren.
    let depth = 0;
    let i = re.lastIndex - 1;
    for (; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push({ name: m[1], params: src.slice(re.lastIndex, i) });
  }
  return out;
}

describe("server-action boundary", () => {
  const files = SCAN_DIRS.flatMap((d) => walk(join(REPO_ROOT, d)));
  const serverModules = files.filter((f) => isUseServerModule(readFileSync(f, "utf8")));

  it("finds the server-action modules", () => {
    // If the detector broke, the guard below would pass vacuously.
    expect(serverModules.length).toBeGreaterThan(30);
  });

  it("no server action takes a caller-supplied companyId", () => {
    const offenders: string[] = [];

    for (const file of serverModules) {
      const rel = relative(REPO_ROOT, file).split(sep).join("/");
      const src = readFileSync(file, "utf8");
      for (const fn of exportedFunctions(src)) {
        if (!SCOPE_PARAM.test(fn.params)) continue;
        if (`${rel}#${fn.name}` in ALLOWED) continue;
        offenders.push(`${rel}#${fn.name}(${fn.params.replace(/\s+/g, " ").trim()})`);
      }
    }

    expect(
      offenders,
      `Every export of a "use server" module is a public endpoint, so a tenant id in its\n` +
        `parameter list is caller-controlled. Resolve it from requireUser() instead, or move\n` +
        `the helper into a plain module beside the actions (see solar/storage-queries.ts).\n\n` +
        `${offenders.join("\n")}\n`
    ).toEqual([]);
  });

  it("the five helpers that caused this guard are no longer server actions", () => {
    const storage = readFileSync(
      join(REPO_ROOT, "src/server/modules/solar/storage.ts"),
      "utf8"
    );
    expect(isUseServerModule(storage)).toBe(true);
    const names = exportedFunctions(storage).map((f) => f.name);
    for (const gone of [
      "listBackupProfiles",
      "listRebates",
      "listDealRebates",
      "dealRebateTotalCents",
      "syncDealRebateQuantities",
    ]) {
      expect(names, `${gone} must not be exported from a "use server" module`).not.toContain(gone);
    }
    // …and the mutations a browser legitimately calls are still there.
    for (const kept of [
      "saveBackupProfileAction",
      "deleteBackupProfileAction",
      "saveRebateAction",
      "deleteRebateAction",
      "applyDealRebateAction",
      "removeDealRebateAction",
    ]) {
      expect(names).toContain(kept);
    }
  });

  it("every allowlist entry still names a real export", () => {
    for (const key of Object.keys(ALLOWED)) {
      const [rel, name] = key.split("#");
      const src = readFileSync(join(REPO_ROOT, rel), "utf8");
      expect(
        exportedFunctions(src).map((f) => f.name),
        `stale allowlist entry: ${key}`
      ).toContain(name);
    }
  });
});
