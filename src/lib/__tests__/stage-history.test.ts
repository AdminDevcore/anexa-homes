import { describe, it, expect } from "vitest";
import {
  buildTimeline,
  daysBetween,
  formatDuration,
  isCompletionStage,
  isSaleStage,
  type StageEventRow,
} from "../stage-history";

const NOW = new Date("2026-01-20T00:00:00.000Z");

function ev(name: string, entered: string, exited: string | null, position = 0): StageEventRow {
  return {
    id: `${name}-${entered}`,
    stageId: name,
    stageName: name,
    position,
    enteredAt: entered,
    exitedAt: exited,
  };
}

describe("isCompletionStage", () => {
  it("treats a won stage as completion whatever it is called", () => {
    expect(isCompletionStage({ name: "Fully Funded", isWon: true })).toBe(true);
  });

  it("matches the install-completion stages", () => {
    for (const n of [
      "Install Complete",
      "Installed",
      "install completed",
      "Installation Complete",
    ]) {
      expect(isCompletionStage({ name: n })).toBe(true);
    }
  });

  it("does NOT match stages that merely start with install", () => {
    for (const n of [
      "Install Scheduled",
      "Install Ready",
      "Install In Progress / MPU",
      "Install Closed",
      "Install",
    ]) {
      expect(isCompletionStage({ name: n })).toBe(false);
    }
  });
});

describe("isSaleStage", () => {
  it("matches however a board writes the signature", () => {
    for (const n of [
      "Contract Signed",
      "Contract Signed / Hold",
      "contract signed",
      "Signed",
      "Sold",
    ]) {
      expect(isSaleStage({ name: n })).toBe(true);
    }
  });

  it("does NOT match the stages either side of it", () => {
    for (const n of [
      "Contract Sent",
      "Hold",
      "Front check received",
      "Install Complete",
      "Unsigned",
    ]) {
      expect(isSaleStage({ name: n })).toBe(false);
    }
  });
});

