import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { listScope } from "@/server/rbac/policies";
import { getCalendarEvents } from "@/server/modules/calendar/queries";
import { refuseUnless } from "../access";
import { NOT_SET, formatDateTime, zonedDayRange } from "../format";
import { defineTool, z } from "./define";

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

export const listAppointments = defineTool({
  name: "list_appointments",
  kind: "read",
  description:
    "Solar appointments between two dates (inclusive), with customer, time, address, rep and outcome.",
  input: z.object({
    from: DAY.describe("First day, YYYY-MM-DD, in the company's timezone."),
    to: DAY.describe("Last day (inclusive), YYYY-MM-DD."),
  }),
  async run(ctx, { from, to }) {
    const refused = refuseUnless(ctx.user, "read", "Lead", "see appointments");
    if (refused) return refused;

    let range: { start: Date; endExclusive: Date };
    try {
      range = zonedDayRange(from, to, ctx.timeZone);
    } catch (e) {
      return { ok: false, reason: "invalid", message: (e as Error).message };
    }

    // The calendar's own read path: role scope, workspace, cancelled deals out.
    const events = (
      await getCalendarEvents(ctx.user, "solar", range.start, new Date(range.endExclusive.getTime() - 1))
    ).filter((e) => e.type === "appointment");

    const ids = events.map((e) => e.id.replace(/^appt:/, ""));
    const scope = listScope(ctx.user, "Lead") as Prisma.LeadWhereInput;
    const outcomes = new Map(
      (
        await prisma.lead.findMany({
          where: { AND: [scope, { id: { in: ids } }] },
          select: { id: true, appointmentDisposition: true },
        })
      ).map((l) => [l.id, l.appointmentDisposition])
    );

    return {
      ok: true,
      data: {
        appointments: events
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(0, 40)
          .map((e) => {
            const id = e.id.replace(/^appt:/, "");
            return {
              deal_id: id,
              customer: e.title,
              when: formatDateTime(new Date(e.date), ctx.timeZone),
              address: e.subtitle ?? NOT_SET,
              assigned_rep: e.rep ?? NOT_SET,
              outcome: outcomes.get(id) ?? NOT_SET,
            };
          }),
        total: events.length,
      },
    };
  },
});
