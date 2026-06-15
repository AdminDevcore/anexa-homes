import { prisma } from "@/server/db/client";
import type { KnockDisposition, Prisma } from "@prisma/client";
import type { Period, RenderableReport, ResolvedScope } from "./builders";

type ReportUser = { companyId: string; userId: string; role: string };
const pct = (n: number) => `${n.toFixed(1)}%`;

// "No contact" dispositions — nobody answered the door. Everything else means a
// conversation happened.
const NO_CONTACT = new Set<KnockDisposition>(["not_knocked", "not_home", "dnk"]);
const isContact = (d: KnockDisposition) => !NO_CONTACT.has(d);

/**
 * Door-to-door canvassing productivity for knocks logged in the period. The full
 * knock→contact→appointment→lead→sale funnel, broken out per canvasser, per
 * disposition, and per territory.
 */
export async function buildCanvassingReport(user: ReportUser, period: Period, scope: ResolvedScope): Promise<RenderableReport> {
  const inPeriod = { gte: period.from, lte: period.to };
  // Knocks are keyed by the canvasser (repId), so scope by the people in scope.
  const repFilter: Prisma.KnockWhereInput = scope.isCompany ? {} : { repId: { in: scope.userIds ?? [] } };

  const knocks = await prisma.knock.findMany({
    where: { companyId: user.companyId, knockedAt: inPeriod, ...repFilter },
    select: {
      disposition: true,
      leadId: true,
      appointmentAt: true,
      rep: { select: { firstName: true, lastName: true } },
      territory: { select: { name: true } },
    },
  });

  const total = knocks.length;
  const madeAppt = (k: (typeof knocks)[number]) => k.disposition === "appointment" || k.appointmentAt != null;

  type Rep = { knocks: number; contacts: number; appts: number; leads: number; sold: number };
  const byRep = new Map<string, Rep>();
  const byTerr = new Map<string, { knocks: number; appts: number; leads: number }>();
  const byDispo = new Map<string, number>();
  let contacts = 0, appts = 0, leads = 0, sold = 0;

  for (const k of knocks) {
    const contact = isContact(k.disposition);
    const appt = madeAppt(k);
    if (contact) contacts++;
    if (appt) appts++;
    if (k.leadId) leads++;
    if (k.disposition === "sold") sold++;

    const rep = k.rep ? `${k.rep.firstName} ${k.rep.lastName}`.trim() || "—" : "Unassigned";
    const r = byRep.get(rep) ?? { knocks: 0, contacts: 0, appts: 0, leads: 0, sold: 0 };
    r.knocks++; if (contact) r.contacts++; if (appt) r.appts++; if (k.leadId) r.leads++; if (k.disposition === "sold") r.sold++;
    byRep.set(rep, r);

    const terr = k.territory?.name ?? "Unassigned";
    const t = byTerr.get(terr) ?? { knocks: 0, appts: 0, leads: 0 };
    t.knocks++; if (appt) t.appts++; if (k.leadId) t.leads++;
    byTerr.set(terr, t);

    byDispo.set(k.disposition, (byDispo.get(k.disposition) ?? 0) + 1);
  }

  const rate = (n: number) => pct(total > 0 ? (n / total) * 100 : 0);
  const dispoLabel = (d: string) => d.replace(/_/g, " ");

  return {
    title: "Canvassing Productivity",
    periodLabel: period.label,
    scopeLabel: scope.label,
    metrics: [
      { label: "Knocks", value: String(total), hint: "in period" },
      { label: "Contacts made", value: String(contacts), hint: rate(contacts) },
      { label: "Appointments", value: String(appts), tone: "pos", hint: rate(appts) },
      { label: "Leads created", value: String(leads), hint: rate(leads) },
      { label: "Sold", value: String(sold), tone: "pos" },
      { label: "Knock → lead", value: rate(leads) },
    ],
    tables: [
      {
        title: "By canvasser",
        columns: ["Canvasser", "Knocks", "Contacts", "Appts", "Leads", "Sold", "Appt rate"],
        rows: [...byRep.entries()]
          .sort((a, b) => b[1].knocks - a[1].knocks)
          .map(([rep, e]) => [rep, e.knocks, e.contacts, e.appts, e.leads, e.sold, pct(e.knocks > 0 ? (e.appts / e.knocks) * 100 : 0)]),
      },
      {
        title: "By disposition",
        columns: ["Disposition", "Knocks", "Share"],
        rows: [...byDispo.entries()].sort((a, b) => b[1] - a[1]).map(([d, c]) => [dispoLabel(d), c, rate(c)]),
      },
      {
        title: "By territory",
        columns: ["Territory", "Knocks", "Appts", "Leads"],
        rows: [...byTerr.entries()].sort((a, b) => b[1].knocks - a[1].knocks).map(([t, e]) => [t, e.knocks, e.appts, e.leads]),
      },
    ],
  };
}
