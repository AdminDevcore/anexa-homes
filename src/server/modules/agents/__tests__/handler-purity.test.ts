import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Handlers never write. They read through `ctx.deps` and RETURN the changes
 * they want, so the gate lives in one place (the runner) and every handler can
 * be tested with fakes.
 *
 * A handler may import only types, zod, and its own folder. Everything it
 * does to the world goes through ctx.deps, and every change it wants goes
 * back in its result, through the gate. An allowlist, not a denylist: a
 * denylist only catches the specifiers someone thought to name, and
 * `../apply-changes` (Task 11's module — exactly what auto-import reaches
 * for) or a new `handlers/bank/client.ts` would slip straight past one.
 */

const DIR = join(__dirname, "..", "handlers");

function files(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : files(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

function isAllowedSpecifier(spec: string): boolean {
  return spec === "zod" || spec === "../types" || spec === "../handler-keys" || spec.startsWith("./");
}

/** True when every binding an import/export clause brings in is type-only. */
function isTypeOnlyClause(clause: string): boolean {
  const trimmed = clause.trim();
  if (/^type\b/.test(trimmed)) return true; // `import type X from "…"` / `export type { X } from "…"`
  const braced = trimmed.match(/^\{([\s\S]*)\}$/);
  if (!braced) return false;
  const bindings = braced[1]
    .split(",")
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
  return bindings.length > 0 && bindings.every((b) => /^type\b/.test(b));
}

/** Every specifier a source file reaches for that the allowlist doesn't cover. */
function offendingImports(source: string): string[] {
  const offences: string[] = [];

  // require(...) and dynamic import(...) are offences no matter the specifier:
  // they can name a module the static scan below would otherwise allow.
  const callRe = /\b(?:require|import)\s*\(\s*["'`]([^"'`]+)["'`]/g;
  for (let m = callRe.exec(source); m; m = callRe.exec(source)) offences.push(m[1]);

  const fromRe = /\b(?:import|export)\s+([\s\S]*?)\bfrom\s*["'`]([^"'`]+)["'`]/g;
  for (let m = fromRe.exec(source); m; m = fromRe.exec(source)) {
    const [, clause, specifier] = m;
    if (isTypeOnlyClause(clause)) continue;
    if (!isAllowedSpecifier(specifier)) offences.push(specifier);
  }

  const sideEffectRe = /\bimport\s*["'`]([^"'`]+)["'`]/g;
  for (let m = sideEffectRe.exec(source); m; m = sideEffectRe.exec(source)) {
    if (!isAllowedSpecifier(m[1])) offences.push(m[1]);
  }

  return offences;
}

describe("agent handler purity", () => {
  const found = files(DIR);

  it("finds the handler files", () => {
    // If the directory moved, every case below would pass vacuously.
    expect(found.length).toBeGreaterThan(0);
  });

  for (const path of found) {
    const name = relative(DIR, path);
    it(`${name} imports nothing that can write`, () => {
      const offences = offendingImports(readFileSync(path, "utf8"));
      expect(offences, `${name} imports: ${offences.join(", ")}`).toEqual([]);
    });
  }
});

describe("offendingImports", () => {
  it("flags a handler reaching past the gate for apply-changes", () => {
    expect(offendingImports(`import { moveDeal } from "../apply-changes";`)).toEqual(["../apply-changes"]);
  });

  it("flags the database client", () => {
    expect(offendingImports(`import { prisma } from "@/server/db/client";`)).toEqual(["@/server/db/client"]);
  });

  it("flags a runtime Prisma import", () => {
    expect(offendingImports(`import { PrismaClient } from "@prisma/client";`)).toEqual(["@prisma/client"]);
  });

  it("flags a mixed import with a runtime binding alongside a type", () => {
    expect(offendingImports(`import { type Lead, PrismaClient } from "@prisma/client";`)).toEqual([
      "@prisma/client",
    ]);
  });

  it("flags Next.js", () => {
    expect(offendingImports(`import { headers } from "next/headers";`)).toEqual(["next/headers"]);
  });

  it("flags require", () => {
    expect(offendingImports(`const x = require("fs");`)).toEqual(["fs"]);
  });

  it("flags a dynamic import", () => {
    expect(offendingImports(`await import("../deps");`)).toEqual(["../deps"]);
  });

  it("flags a re-export of a writer", () => {
    expect(offendingImports(`export { moveDeal } from "../apply-changes";`)).toEqual(["../apply-changes"]);
  });

  it("allows a type-only import", () => {
    expect(offendingImports(`import type { AgentHandler } from "../types";`)).toEqual([]);
  });

  it("allows a type-only named import", () => {
    expect(offendingImports(`import { type Lead } from "@prisma/client";`)).toEqual([]);
  });

  it("allows zod", () => {
    expect(offendingImports(`import { z } from "zod";`)).toEqual([]);
  });

  it("allows handler-keys", () => {
    expect(offendingImports(`import { HANDLER_KEYS } from "../handler-keys";`)).toEqual([]);
  });

  it("allows a sibling inside handlers/", () => {
    expect(offendingImports(`import { parse } from "./bank/parse";`)).toEqual([]);
  });
});
