import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * CI guard for the export boundary.
 *
 * A route that hands back a CSV or a PDF is a BULK READ. It is not the same act
 * as opening one record on screen: it leaves the product, it is trivially
 * forwarded, and it is the shape every leak in this codebase has taken so far —
 * a year-to-date payroll PDF re-uploaded onto a customer deal (see
 * src/lib/company-exports.ts), and on 2026-09-10 a 5,000-row storm CSV of every
 * homeowner in the company, downloadable by any canvasser.
 *
 * Both of those passed their own permission check. That is the point: they were
 * gated on `read`, and `read` is the verb every staff role holds on something.
 * `export` is the verb that exists to be withheld — the matrix grants it to
 * finance and leadership and to nobody else — and a download gated on `read`
 * silently opts out of the one control designed for it.
 *
 * THE RULE. Any route under the scanned directories whose source emits
 * `text/csv` or `application/pdf` must ask `can(user, "export", <Resource>)`.
 * Which resource is the author's call; that there is an export check at all is
 * not.
 *
 * WHAT THIS DOES NOT CHECK. It reads source text, so it proves the question is
 * asked, never that the answer is used correctly, and it says nothing about
 * ROW scoping — `export` decides whether you may download, `listScope` decides
 * whose rows come back, and both of those failed independently on the storm
 * routes. Treat a pass here as "the permission model can see this download",
 * not as "this download is safe".
 *
 * To add a legitimate exception: add the repo-relative path to ALLOWED with a
 * comment explaining why an export check is the wrong question there. The bar
 * is that the payload is ONE record the viewer already reached through a
 * scoped read — not a company-wide extract.
 */

const REPO_ROOT = join(__dirname, "..", "..", "..");

/**
 * Both staff surfaces. `src/app/api` is scanned alongside `src/app/portal`
 * precisely so that moving a download one directory sideways is not a way out
 * of this test — three bookkeeping PDFs were already sitting there.
 */
const SCAN_DIRS = [join("src", "app", "portal"), join("src", "app", "api")];
const SKIP_DIRS = new Set(["node_modules", ".next", ".next-e2e", "dist", "build"]);

/** A response body that leaves the product. */
const EXPORT_MIME = /["'`](?:text\/csv|application\/pdf)/;

/**
 * `can(user, "export", "Resource")` / `requireCan(...)`, pinned to the ACTION
 * position. Deliberately not a loose search for the word "export": every one of
 * these files has `export async function GET` at the top of it.
 */
const EXPORT_CHECK = /(?:can|requireCan)\(\s*[A-Za-z_$][\w$]*\s*,\s*["']export["']\s*,/;

/** Reviewed exceptions, keyed by repo-relative path. Each says why. */
const ALLOWED: Record<string, string> = {
  // ── ONE RECORD, REACHED THROUGH A SCOPED READ ─────────────────────────────
  // These serve a document that is already attached to a deal the viewer
  // passed `listScope` to open. The authorising question is "may you open this
  // deal", which they ask; an `export` check would withhold a rep's own
  // customer paperwork from them.
  "src/app/portal/documents/[id]/download/route.ts":
    "One signed package on one deal; authorised by listScope(user, 'Document').",
  "src/app/portal/documents/[id]/pdf/route.ts":
    "One signed package on one deal; Document:read plus the package's own scope.",
  "src/app/portal/scope/[id]/pdf/route.ts":
    "The carrier's scope PDF for one deal; scopePdfForUser() applies the deal scope.",
  "src/app/portal/leads/[id]/photo-report/route.ts":
    "Photos from ONE deal, assembled for the homeowner; listScope(user, 'Lead') + File:read.",
  "src/app/portal/projects/[id]/photo-report/route.ts":
    "Photos from ONE job; listScope(user, 'Project') + File:read.",

  // ── BLANK STATIONERY, NO CUSTOMER DATA IN IT ──────────────────────────────
  "src/app/portal/documents/templates/[id]/preview/route.ts":
    "An unfilled contract template — company stationery, no customer rows to export.",
  "src/app/portal/documents/templates/[id]/source/route.ts":
    "The uploaded template file itself; same reasoning as preview.",

  // ── NOT A STAFF SURFACE AT ALL ────────────────────────────────────────────
  "src/app/api/sign/[token]/pdf/route.ts":
    "The homeowner's own copy of what they are signing. No session exists on this " +
    "route — it is authorised by an unguessable token, and homeowners hold no " +
    "role in the matrix (see LEGACY_ROLES). There is no `user` to ask.",
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
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

/** Repo-relative, forward-slashed, so keys read the same on every platform. */
function repoPath(file: string): string {
  return relative(REPO_ROOT, file).split(sep).join("/");
}

describe("export boundary", () => {
  const routes = SCAN_DIRS.flatMap((d) => walk(join(REPO_ROOT, d)));
  const downloads = routes.filter((f) => EXPORT_MIME.test(readFileSync(f, "utf8")));

  it("finds the download routes", () => {
    // If the detector broke, the guard below would pass vacuously.
    expect(routes.length).toBeGreaterThan(40);
    expect(downloads.length).toBeGreaterThan(20);
  });

  it("every CSV/PDF route asks for the export verb", () => {
    const offenders = downloads
      .map(repoPath)
      .filter((p) => !(p in ALLOWED))
      .filter((p) => !EXPORT_CHECK.test(readFileSync(join(REPO_ROOT, p), "utf8")));

    expect(
      offenders,
      `These routes return a CSV or PDF without can(user, "export", …).\n` +
        `Gate them on the export verb, or add them to ALLOWED with a reason:\n` +
        offenders.map((p) => `  • ${p}`).join("\n")
    ).toEqual([]);
  });

  it("every exception still exists and still emits a download", () => {
    // An ALLOWED entry for a deleted or rewritten route is a hole nobody is
    // watching any more. Stale exceptions are how an allowlist rots.
    const present = new Set(downloads.map(repoPath));
    const stale = Object.keys(ALLOWED).filter((p) => !present.has(p));
    expect(
      stale,
      `ALLOWED names routes that no longer return a download. Delete these entries:\n` +
        stale.map((p) => `  • ${p}`).join("\n")
    ).toEqual([]);
  });
});
