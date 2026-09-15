import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * CI guard: EVERY WRITE THAT CAN MOVE A DEAL GOES THROUGH THE STAGE GUARD.
 *
 * The M1 Funding gate once lived in the board's move action alone, while five
 * other writers of a deal's stage — the lead form, its quick edit, the
 * canvassing map, automations, the paperwork advance — went around it. Each is
 * now routed through `src/server/modules/pipeline/stage-guard.ts`, which holds
 * both stage rules (M1 Funding and Contract Signed). This test is what stops
 * the next writer from being added without it.
 *
 * A file is a STAGE WRITER when it writes a Lead and also touches its stage.
 * Deliberately broad: a false positive costs one allowlist line with a reason;
 * a false negative costs the gate. The check is per file, so it proves a writer
 * reaches the guard, not that every line in it does — the integration suite
 * `pipeline/__tests__/m1-funding-gate-paths.itest.ts` drives each path.
 */

const REPO_ROOT = join(__dirname, "..", "..", "..");
const SKIP_DIRS = new Set(["node_modules", ".next", "__tests__"]);

const LEAD_WRITE = /\.lead\.(?:create|createMany|createManyAndReturn|update|updateMany|upsert)\(/;
const STAGE_TOUCH = /\bstageId\b|\bstage:\s*\{\s*connect\b|stageEntryData\(|\bdata\.stage\s*=/;
/** A CALL to the guard or to one of the rules it is made of — a mention in prose does not count. */
const GUARD_CALL = /\b(?:stageMoveError|guardedStageId|fundingGateError)\(/;
const COMMENT = /^\s*(?:\/\/|\/\*|\*)/;

const GUARD_FILE = "src/server/modules/pipeline/stage-guard.ts";

/** Reviewed exceptions. Every entry says why the write cannot carry a deal INTO a stage. */
const ALLOWED: Record<string, string> = {
  "src/server/modules/settings/actions.ts":
    "Deleting a pipeline stage unstages the deals in it (stageId → null). That never moves a deal into a stage, so there is nothing for either rule to judge.",
};

/** The writers that exist today. If the scan stops finding them, the scan broke — not the code. */
const KNOWN_WRITERS = [
  "src/server/modules/leads/actions.ts",
  "src/server/modules/leads/manage.ts",
  "src/server/modules/leads/intake.ts",
  "src/server/modules/canvassing/actions.ts",
  "src/server/modules/automations/actions/move-stage.ts",
  "src/server/modules/pipeline/contract-signed.ts",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.(?:test|itest)\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Source with comment lines removed, so documentation cannot satisfy or trip the guard. */
const code = (src: string) => src.split("\n").filter((line) => !COMMENT.test(line)).join("\n");

describe("stage moves — every writer reaches the stage guard", () => {
  const files = walk(join(REPO_ROOT, "src")).map((full) => ({
    rel: relative(REPO_ROOT, full).split(sep).join("/"),
    src: code(readFileSync(full, "utf8")),
  }));
  const writers = files.filter((f) => LEAD_WRITE.test(f.src) && STAGE_TOUCH.test(f.src));

  it("finds every stage writer it already knows about", () => {
    const found = writers.map((f) => f.rel);
    for (const known of KNOWN_WRITERS) expect(found, `${known} is no longer detected`).toContain(known);
  });

  it("no stage writer skips the guard", () => {
    const offenders = writers.filter((f) => !(f.rel in ALLOWED) && !GUARD_CALL.test(f.src)).map((f) => f.rel);
    expect(
      offenders,
      `These files write a deal's stage without reaching ${GUARD_FILE}.\n` +
        `Route the move through stageMoveError() (or guardedStageId() for a form that re-derives the stage),\n` +
        `or add the file to ALLOWED with the reason it can never move a deal INTO a stage.\n\n${offenders.join("\n")}\n`
    ).toEqual([]);
  });

  it("the guard holds both rules", () => {
    const guard = code(readFileSync(join(REPO_ROOT, GUARD_FILE), "utf8"));
    expect(guard).toMatch(/\bfundingGateError\(/);
    expect(guard).toMatch(/\bcontractSignedMoveError\(/);
  });

  it("every allowlist entry still exists and still writes a stage", () => {
    for (const [rel, why] of Object.entries(ALLOWED)) {
      const src = code(readFileSync(join(REPO_ROOT, rel), "utf8"));
      expect(LEAD_WRITE.test(src) && STAGE_TOUCH.test(src), `${rel} no longer writes a stage — drop it (${why})`).toBe(true);
    }
  });
});
