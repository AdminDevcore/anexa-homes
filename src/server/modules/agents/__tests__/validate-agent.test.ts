import { describe, it, expect } from "vitest";
import { configError, NEW_AGENT_VALUES, type AgentFormValues } from "@/lib/agent-labels";
import { findSecretValues } from "../config-guard";
import { validateAgentInput } from "../validate-agent";

const hello = (over: Partial<AgentFormValues> = {}): AgentFormValues => ({ ...NEW_AGENT_VALUES, name: "Hello Agent", ...over });

describe("validateAgentInput", () => {
  it("accepts the Hello Agent, trimming, and turns Both into a NULL product", () => {
    expect(validateAgentInput(hello({ name: "  Hello Agent  ", schedule: " */15  * * * * " }))).toEqual({
      ok: true,
      value: {
        name: "Hello Agent",
        description: "",
        handlerKey: "system.hello",
        vertical: null,
        department: "operations",
        enabled: false,
        schedule: "*/15 * * * *",
        timeoutSeconds: 60,
        requiresHumanGate: true,
        config: {},
      },
    });
  });

  it("reads a blank schedule as Run now only", () => {
    const r = validateAgentInput(hello({ schedule: "  " }));
    expect(r.ok && r.value.schedule).toBeNull();
  });

  it.each([
    [{ name: " " }, /name/],
    [{ handlerKey: "bank.ntp_poll" }, /No handler is registered for "bank\.ntp_poll"/],
    [{ product: "others" as never }, /Roofing, Solar or Both/],
    [{ schedule: "0 */15 * * * *" }, /5-field/],
    [{ timeoutSeconds: "4" }, /5 to 240/],
    [{ timeoutSeconds: "241" }, /5 to 240/],
    [{ timeoutSeconds: "30.5" }, /5 to 240/],
    [{ config: "{nope" }, /not valid JSON/],
    [{ config: "[]" }, /JSON object/],
    [{ config: '{"portalPassword":"hunter2"}' }, /config\.portalPassword looks like a secret/],
    [{ config: '{"greeting":"hi"}' }, /takes no settings/],
    [{ department: "engineering" as never }, /department/],
  ])("refuses %o", (over, message) => {
    const r = validateAgentInput(hello(over));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(message);
  });

  it("refuses a bad config in the SAME words the form shows while it is typed", () => {
    // configError is a copy of the checks below, in the browser, where the
    // server module cannot be imported. If anyone reworded one of these
    // sentences, a person would meet two wordings for one problem — so the two
    // are compared here rather than trusted to stay in step.
    for (const config of ["{nope", "[]", `{"blob":"${"x".repeat(40_000)}"}`]) {
      const r = validateAgentInput(hello({ config }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe(configError(config));
    }
  });

  it("still saves an agent whose handler was removed, while the handler is not being changed — but never a secret", () => {
    const kept = { keepHandlerKey: "bank.ntp_poll" };
    expect(validateAgentInput(hello({ handlerKey: "bank.ntp_poll", config: '{"stages":["x"]}' }), kept).ok).toBe(true);
    expect(validateAgentInput(hello({ handlerKey: "bank.ntp_poll", config: '{"password":"x"}' }), kept).ok).toBe(false);
  });

  it("accepts a timeout of exactly 5 or exactly 240 — both ends of the range", () => {
    expect(validateAgentInput(hello({ timeoutSeconds: "5" })).ok).toBe(true);
    expect(validateAgentInput(hello({ timeoutSeconds: "240" })).ok).toBe(true);
  });

  it("refuses a config whose serialised size is far past the cap, cleanly rather than by luck", () => {
    const huge = `{"blob":"${"x".repeat(200_000)}"}`;
    const r = validateAgentInput(hello({ config: huge }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/30,000 characters/);
  });

  it("shows the trap: the config-guard walk really does overflow the stack on a config nested thousands of levels deep", () => {
    let deep: unknown = 1;
    for (let i = 0; i < 12_000; i++) deep = [deep];
    expect(() => findSecretValues(deep)).toThrow(RangeError);
  });

  it("refuses a config nested past the depth cap, without ever throwing out of validateAgentInput", () => {
    const depth = 12_000;
    const nested = `{"data":${"[".repeat(depth)}1${"]".repeat(depth)}}`;
    let r: ReturnType<typeof validateAgentInput> | undefined;
    expect(() => {
      r = validateAgentInput(hello({ config: nested }));
    }).not.toThrow();
    expect(r?.ok).toBe(false);
    if (r && !r.ok) expect(r.error).toMatch(/nested too deeply/);
  });
});
