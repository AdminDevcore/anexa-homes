import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DYNAMIC_TARGETS, EVENT_DEFS } from "../types";

describe("agent notification events", () => {
  it("catalogues both agent events with the agent, customer and status tokens", () => {
    for (const value of ["agent_run_failed", "agent_needs_human"] as const) {
      const def = EVENT_DEFS.find((e) => e.value === value);
      expect(def, value).toBeDefined();
      expect(def?.tokens).toEqual(["{{agent}}", "{{customer}}", "{{status}}"]);
    }
  });

  it("offers People with Agents access as a recipient", () => {
    expect(DYNAMIC_TARGETS.map((t) => t.value)).toContain("agents_access");
  });

  it("lets every catalogued event be saved from Settings", () => {
    const src = readFileSync(join(__dirname, "../actions.ts"), "utf8");
    const list = /const EVENTS = \[([\s\S]*?)\] as const/.exec(src)?.[1] ?? "";
    for (const e of EVENT_DEFS) expect(list, e.value).toContain(`"${e.value}"`);
  });
});
