import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { AccessUser } from "@/server/rbac/guards";
import { runInVertical } from "@/server/vertical/context";
import { getCalendarEvents } from "@/server/modules/calendar/queries";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";

/**
 * A job has two scheduled visits and they send different people. The claim
 * under test is that each person's calendar carries the visit they are ON, and
 * only that one:
 *
 *   • the install crew sees the install, not the inspection that follows it
 *   • the inspection crew sees the inspection, not the install before it
 *   • an unassigned installer sees neither
 *   • the office sees both, with the names on each
 *
 * Written against a real database rather than asserted on a `where` fragment
 * because the bug this replaces was exactly a where-clause that type-checked
 * and matched nothing: assignment wrote `ProjectAssignee` while visibility read
 * `ProjectCrew`, so being added to an install granted precisely nothing and the
 * only symptom was an empty calendar.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const raw = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

const WINDOW_FROM = new Date("2026-09-01T00:00:00Z");
const WINDOW_TO = new Date("2026-09-30T23:59:59Z");
const INSTALL_AT = new Date("2026-09-10T15:00:00Z");
const INSPECT_AT = new Date("2026-09-24T15:00:00Z");

let companyId: string;
let leadId: string;
let installerA: string; // on the install
let installerB: string; // on the inspection
let installerC: string; // on neither
let owner: string;

const user = (userId: string, role: AccessUser["role"]): AccessUser =>
  ({ userId, companyId, role, permissions: {} }) as AccessUser;

async function makeInstaller(tag: string, first: string) {
  const u = await raw.user.create({
    data: {
      companyId,
      email: `${tag}-${process.pid}@test.local`,
      passwordHash: "x",
      firstName: first,
      lastName: "Crew",
      role: "installer",
      verticals: ["roofing", "solar"],
    },
  });
  return u.id;
}

async function resetFixtures() {
  await raw.$executeRawUnsafe('TRUNCATE TABLE "companies" CASCADE');
  const company = await raw.company.create({
    data: { name: "Visit Crew Co", slug: `vc-${process.pid}`, overheadPct: 0, paFeePct: 0 },
  });
  companyId = company.id;

  installerA = await makeInstaller("inst-a", "Ann");
  installerB = await makeInstaller("inst-b", "Bo");
  installerC = await makeInstaller("inst-c", "Cal");
  owner = (
    await raw.user.create({
      data: {
        companyId,
        email: `owner-${process.pid}@test.local`,
        passwordHash: "x",
        firstName: "Ola",
        lastName: "Owner",
        role: "super_admin",
        verticals: ["roofing", "solar"],
      },
    })
  ).id;

  // One solar deal carrying BOTH dates — the whole question is whether two
  // visits on one job can be staffed and seen separately.
  const lead = await raw.lead.create({
    data: { companyId, vertical: "solar", firstName: "Sun", lastName: "House", address: "9 Ray Rd", city: "Dallas" },
  });
  leadId = lead.id;
  const project = await raw.project.create({
    data: {
      companyId,
      vertical: "solar",
      leadId: lead.id,
      projectNumber: `S-${process.pid}`,
      installDate: INSTALL_AT,
      inspectionAt: INSPECT_AT,
    },
  });

  await raw.projectAssignee.createMany({
    data: [
      { companyId, projectId: project.id, userId: installerA, kind: "install", role: "Lead installer" },
      { companyId, projectId: project.id, userId: installerB, kind: "inspection" },
    ],
  });
}

const calendarFor = (u: AccessUser) =>
  runInVertical("solar", () => getCalendarEvents(u, "solar", WINDOW_FROM, WINDOW_TO));

beforeAll(resetFixtures);
beforeEach(resetFixtures);
afterAll(async () => {
  await raw.$disconnect();
});

describe("a visit lands on the calendar of the people on it", () => {
  it("the install crew sees the install and not the inspection", async () => {
    const events = await calendarFor(user(installerA, "installer"));
    expect(events.map((e) => e.type)).toEqual(["install"]);
    expect(events[0].crew).toEqual(["Ann Crew"]);
    expect(events[0].date).toBe(INSTALL_AT.toISOString());
  });

  it("the inspection crew sees the inspection and not the install", async () => {
    const events = await calendarFor(user(installerB, "installer"));
    expect(events.map((e) => e.type)).toEqual(["inspection"]);
    expect(events[0].crew).toEqual(["Bo Crew"]);
    expect(events[0].date).toBe(INSPECT_AT.toISOString());
  });

  it("an installer on neither visit sees an empty calendar", async () => {
    expect(await calendarFor(user(installerC, "installer"))).toEqual([]);
  });

  it("the office sees both visits, each with its own crew", async () => {
    const events = await calendarFor(user(owner, "super_admin"));
    expect(events.map((e) => e.type)).toEqual(["install", "inspection"]);
    expect(events[0].crew).toEqual(["Ann Crew"]);
    expect(events[1].crew).toEqual(["Bo Crew"]);
    // The address leads the card: it is what someone driving there needs.
    expect(events[0].subtitle).toBe("9 Ray Rd, Dallas");
  });

  it("the deal opens for the office and not for the crew", async () => {
    // Being named on Tuesday's install is not admission to the homeowner's
    // contract — the crew reach the job, never the deal. This was a null href
    // and a hidden button until 77237d0: an installer has to submit his own
    // invoice, sometimes weeks after the visit has scrolled off the calendar,
    // so /portal/jobs/[id] now carries exactly what being on a visit entitles
    // him to — where it is, when it is, and the slot to invoice it. No claim,
    // no documents, no notes, no homeowner phone number.
    const office = await calendarFor(user(owner, "super_admin"));
    expect(office[0].href).toBe(`/portal/leads/${leadId}`);
    const project = await raw.project.findFirstOrThrow({ where: { leadId } });
    const crew = await calendarFor(user(installerA, "installer"));
    expect(crew[0].href).toBe(`/portal/jobs/${project.id}`);
  });

  it("un-assigning takes the visit back off that person's calendar", async () => {
    await raw.projectAssignee.deleteMany({ where: { userId: installerA } });
    expect(await calendarFor(user(installerA, "installer"))).toEqual([]);
    // …and leaves the other visit exactly where it was.
    const b = await calendarFor(user(installerB, "installer"));
    expect(b.map((e) => e.type)).toEqual(["inspection"]);
  });

  it("the same person can be on both visits without colliding", async () => {
    const project = await raw.project.findFirstOrThrow({ where: { leadId } });
    await raw.projectAssignee.create({
      data: { companyId, projectId: project.id, userId: installerA, kind: "inspection" },
    });
    const events = await calendarFor(user(installerA, "installer"));
    expect(events.map((e) => e.type)).toEqual(["install", "inspection"]);
  });
});

describe("roofing's standing crews are untouched by per-visit assignment", () => {
  /**
   * Roofing staffs jobs with a `Crew` and reaches its installers only through
   * that relation. Per-visit assignment added a second route; it must not have
   * closed the first, and roofing installers must keep the DEAL access they
   * have today rather than being demoted to calendar-only.
   */
  it("a crew member still sees the roofing install, and can still open the deal", async () => {
    const lead = await raw.lead.create({
      data: { companyId, vertical: "roofing", firstName: "Rain", lastName: "Gutter", address: "4 Shingle St", city: "Plano" },
    });
    const project = await raw.project.create({
      data: { companyId, vertical: "roofing", leadId: lead.id, projectNumber: `R-${process.pid}`, installDate: INSTALL_AT },
    });
    const crew = await raw.crew.create({
      data: { companyId, name: `Crew ${process.pid}`, members: { create: { name: "Cal Crew", userId: installerC } } },
    });
    await raw.projectCrew.create({ data: { projectId: project.id, crewId: crew.id } });

    const events = await runInVertical("roofing", () =>
      getCalendarEvents(user(installerC, "installer"), "roofing", WINDOW_FROM, WINDOW_TO)
    );
    expect(events.map((e) => e.type)).toEqual(["install"]);
    expect(events[0].href).toBe(`/portal/leads/${lead.id}`);
    // Nobody was NAMED on it, and the section says so rather than staying blank.
    expect(events[0].crew).toEqual([]);
  });
});
