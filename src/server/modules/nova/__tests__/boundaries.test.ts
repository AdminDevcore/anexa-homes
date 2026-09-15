import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Source-level guards on the Nova module. Each one pins a rule that a later
 * edit could break silently — the code would still compile and every
 * behavioural test would still pass on the fixtures it happens to use.
 */

const ROOT = join(__dirname, "..", "..", "..", "..", "..");
const DIRS = ["src/server/modules/nova", "src/app/api/nova"];

function files(dir: string): string[] {
  const abs = join(ROOT, dir);
  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const p = join(abs, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : files(relative(ROOT, p));
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

const SOURCES = DIRS.flatMap(files).map((p) => ({
  path: relative(ROOT, p),
  text: readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n"),
}));

function offenders(pattern: RegExp): string[] {
  return SOURCES.filter((s) => pattern.test(s.text)).map((s) => s.path);
}

describe("nova module boundaries", () => {
  it("has sources to check", () => {
    expect(SOURCES.length).toBeGreaterThan(0);
  });

  it("never reads the dashboard's sales aggregates (they count projects, not signed contracts)", () => {
    expect(offenders(/getDashboardStats|getTeamPerformance|dashboard\/team-performance|revenueCents|soldCents/)).toEqual([]);
  });

  it("never reads Lead.value (it is the after-credit figure, not the contract)", () => {
    expect(offenders(/\bvalue:\s*true\b/)).toEqual([]);
  });

  it("never lifts workspace isolation", () => {
    expect(offenders(/runUnscoped|rawUnscoped/)).toEqual([]);
  });

  it("never calls global search, which spans every granted workspace", () => {
    expect(offenders(/\/api\/search/)).toEqual([]);
  });

  it("never edits or deletes an audit row", () => {
    expect(offenders(/novaAuditEvent\s*\.\s*(update|updateMany|upsert|delete|deleteMany)\b/)).toEqual([]);
  });
});
