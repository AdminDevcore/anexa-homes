import { describe, it, expect } from "vitest";
import {
  averageTurnaroundDays,
  completionDate,
  pipelineHealth,
  summariseTeam,
  type LeadTally,
} from "../ops";

const DAY = 86_400_000;
const NOW = new Date("2026-08-27T12:00:00Z").getTime();
const daysAgo = (n: number) => new Date(NOW - n * DAY);

describe("completionDate", () => {
  it("prefers the typed-in completion date", () => {
    const d = completionDate({ completedAt: daysAgo(3), installDate: daysAgo(10) });
    expect(d).toEqual(daysAgo(3));
  });

  // completedAt is only ever set by hand on the admin job-edit form, so most
  // finished jobs carry only the install date.
  it("falls back to the install date when nobody typed one", () => {
    const d = completionDate({ completedAt: null, installDate: daysAgo(10) });
    expect(d).toEqual(daysAgo(10));
  });

  it("returns null when the job has neither", () => {
    expect(completionDate({ completedAt: null, installDate: null })).toBeNull();
  });
});

describe("averageTurnaroundDays", () => {
  it("averages lead created → install complete in whole days", () => {
    const result = averageTurnaroundDays([
      { leadCreatedAt: daysAgo(50), completedAt: daysAgo(10), installDate: null }, // 40d
      { leadCreatedAt: daysAgo(40), completedAt: null, installDate: daysAgo(20) }, // 20d
    ]);
    expect(result).toEqual({ days: 30, sample: 2 });
  });

  it("reports no average rather than zero when nothing qualifies", () => {
    const result = averageTurnaroundDays([
      { leadCreatedAt: daysAgo(50), completedAt: null, installDate: null },
    ]);
    expect(result).toEqual({ days: null, sample: 0 });
  });

  // The regression worth guarding: a completion date typed in before the lead
  // existed is bad data. Counted as a 0-day job it drags the average down for
  // free and the number quietly stops meaning anything.
  it("drops jobs that finished before their lead was created", () => {
    const result = averageTurnaroundDays([
      { leadCreatedAt: daysAgo(50), completedAt: daysAgo(10), installDate: null }, // 40d
      { leadCreatedAt: daysAgo(5), completedAt: daysAgo(30), installDate: null }, // negative
    ]);
    expect(result).toEqual({ days: 40, sample: 1 });
  });

  it("counts the sample so a thin average looks thin", () => {
    expect(averageTurnaroundDays([]).sample).toBe(0);
  });
});

describe("pipelineHealth", () => {
  const stage = (targetDays: number) => ({ targetDays });

  it("counts deals past their stage day-limit", () => {
    const health = pipelineHealth(
      [
        { createdAt: daysAgo(30), stageChangedAt: daysAgo(12), stage: stage(7) }, // overdue
        { createdAt: daysAgo(30), stageChangedAt: daysAgo(2), stage: stage(7) }, // on track
      ],
      NOW,
    );
    expect(health.overdueJobs).toBe(1);
    expect(health.openDeals).toBe(2);
  });

  // Permit review and utility interconnection carry targetDays 0 on purpose —
  // they are externally blocked and may never report as overdue.
  it("never calls an untracked stage overdue", () => {
    const health = pipelineHealth(
      [{ createdAt: daysAgo(200), stageChangedAt: daysAgo(180), stage: stage(0) }],
      NOW,
    );
    expect(health.overdueJobs).toBe(0);
  });

  it("ages a deal from stage entry, falling back to creation", () => {
    const health = pipelineHealth(
      [
        { createdAt: daysAgo(100), stageChangedAt: daysAgo(10), stage: null },
        { createdAt: daysAgo(20), stageChangedAt: null, stage: null },
      ],
      NOW,
    );
    expect(health.avgDaysInStage).toBe(15);
  });

  it("reports no average with nothing open", () => {
    expect(pipelineHealth([], NOW)).toEqual({ openDeals: 0, overdueJobs: 0, avgDaysInStage: null });
  });
});

describe("summariseTeam", () => {
  const nameOf = (id: string) => ({ "u-1": "Ana Reyes", "u-2": "Bo Chen" })[id] ?? "Unnamed";
  const tally = (assignedRepId: string | null, status: LeadTally["status"], count: number): LeadTally => ({
    assignedRepId,
    status,
    count,
  });

  it("rolls per-rep appointments, wins, and close rate", () => {
    const summary = summariseTeam(
      [tally("u-1", "won", 3), tally("u-1", "open", 7), tally("u-2", "won", 1), tally("u-2", "lost", 3)],
      [
        { assignedRepId: "u-1", contractValue: 100_00 },
        { assignedRepId: "u-1", contractValue: 200_00 },
        { assignedRepId: "u-2", contractValue: 50_00 },
      ],
      nameOf,
      true,
    );
    expect(summary.rows.map((r) => r.name)).toEqual(["Ana Reyes", "Bo Chen"]);
    expect(summary.rows[0]).toMatchObject({ appointments: 10, won: 3, closeRatePct: 30, soldCents: 300_00 });
    expect(summary.rows[1]).toMatchObject({ appointments: 4, won: 1, closeRatePct: 25, soldCents: 50_00 });
  });

  // Unassigned deals are real appointments, so the scope-wide rate must include
  // them — but "Unassigned" is not a performer and gets no leaderboard row.
  it("counts unassigned deals in the scope rate but gives them no row", () => {
    const summary = summariseTeam(
      [tally("u-1", "won", 1), tally("u-1", "open", 1), tally(null, "open", 8)],
      [],
      nameOf,
      true,
    );
    expect(summary.totalLeads).toBe(10);
    expect(summary.wonLeads).toBe(1);
    expect(summary.closeRatePct).toBe(10);
    expect(summary.rows).toHaveLength(1);
  });

  it("withholds money from viewers who may not see it", () => {
    const summary = summariseTeam(
      [tally("u-1", "won", 1)],
      [{ assignedRepId: "u-1", contractValue: 999_00 }],
      nameOf,
      false,
    );
    expect(summary.rows[0].soldCents).toBeNull();
  });

  it("reports no close rate rather than 0% with no deals", () => {
    expect(summariseTeam([], [], nameOf, true)).toMatchObject({ closeRatePct: null, rows: [] });
  });

  it("ranks by wins, then volume", () => {
    const summary = summariseTeam(
      [tally("u-1", "won", 1), tally("u-1", "open", 20), tally("u-2", "won", 5)],
      [],
      nameOf,
      true,
    );
    expect(summary.rows.map((r) => r.name)).toEqual(["Bo Chen", "Ana Reyes"]);
  });
});
