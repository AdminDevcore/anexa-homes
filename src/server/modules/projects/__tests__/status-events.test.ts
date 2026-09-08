import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const fireEvent = vi.fn();
vi.mock("@/server/modules/notifications/engine", () => ({
  fireEvent: (...a: unknown[]) => fireEvent(...a),
}));

const { notifyProjectStatusChanged } = await import("../status-events");

const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");

beforeEach(() => fireEvent.mockReset());

describe("notifyProjectStatusChanged", () => {
  it("fires on a real transition", async () => {
    await notifyProjectStatusChanged({
      companyId: "co", projectId: "p1", actorId: "u1",
      from: "in_production", to: "completed",
    });
    expect(fireEvent).toHaveBeenCalledTimes(1);
    expect(fireEvent).toHaveBeenCalledWith({
      companyId: "co",
      event: "project_status_changed",
      actorId: "u1",
      projectId: "p1",
      status: "completed",
    });
  });

  it("stays silent when the status did not move", async () => {
    // The Edit Job dialog saves fifteen fields at once; an address correction
    // must not read as a status change in somebody's inbox.
    await notifyProjectStatusChanged({
      companyId: "co", projectId: "p1", actorId: "u1",
      from: "completed", to: "completed",
    });
    expect(fireEvent).not.toHaveBeenCalled();
  });

  it("fires when the previous status is unknown", async () => {
    // A missing `from` means we could not read it, not that it matched.
    await notifyProjectStatusChanged({
      companyId: "co", projectId: "p1", actorId: null,
      from: null, to: "on_hold",
    });
    expect(fireEvent).toHaveBeenCalledTimes(1);
  });

  it("carries a null actor for automation-driven changes", async () => {
    await notifyProjectStatusChanged({
      companyId: "co", projectId: "p1", actorId: null,
      from: "not_started", to: "in_production",
    });
    expect(fireEvent.mock.calls[0][0]).toMatchObject({ actorId: null });
  });
});

/**
 * Guard: every LIVE writer of `Project.status` announces the change.
 *
 * The bug this closes was not a wrong line of code — it was a missing one, in a
 * path nobody thought of as "the status path". A source guard is the only thing
 * that notices when a fourth writer appears.
 */
describe("every live Project.status writer notifies", () => {
  const SITES: { file: string; why: string }[] = [
    { file: "src/server/modules/projects/actions.ts", why: "admin Edit Job dialog" },
    { file: "src/server/modules/automations/actions/set-project-status.ts", why: "automation rule" },
    { file: "src/server/modules/leads/actions.ts", why: "cancel deal cascades to cancelled" },
  ];

  it.each(SITES)("$file ($why)", ({ file }) => {
    const src = readFileSync(join(REPO_ROOT, file), "utf8");
    expect(src).toContain("notifyProjectStatusChanged");
  });

  it("no NEW writer of Project.status has appeared unnoticed", () => {
    const KNOWN = new Set(SITES.map((s) => s.file));
    const roots = ["src/server/modules", "src/app"];
    const offenders: string[] = [];

    /**
     * Look INSIDE each `project.update(...)` call rather than anywhere in the
     * file — `costs/actions.ts` and `leads/manage.ts` both update a project and
     * both mention `status:` elsewhere, and neither touches the column.
     *
     * Known limitation: a call passing a pre-built variable (`data`) is opaque
     * here. The one that exists today (`costs/actions.ts:242`) provably writes
     * only money fields. A future one would slip past this guard.
     */
    const writesStatus = (src: string): boolean => {
      const re = /\b(?:prisma|db|tx)\.project\.update(?:Many)?\s*\(/g;
      while (re.exec(src)) {
        let depth = 0;
        let i = re.lastIndex - 1;
        for (; i < src.length; i++) {
          if (src[i] === "(") depth++;
          else if (src[i] === ")") {
            depth--;
            if (depth === 0) break;
          }
        }
        if (/\bstatus\s*:/.test(src.slice(re.lastIndex, i))) return true;
      }
      return false;
    };

    const walk = (dir: string): string[] => {
      let out: string[] = [];
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return out;
      }
      for (const e of entries) {
        const full = join(dir, e);
        if (statSync(full).isDirectory()) out = out.concat(walk(full));
        else if (e.endsWith(".ts") && !full.includes("__tests__")) out.push(full);
      }
      return out;
    };

    for (const root of roots) {
      for (const full of walk(join(REPO_ROOT, root))) {
        const rel = full.slice(REPO_ROOT.length + 1).split("\\").join("/");
        if (KNOWN.has(rel)) continue;
        if (writesStatus(readFileSync(full, "utf8"))) offenders.push(rel);
      }
    }

    expect(
      offenders,
      `These write Project.status without calling notifyProjectStatusChanged().\n` +
        `Either route them through it or add them to SITES with a reason.\n\n${offenders.join("\n")}\n`
    ).toEqual([]);
  });
});
