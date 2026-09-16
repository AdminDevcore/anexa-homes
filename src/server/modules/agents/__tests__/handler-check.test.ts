import { describe, it, expect } from "vitest";
import { formatUnknownHandlers, unknownHandlers } from "../handler-check";

describe("build check: enabled agents with no handler", () => {
  const rows = [
    { company: "Anexa Homes", name: "Hello Agent", handlerKey: "system.hello" },
    { company: "Anexa Homes", name: "NTP Poller", handlerKey: "bank.ntp_poll" },
  ];

  it("finds only the agents this build cannot run", () => {
    expect(unknownHandlers(rows)).toEqual([rows[1]]);
  });

  it("says which company, agent and key, and what to do", () => {
    const text = formatUnknownHandlers(unknownHandlers(rows));
    expect(text).toContain("Anexa Homes / NTP Poller / bank.ntp_poll");
    expect(text).toContain("disable the agent");
  });

  it("passes when every enabled agent has a handler", () => {
    expect(unknownHandlers([rows[0]])).toEqual([]);
  });
});
