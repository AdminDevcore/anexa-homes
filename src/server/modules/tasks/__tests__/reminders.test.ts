import { describe, it, expect } from "vitest";
import { buildRepDigest, buildManagerRollup, type DigestTask } from "../reminder-digest";

const NOW = new Date("2026-06-15T12:00:00Z").getTime();
const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000);
const inDays = (n: number) => new Date(NOW + n * 24 * 60 * 60 * 1000);

describe("buildRepDigest", () => {
  const tasks: DigestTask[] = [
    { title: "Call back", dealName: "Smith", createdAt: daysAgo(3), dueAt: inDays(2) }, // future due
    { title: "Send quote", dealName: "Jones", createdAt: daysAgo(30), dueAt: daysAgo(5) }, // overdue
    { title: "Follow up", dealName: "Lee", createdAt: daysAgo(10), dueAt: null }, // no due date
  ];

  it("counts overdue tasks (past due date only)", () => {
    expect(buildRepDigest(tasks, NOW).overdue).toBe(1);
  });

  it("orders lines oldest-created first", () => {
    const { lines } = buildRepDigest(tasks, NOW);
    expect(lines[0]).toContain("Send quote"); // 30d
    expect(lines[1]).toContain("Follow up"); // 10d
    expect(lines[2]).toContain("Call back"); // 3d
  });

  it("flags overdue and shows age", () => {
    const { lines } = buildRepDigest(tasks, NOW);
    expect(lines[0]).toContain("open 30d");
    expect(lines[0]).toContain("⚠ overdue");
    expect(lines[2]).not.toContain("overdue"); // future-due task isn't overdue
  });

  it("heading pluralizes and reports counts", () => {
    expect(buildRepDigest(tasks, NOW).heading).toBe("You have 3 open follow-ups (1 overdue)");
    expect(buildRepDigest([tasks[0]], NOW).heading).toBe("You have 1 open follow-up (0 overdue)");
  });
});

describe("buildManagerRollup", () => {
  it("sums totals and orders reps most-stale first", () => {
    const roll = buildManagerRollup([
      { name: "Sarah", count: 2, overdue: 0, oldestDays: 4 },
      { name: "Mike", count: 6, overdue: 2, oldestDays: 40 },
    ]);
    expect(roll.total).toBe(8);
    expect(roll.lines[0]).toContain("Mike"); // oldest 40d first
    expect(roll.lines[0]).toBe("Mike — 6 open, 2 overdue, oldest 40d");
    expect(roll.heading).toBe("8 open follow-ups across your team");
  });
});
