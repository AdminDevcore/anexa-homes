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

  it("passes when there are no agents at all", () => {
    expect(unknownHandlers([])).toEqual([]);
  });

  it("finds every company's broken agent, not just the first company's", () => {
    const many = [
      { company: "Anexa Homes", name: "Hello Agent", handlerKey: "system.hello" },
      { company: "Anexa Homes", name: "NTP Poller", handlerKey: "bank.ntp_poll" },
      { company: "Beacon Roofing", name: "Hello Agent", handlerKey: "system.hello" },
      { company: "Cedar Solar", name: "Permit Watcher", handlerKey: "permit.watch" },
    ];
    expect(unknownHandlers(many)).toEqual([many[1], many[3]]);
    const text = formatUnknownHandlers(unknownHandlers(many));
    expect(text).toContain("Anexa Homes / NTP Poller / bank.ntp_poll");
    expect(text).toContain("Cedar Solar / Permit Watcher / permit.watch");
  });
});
