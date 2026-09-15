import { describe, it, expect } from "vitest";
import { HANDLER_KEYS, isHandlerKey } from "../handler-keys";
import { HANDLERS, handlerFor, handlerOptions } from "../registry";
import type { AgentContext, AgentDeps } from "../types";

const fakeDeps = (now: Date): AgentDeps => ({
  now: () => now,
  secrets: { get: async () => null },
  deals: { get: async () => null, inStages: async () => [] },
});

describe("handler registry", () => {
  it("holds exactly the listed keys, each handler naming itself with its own key", () => {
    expect(Object.keys(HANDLERS).sort()).toEqual([...HANDLER_KEYS].sort());
    for (const key of HANDLER_KEYS) expect(HANDLERS[key].key).toBe(key);
  });

  it("answers null for a key nobody registered", () => {
    expect(handlerFor("bank.ntp_poll")).toBeNull();
    expect(isHandlerKey("bank.ntp_poll")).toBe(false);
    expect(handlerFor("system.hello")?.key).toBe("system.hello");
  });

  it("offers every handler to the picker", () => {
    expect(handlerOptions()).toContainEqual({ value: "system.hello", label: "Hello (test agent)" });
  });
});

describe("system.hello", () => {
  const hello = HANDLERS["system.hello"];

  it("takes no settings", () => {
    expect(hello.parseConfig({})).toEqual({ ok: true, config: {} });
    expect(hello.parseConfig({ anything: 1 }).ok).toBe(false);
    expect(hello.parseConfig([]).ok).toBe(false);
    expect(hello.parseConfig(null).ok).toBe(false);
  });

  it("logs hello and succeeds without asking for any change", async () => {
    const lines: string[] = [];
    const now = new Date("2026-09-15T14:00:00.000Z");
    const ctx: AgentContext<Record<string, never>> = {
      companyId: "c",
      vertical: "roofing",
      runId: "r",
      trigger: "manual",
      leadId: null,
      config: {},
      signal: new AbortController().signal,
      log: (line) => lines.push(line),
      deps: fakeDeps(now),
    };
    const result = await hello.run(ctx);
    expect(lines).toEqual(["hello"]);
    expect(result).toEqual({
      status: "success",
      summary: "Said hello",
      detail: { greeting: "hello", at: "2026-09-15T14:00:00.000Z" },
    });
  });
});
