import { describe, it, expect } from "vitest";
import { NEW_AGENT_VALUES, type AgentFormValues } from "@/lib/agent-labels";
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
  ])("refuses %o", (over, message) => {
    const r = validateAgentInput(hello(over));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(message);
  });

  it("still saves an agent whose handler was removed, while the handler is not being changed — but never a secret", () => {
    const kept = { keepHandlerKey: "bank.ntp_poll" };
    expect(validateAgentInput(hello({ handlerKey: "bank.ntp_poll", config: '{"stages":["x"]}' }), kept).ok).toBe(true);
    expect(validateAgentInput(hello({ handlerKey: "bank.ntp_poll", config: '{"password":"x"}' }), kept).ok).toBe(false);
  });
});
