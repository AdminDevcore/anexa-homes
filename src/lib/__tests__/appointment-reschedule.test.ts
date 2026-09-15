import { describe, it, expect } from "vitest";
import { planAppointmentMove, tracksReschedules } from "@/lib/appointment-reschedule";

const prevAt = new Date("2026-09-20T17:00:00Z");
const nextAt = new Date("2026-09-22T17:00:00Z");
const base = {
  vertical: "solar" as const,
  prevAt,
  nextAt,
  outcome: null as string | null,
  outcomeCategory: null as "ran" | "not_ran" | "rescheduled" | "cancelled" | null,
};

describe("planAppointmentMove", () => {
  it("moving a solar appointment to another time is a reschedule", () => {
    expect(planAppointmentMove(base)).toEqual({ fromAt: prevAt, toAt: nextAt, clearedOutcome: null });
  });

  it("booking a first time is not", () => {
    expect(planAppointmentMove({ ...base, prevAt: null })).toBeNull();
  });

  it("clearing the time is not", () => {
    expect(planAppointmentMove({ ...base, nextAt: null })).toBeNull();
  });

  // The full edit form re-sends the time on every save.
  it("re-saving the same minute is not", () => {
    expect(planAppointmentMove({ ...base, nextAt: new Date("2026-09-20T17:00:30Z") })).toBeNull();
  });

  // Fixing the time on a visit that happened is a correction, not a reschedule.
  it("leaves an appointment that already ran alone", () => {
    expect(
      planAppointmentMove({ ...base, outcome: "Signed — proposal accepted", outcomeCategory: "ran" })
    ).toBeNull();
  });

  it.each(["not_ran", "cancelled", "rescheduled"] as const)(
    "clears a %s outcome and carries it on the reschedule",
    (category) => {
      expect(planAppointmentMove({ ...base, outcome: "Old result", outcomeCategory: category })).toEqual({
        fromAt: prevAt,
        toAt: nextAt,
        clearedOutcome: "Old result",
      });
    }
  );

  it("never tracks roofing", () => {
    expect(tracksReschedules("roofing")).toBe(false);
    expect(planAppointmentMove({ ...base, vertical: "roofing" })).toBeNull();
    expect(
      planAppointmentMove({ ...base, vertical: "roofing", outcome: "No Show", outcomeCategory: "not_ran" })
    ).toBeNull();
  });
});
