import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { assertCronRequest } from "../cron";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const SECRET = "test-cron-secret-value";

function reqWith(auth?: string): Request {
  return new Request("https://example.test/api/cron/whatever", {
    headers: auth ? { authorization: auth } : {},
  });
}

describe("cron authentication — fails closed", () => {
  const original = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
    vi.restoreAllMocks();
  });

  it("1. refuses when CRON_SECRET is missing from the environment", async () => {
    delete process.env.CRON_SECRET;
    const denied = assertCronRequest(reqWith(`Bearer ${SECRET}`));
    expect(denied).not.toBeNull();
    // 503, not 401: the deployment is misconfigured, the caller is not at fault.
    expect(denied!.status).toBe(503);
    // …and it must not run the job just because nobody configured a secret.
    expect(await denied!.text()).not.toContain(SECRET);
  });

  it("1b. treats a blank/whitespace CRON_SECRET as missing", () => {
    process.env.CRON_SECRET = "   ";
    const denied = assertCronRequest(reqWith("Bearer    "));
    expect(denied).not.toBeNull();
    expect(denied!.status).toBe(503);
  });

  it("2. refuses when the request has no Authorization header", () => {
    process.env.CRON_SECRET = SECRET;
    const denied = assertCronRequest(reqWith());
    expect(denied).not.toBeNull();
    expect(denied!.status).toBe(401);
  });

  it("3. refuses an incorrect secret", () => {
    process.env.CRON_SECRET = SECRET;
    for (const bad of [
      "Bearer wrong",
      `Bearer ${SECRET}x`,
      `Bearer ${SECRET.slice(0, -1)}`,
      SECRET, // right value, missing the scheme
      `bearer ${SECRET}`, // scheme is case-sensitive here
      `Basic ${SECRET}`,
    ]) {
      const denied = assertCronRequest(reqWith(bad));
      expect(denied, `should have refused: ${bad}`).not.toBeNull();
      expect(denied!.status).toBe(401);
    }
  });

  it("4. allows the correct configured secret", () => {
    process.env.CRON_SECRET = SECRET;
    expect(assertCronRequest(reqWith(`Bearer ${SECRET}`))).toBeNull();
  });

  it("never echoes the secret in a refusal body", async () => {
    process.env.CRON_SECRET = SECRET;
    const denied = assertCronRequest(reqWith("Bearer nope"));
    expect(await denied!.text()).not.toContain(SECRET);
  });
});

/**
 * Guard: a new cron route must not hand-roll its own check.
 *
 * The fail-open block this replaced was copied into eleven files; the way that
 * happens again is somebody copying the twelfth from a sibling. Requiring the
 * shared helper — and banning the old shape outright — is what makes the fix
 * stick.
 */
describe("cron routes all use the shared guard", () => {
  function walk(dir: string, out: string[] = []): string[] {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return out;
    }
    for (const e of entries) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (e === "route.ts") out.push(full);
    }
    return out;
  }

  const cronRoutes = walk(join(REPO_ROOT, "src/app/api/cron"));
  // The MRMS worker's ingest endpoint is machine-auth'd the same way.
  cronRoutes.push(join(REPO_ROOT, "src/app/api/storm/swaths/ingest/route.ts"));

  it("finds every cron route", () => {
    expect(cronRoutes.length).toBeGreaterThanOrEqual(11);
  });

  it("each one calls assertCronRequest and none reads CRON_SECRET directly", () => {
    const offenders: string[] = [];
    for (const file of cronRoutes) {
      const rel = relative(REPO_ROOT, file).split(sep).join("/");
      const src = readFileSync(file, "utf8");
      if (!src.includes("assertCronRequest(")) offenders.push(`${rel}: does not call assertCronRequest()`);
      // Reading the variable directly is how the fail-open shape comes back.
      const readsEnv = src
        .split("\n")
        .some((l) => !l.trim().startsWith("//") && l.includes("process.env.CRON_SECRET"));
      if (readsEnv) offenders.push(`${rel}: reads process.env.CRON_SECRET directly`);
    }
    expect(
      offenders,
      `Cron routes must authenticate through assertCronRequest() so they fail closed.\n\n${offenders.join("\n")}\n`
    ).toEqual([]);
  });
});
