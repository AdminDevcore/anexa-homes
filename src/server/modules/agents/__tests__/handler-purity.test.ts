import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Handlers never write. They read through `ctx.deps` and RETURN the changes
 * they want, so the gate lives in one place (the runner) and every handler can
 * be tested with fakes.
 *
 * This guard is what makes "never" true: a handler that imports the database
 * client, a server module, or Next itself has a way to write that bypasses the
 * gate. Type-only imports are fine.
 */

const DIR = join(__dirname, "..", "handlers");

const FORBIDDEN: { re: RegExp; what: string }[] = [
  { re: /from\s+["']@\/server\//, what: "a server module (reach the world through ctx.deps)" },
  { re: /^import\s+(?!type\b)[^;]*from\s+["']@prisma\/client["']/m, what: "a runtime value from @prisma/client" },
  { re: /from\s+["']next(\/|["'])/, what: "Next.js" },
];

describe("agent handler purity", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".ts"));

  it("finds the handler files", () => {
    // If the directory moved, every case below would pass vacuously.
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} imports nothing that can write`, () => {
      const src = readFileSync(join(DIR, file), "utf8");
      for (const rule of FORBIDDEN) {
        expect(rule.re.test(src), `${file} imports ${rule.what}`).toBe(false);
      }
    });
  }
});
