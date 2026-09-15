import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, dirname, resolve, sep } from "node:path";
import ts from "typescript";

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
 *
 * This scans the real syntax tree, not the text: a regex can't tell a comment
 * or a string from code, so `// import { moveDeal } from "../apply-changes"`
 * and `` `Moved from '${a}' to '${b}'` `` would either slip an import past a
 * denylist or get flagged by one that doesn't understand what it's reading.
 */

const AGENTS_DIR = join(__dirname, "..");
const HANDLERS_DIR = join(AGENTS_DIR, "handlers");

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

function stripTsExt(p: string): string {
  return p.endsWith(".ts") ? p.slice(0, -3) : p;
}

/** Is this specifier, resolved from `filePath`, one a handler may import? */
function isAllowedSpecifier(spec: string, filePath: string): boolean {
  if (spec === "zod") return true;
  if (!spec.startsWith(".")) return false;

  const resolved = stripTsExt(resolve(dirname(filePath), spec));
  if (resolved === HANDLERS_DIR || resolved.startsWith(HANDLERS_DIR + sep)) return true;
  if (resolved === join(AGENTS_DIR, "types")) return true;
  if (resolved === join(AGENTS_DIR, "handler-keys")) return true;
  return false;
}

/** True for a named-import/export clause whose elements are ALL type-only. */
function allElementsTypeOnly(elements: readonly { isTypeOnly: boolean }[]): boolean {
  return elements.length > 0 && elements.every((el) => el.isTypeOnly);
}

