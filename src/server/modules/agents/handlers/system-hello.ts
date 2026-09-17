import type { AgentHandler } from "../types";

type HelloConfig = Record<string, never>;

/**
 * The control plane's test agent. It proves the loop — registry, runner, run
 * log, pages — end to end, with nothing outside the app involved.
 */
export const systemHelloHandler: AgentHandler<HelloConfig> = {
  key: "system.hello",
  label: "Hello (test agent)",

  parseConfig(raw) {
    const isEmptyObject =
      raw !== null && typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length === 0;
    return isEmptyObject
      ? { ok: true, config: {} }
      : { ok: false, error: "The Hello agent takes no settings. Its config must be {}." };
  },

  async run(ctx) {
    ctx.log("hello");
    return {
      status: "success",
      summary: "Said hello",
      detail: { greeting: "hello", at: ctx.deps.now().toISOString() },
    };
  },
};
