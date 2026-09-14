import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Nova's model and speech keys never reach the browser.
 *
 * The routes read them on the server and hand back text and audio. This fails
 * the build if a client component ever reads one, imports a model SDK (which
 * would put the calling code in the browser bundle), or if either key is given
 * a NEXT_PUBLIC_ name — the one way Next will inline an env var into client JS.
 */

const SRC = join(process.cwd(), "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : walk(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const files = walk(SRC);
const source = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
const clientFiles = files.filter((f) => /^\s*["']use client["']/.test(source.get(f)!));

describe("Nova's keys stay on the server", () => {
  it("sees the Nova dock as a client component", () => {
    expect(clientFiles.some((f) => f.endsWith("nova-dock.tsx"))).toBe(true);
  });

  it("no client component reads a model key or imports a model SDK", () => {
    const offenders = clientFiles.filter((f) =>
      /ANTHROPIC_API_KEY|OPENAI_API_KEY|@anthropic-ai\/sdk|from ["']openai["']|modules\/nova\/(voice|loop)/.test(source.get(f)!)
    );
    expect(offenders).toEqual([]);
  });

  it("neither key is ever given a NEXT_PUBLIC_ name", () => {
    expect(files.filter((f) => /NEXT_PUBLIC_(ANTHROPIC|OPENAI)/.test(source.get(f)!))).toEqual([]);
  });
});
