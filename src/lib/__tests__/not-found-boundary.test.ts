import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, dirname, sep } from "node:path";

/**
 * CI guard: no `loading.tsx` may sit above a route that calls `notFound()`.
 *
 * WHY THIS IS A BUILD FAILURE AND NOT A STYLE NOTE. A `loading.tsx` is a
 * Suspense boundary, and a Suspense boundary makes Next flush the shell — the
 * sidebar, the header, the signed-in user's initials — as soon as anything
 * below it suspends. The HTTP status goes out with that first flush. By the
 * time the page resolves and calls `notFound()`, 200 has already been sent and
 * cannot be taken back.
 *
 * The symptom is not an error anywhere. It is a page that answers 200 with the
 * portal chrome wrapped around a completely empty `<main>`: no record, no
 * message, nothing to click. One file — `src/app/portal/loading.tsx` — did that
 * to all 15 portal routes that refuse by id, for as long as it existed, and it
 * looked exactly like a broken page rather than a refusal. Access control was
 * correct the whole time.
 *
 * THE FIX THIS PROTECTS. Skeletons are per-segment now, and a segment that
 * contains a route which refuses by id keeps its list skeleton in an `(index)`
 * route group instead — a group's boundary covers only what is inside it, so
 * `leads/(index)/loading.tsx` gives the list its skeleton without reaching
 * `leads/[id]`. Anyone restoring a convenient `loading.tsx` one level too high
 * silently reopens the whole thing, which is why a person cannot be the check.
 */

const APP = join(process.cwd(), "src", "app");

/** Route files that actually call `notFound()` — imported, then invoked. */
function routesThatRefuse(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      routesThatRefuse(full, found);
      continue;
    }
    if (!/^(page|layout|default)\.tsx?$/.test(entry)) continue;
    const src = readFileSync(full, "utf8");
    const imports = /import\s*\{[^}]*\bnotFound\b[^}]*\}\s*from\s*["']next\/navigation["']/.test(src);
    if (imports && /\bnotFound\s*\(/.test(src)) found.push(full);
  }
  return found;
}

/** Every `loading.tsx` from the route's own directory up to `src/app`. */
function boundariesAbove(routeFile: string): string[] {
  const hits: string[] = [];
  let dir = dirname(routeFile);
  while (dir.startsWith(APP)) {
    try {
      if (statSync(join(dir, "loading.tsx")).isFile()) hits.push(join(dir, "loading.tsx"));
    } catch {
      /* no boundary at this level */
    }
    if (dir === APP) break;
    dir = dirname(dir);
  }
  return hits;
}

const rel = (p: string) => relative(process.cwd(), p).split(sep).join("/");

describe("not-found boundary", () => {
  const refusing = routesThatRefuse(APP);

  it("finds the routes that refuse by id, so the rule below is not vacuous", () => {
    // If this drops to zero the detector has broken — every assertion after it
    // would pass against an app with no checks left in it at all.
    expect(refusing.length).toBeGreaterThan(5);
  });

  it("has no loading.tsx above a route that calls notFound()", () => {
    const offenders = refusing
      .flatMap((route) => boundariesAbove(route).map((b) => `${rel(b)}  covers  ${rel(route)}`))
      .sort();

    expect(
      offenders,
      "A Suspense boundary above one of these routes sends 200 before notFound() can " +
        "run, so the route answers with empty chrome instead of a 404. Move the skeleton " +
        "into an (index) route group beside the dynamic segment rather than above it."
    ).toEqual([]);
  });

  it("still has skeletons where they are safe, so the fix was not just deletion", () => {
    // The cheap way to satisfy the rule above is to delete every loading.tsx in
    // the app. That would pass and would be a worse product, so this asserts the
    // skeletons that do not cover a refusing route are still there.
    const all: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry === "loading.tsx") all.push(full);
      }
    };
    walk(APP);
    expect(all.length).toBeGreaterThan(10);
  });
});