describe("buildTimeline", () => {
  it("measures the days a deal spent in each stage", () => {
    // The example from the spec: created Jan 1, signed Jan 4.
    const t = buildTimeline(
      [
        ev("New Appointment", "2026-01-01T00:00:00.000Z", "2026-01-04T00:00:00.000Z"),
        ev("Contract Signed", "2026-01-04T00:00:00.000Z", null),
      ],
      { createdAt: "2026-01-01T00:00:00.000Z", now: NOW }
    );
    expect(t.rows[0].days).toBe(3);
    expect(t.rows[0].current).toBe(false);
    expect(t.rows[1].days).toBe(16);
    expect(t.rows[1].current).toBe(true);
  });

  it("counts the first stage from deal creation, not from the first logged event", () => {
    // A backfilled deal whose first recorded move is days after it was created:
    // that gap is real time the deal sat in stage one and must not evaporate.
    const t = buildTimeline([ev("New Appointment", "2026-01-06T00:00:00.000Z", null)], {
      createdAt: "2026-01-01T00:00:00.000Z",
      now: NOW,
    });
    expect(t.startedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(t.rows[0].days).toBe(19);
  });

  it("stops the total clock at install complete", () => {
    const t = buildTimeline(
      [
        ev("New Appointment", "2026-01-01T00:00:00.000Z", "2026-01-04T00:00:00.000Z"),
        ev("Install Complete", "2026-01-04T00:00:00.000Z", "2026-01-05T00:00:00.000Z"),
        ev("Inspection Scheduled", "2026-01-05T00:00:00.000Z", null),
      ],
      { createdAt: "2026-01-01T00:00:00.000Z", now: NOW }
    );
    expect(t.completedAt).toBe("2026-01-04T00:00:00.000Z");
    expect(t.totalDays).toBe(3);
    expect(t.rows[1].completion).toBe(true);
  });

  it("keeps the total running while the deal is still open", () => {
    const t = buildTimeline([ev("New Appointment", "2026-01-01T00:00:00.000Z", null)], {
      createdAt: "2026-01-01T00:00:00.000Z",
      now: NOW,
    });
    expect(t.completedAt).toBeNull();
    expect(t.totalDays).toBe(19);
  });

  it("uses the FIRST completion when a deal bounces back and re-completes", () => {
    const t = buildTimeline(
      [
        ev("New Appointment", "2026-01-01T00:00:00.000Z", "2026-01-04T00:00:00.000Z"),
        ev("Installed", "2026-01-04T00:00:00.000Z", "2026-01-06T00:00:00.000Z"),
        ev("Inspection Action Required", "2026-01-06T00:00:00.000Z", "2026-01-09T00:00:00.000Z"),
        ev("Installed", "2026-01-09T00:00:00.000Z", null),
      ],
      { createdAt: "2026-01-01T00:00:00.000Z", now: NOW }
    );
    expect(t.completedAt).toBe("2026-01-04T00:00:00.000Z");
    expect(t.totalDays).toBe(3);
  });

  it("honours the won-stage set for pipelines whose finish line is named oddly", () => {
    const t = buildTimeline(
      [
        ev("New Appointment", "2026-01-01T00:00:00.000Z", "2026-01-10T00:00:00.000Z"),
        ev("Fully Funded", "2026-01-10T00:00:00.000Z", null),
      ],
      { createdAt: "2026-01-01T00:00:00.000Z", now: NOW, wonStageIds: new Set(["Fully Funded"]) }
    );
    expect(t.completedAt).toBe("2026-01-10T00:00:00.000Z");
    expect(t.totalDays).toBe(9);
  });

  it("sorts events that arrive out of order and reports the slowest stage", () => {
    const t = buildTimeline(
      [
        ev("Permit Submitted", "2026-01-04T00:00:00.000Z", "2026-01-19T00:00:00.000Z"),
        ev("New Appointment", "2026-01-01T00:00:00.000Z", "2026-01-04T00:00:00.000Z"),
      ],
      { createdAt: "2026-01-01T00:00:00.000Z", now: NOW }
    );
    expect(t.rows.map((r) => r.stageName)).toEqual(["New Appointment", "Permit Submitted"]);
    expect(t.slowest?.stageName).toBe("Permit Submitted");
    expect(t.slowest?.days).toBe(15);
  });

  it("reports days-from-start for every stage entry", () => {
    const t = buildTimeline(
      [
        ev("New Appointment", "2026-01-01T00:00:00.000Z", "2026-01-04T00:00:00.000Z"),
        ev("Contract Signed", "2026-01-04T00:00:00.000Z", "2026-01-11T00:00:00.000Z"),
        ev("NTP Submitted", "2026-01-11T00:00:00.000Z", null),
      ],
      { createdAt: "2026-01-01T00:00:00.000Z", now: NOW }
    );
    expect(t.rows.map((r) => r.daysFromStart)).toEqual([0, 3, 10]);
  });

  it("survives a deal with no recorded events at all", () => {
    const t = buildTimeline([], { createdAt: "2026-01-01T00:00:00.000Z", now: NOW });
    expect(t.rows).toEqual([]);
    expect(t.slowest).toBeNull();
    expect(t.totalDays).toBe(19);
  });

  it("runs a second clock from the signature to the finish", () => {
    // The office is judged on the half of the run it can shorten. 10 days from
    // the lead, of which only 6 are after the homeowner signed.
    const t = buildTimeline(
      [
        ev("New Appointment", "2026-01-01T00:00:00.000Z", "2026-01-05T00:00:00.000Z"),
        ev("Contract Signed / Hold", "2026-01-05T00:00:00.000Z", "2026-01-08T00:00:00.000Z"),
        ev("Install Scheduled", "2026-01-08T00:00:00.000Z", "2026-01-11T00:00:00.000Z"),
        ev("Install Complete", "2026-01-11T00:00:00.000Z", null),
      ],
      { createdAt: "2026-01-01T00:00:00.000Z", now: NOW }
    );
    expect(t.totalDays).toBe(10);
    expect(t.signedAt).toBe("2026-01-05T00:00:00.000Z");
    expect(t.signedDays).toBe(6);
  });

  it("dates the signature from the FIRST time it was signed", () => {
    // Put back on hold and re-signed. The contract existed from January 5.
    const t = buildTimeline(
      [
        ev("Contract Signed", "2026-01-05T00:00:00.000Z", "2026-01-06T00:00:00.000Z"),
        ev("NTP Action Required", "2026-01-06T00:00:00.000Z", "2026-01-09T00:00:00.000Z"),
        ev("Contract Signed", "2026-01-09T00:00:00.000Z", "2026-01-11T00:00:00.000Z"),
        ev("Installed", "2026-01-11T00:00:00.000Z", null),
      ],
      { createdAt: "2026-01-01T00:00:00.000Z", now: NOW }
    );
    expect(t.signedAt).toBe("2026-01-05T00:00:00.000Z");
    expect(t.signedDays).toBe(6);
  });

  it("keeps the signed clock running on a deal that has not finished", () => {
    const t = buildTimeline(
      [
        ev("New Appointment", "2026-01-01T00:00:00.000Z", "2026-01-10T00:00:00.000Z"),
        ev("Contract Signed", "2026-01-10T00:00:00.000Z", null),
      ],
      { createdAt: "2026-01-01T00:00:00.000Z", now: NOW }
    );
    expect(t.completedAt).toBeNull();
    expect(t.signedDays).toBe(10);
  });

  it("reports no signed clock at all on a deal nobody has signed", () => {
    // Null, not zero: zero would read as "signed and installed the same day".
    const t = buildTimeline([ev("New Appointment", "2026-01-01T00:00:00.000Z", null)], {
      createdAt: "2026-01-01T00:00:00.000Z",
      now: NOW,
    });
    expect(t.signedAt).toBeNull();
    expect(t.signedDays).toBeNull();
  });

  it("never reports negative time from a clock skew", () => {
    expect(daysBetween("2026-01-10T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).toBe(0);
  });
});

describe("formatDuration", () => {
  it("reads as a human would say it", () => {
    expect(formatDuration(0)).toBe("< 1 hour");
    expect(formatDuration(5 / 24)).toBe("5 hours");
    expect(formatDuration(1)).toBe("1 day");
    expect(formatDuration(3.4)).toBe("3 days");
  });
});