/** Every specifier `filePath`'s source reaches for that the allowlist doesn't cover. */
function offendingImports(source: string, filePath: string): string[] {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const offences: string[] = [];

  const checkSpecifier = (spec: string) => {
    if (!isAllowedSpecifier(spec, filePath)) offences.push(spec);
  };

  const stringOrOffence = (arg: ts.Expression | undefined) => {
    if (arg && ts.isStringLiteralLike(arg)) checkSpecifier(arg.text);
    else offences.push("<dynamic>");
  };

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      // A default import or a namespace import is never type-only, even
      // alongside type-only named bindings; a side-effect `import "x"` has
      // no clause and is always checked.
      const namedAllTypeOnly =
        !clause?.name &&
        clause?.namedBindings &&
        ts.isNamedImports(clause.namedBindings) &&
        allElementsTypeOnly(clause.namedBindings.elements);
      if (!clause?.isTypeOnly && !namedAllTypeOnly) checkSpecifier(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const namedTypeOnly =
        node.exportClause && ts.isNamedExports(node.exportClause) && allElementsTypeOnly(node.exportClause.elements);
      if (!node.isTypeOnly && !namedTypeOnly) checkSpecifier(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      checkSpecifier(node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node)) {
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if (isRequire || isDynamicImport) stringOrOffence(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return offences;
}

describe("agent handler purity", () => {
  const found = files(HANDLERS_DIR);

  it("finds the handler files", () => {
    // If the directory moved, every case below would pass vacuously.
    expect(found.length).toBeGreaterThan(0);
  });

  for (const path of found) {
    const name = relative(HANDLERS_DIR, path);
    it(`${name} imports nothing that can write`, () => {
      const offences = offendingImports(readFileSync(path, "utf8"), path);
      expect(offences, `${name} imports: ${offences.join(", ")}`).toEqual([]);
    });
  }
});

describe("offendingImports", () => {
  const at = (name: string) => join(HANDLERS_DIR, name);

  it("flags a handler reaching past the gate for apply-changes", () => {
    expect(offendingImports(`import { moveDeal } from "../apply-changes";`, at("x.ts"))).toEqual([
      "../apply-changes",
    ]);
  });

  it("flags the database client", () => {
    expect(offendingImports(`import { prisma } from "@/server/db/client";`, at("x.ts"))).toEqual([
      "@/server/db/client",
    ]);
  });

  it("flags a runtime Prisma import", () => {
    expect(offendingImports(`import { PrismaClient } from "@prisma/client";`, at("x.ts"))).toEqual([
      "@prisma/client",
    ]);
  });

  it("flags a mixed import with a runtime binding alongside a type", () => {
    expect(offendingImports(`import { type Lead, PrismaClient } from "@prisma/client";`, at("x.ts"))).toEqual([
      "@prisma/client",
    ]);
  });

  it("flags Next.js", () => {
    expect(offendingImports(`import { headers } from "next/headers";`, at("x.ts"))).toEqual(["next/headers"]);
  });

  it("flags require", () => {
    expect(offendingImports(`const x = require("fs");`, at("x.ts"))).toEqual(["fs"]);
  });

  it("flags a dynamic import", () => {
    expect(offendingImports(`await import("../deps");`, at("x.ts"))).toEqual(["../deps"]);
  });

  it("flags a re-export of a writer", () => {
    expect(offendingImports(`export { moveDeal } from "../apply-changes";`, at("x.ts"))).toEqual([
      "../apply-changes",
    ]);
  });

  it("allows a type-only import", () => {
    expect(offendingImports(`import type { AgentHandler } from "../types";`, at("x.ts"))).toEqual([]);
  });

  it("allows a type-only named import", () => {
    expect(offendingImports(`import { type Lead } from "@prisma/client";`, at("x.ts"))).toEqual([]);
  });

  it("allows zod", () => {
    expect(offendingImports(`import { z } from "zod";`, at("x.ts"))).toEqual([]);
  });

  it("allows handler-keys", () => {
    expect(offendingImports(`import { HANDLER_KEYS } from "../handler-keys";`, at("x.ts"))).toEqual([]);
  });

  it("allows a sibling inside handlers/", () => {
    expect(offendingImports(`import { parse } from "./bank/parse";`, at("x.ts"))).toEqual([]);
  });

  // Regression cases from the reviewer's probes: comments and strings must
  // never be mistaken for code, and a path is judged by where it resolves,
  // not by how it's spelled.

  it("does not let a comment make a real import look type-only", () => {
    const src = `// Prisma: import type only.\nimport { moveDeal } from "../apply-changes";`;
    expect(offendingImports(src, at("x.ts"))).toEqual(["../apply-changes"]);
  });

  it("does not let a preceding export type declaration mask the next import", () => {
    const src = `export type X = string;\nimport { moveDeal } from "../apply-changes";`;
    expect(offendingImports(src, at("x.ts"))).toEqual(["../apply-changes"]);
  });

  it("resolves a specifier that climbs out and back in, rather than trusting the leading ./", () => {
    expect(offendingImports(`import { x } from "./../apply-changes";`, at("x.ts"))).toEqual(["./../apply-changes"]);
  });

  it("flags a dynamic import with a variable argument as <dynamic>, not the variable's name", () => {
    const src = `const m = "../deps"; await import(m);`;
    expect(offendingImports(src, at("x.ts"))).toEqual(["<dynamic>"]);
  });

  it("flags a nested handler climbing all the way out of handlers/", () => {
    const src = `import { x } from "../../apply-changes";`;
    expect(offendingImports(src, at("bank/x.ts"))).toEqual(["../../apply-changes"]);
  });

  it("flags a default import alongside a type-only named import", () => {
    expect(offendingImports(`import X, { type Y } from "@prisma/client";`, at("x.ts"))).toEqual(["@prisma/client"]);
  });

  it("does not flag a template literal that merely looks like a re-export summary", () => {
    const src = "export const s = (a: string, b: string) => `Moved from '${a}' to '${b}'`;";
    expect(offendingImports(src, at("x.ts"))).toEqual([]);
  });

  it("does not flag a template literal whose text happens to read like an import", () => {
    const src = 'log(`import "${id}"`);';
    expect(offendingImports(src, at("x.ts"))).toEqual([]);
  });

  it("does not flag a type-only import because a comment above it says 'import'", () => {
    const src = `// this import matters for typing\nimport type { Lead } from "@prisma/client";`;
    expect(offendingImports(src, at("x.ts"))).toEqual([]);
  });

  it("does not let a comment inside braces break the type-only check", () => {
    const src = `import { type A, /* note */ type B } from "@prisma/client";`;
    expect(offendingImports(src, at("x.ts"))).toEqual([]);
  });

  it("allows a nested handler importing a sibling still inside handlers/", () => {
    expect(offendingImports(`import { s } from "../shared";`, at("bank/x.ts"))).toEqual([]);
  });

  it("does not flag require(...) written inside a string", () => {
    const src = `const msg = 'call require("fs") later';`;
    expect(offendingImports(src, at("x.ts"))).toEqual([]);
  });

  it("does not flag require(...) written inside a comment", () => {
    expect(offendingImports(`// require("fs")`, at("x.ts"))).toEqual([]);
  });

  it("allows a multi-line type-only import", () => {
    const src = `import {\n  type AgentHandler,\n} from "../types";`;
    expect(offendingImports(src, at("x.ts"))).toEqual([]);
  });
});
