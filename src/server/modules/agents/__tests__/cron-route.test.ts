import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CRON_MAX_DURATION_SECONDS } from "../budget";

const ROUTE = join(__dirname, "../../../../app/api/cron/agents/route.ts");
const VERCEL = join(__dirname, "../../../../../vercel.json");

describe("the agents cron route", () => {
  it("exists", () => {
    expect(existsSync(ROUTE)).toBe(true);
  });

  it("declares the function limit the tick budget is built on", () => {
    expect(readFileSync(ROUTE, "utf8")).toContain(`export const maxDuration = ${CRON_MAX_DURATION_SECONDS};`);
  });

  it("refuses a caller without the cron secret before it does anything", () => {
    const src = readFileSync(ROUTE, "utf8");
    expect(src.indexOf("assertCronRequest(req)")).toBeGreaterThan(-1);
    expect(src.indexOf("assertCronRequest(req)")).toBeLessThan(src.indexOf("tick(new Date())"));
  });

  it("is on the clock every minute", () => {
    const vercel = JSON.parse(readFileSync(VERCEL, "utf8")) as { crons: { path: string; schedule: string }[] };
    expect(vercel.crons).toContainEqual({ path: "/api/cron/agents", schedule: "* * * * *" });
  });
});
