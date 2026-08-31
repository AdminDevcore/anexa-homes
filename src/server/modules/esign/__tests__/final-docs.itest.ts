import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";

/**
 * SENDING THE CLOSEOUT PACKET FROM THE FINISHED JOB.
 *
 * The packet is decided once, in the template editor, and the button on the
 * deal sends whatever carries the flag — as ONE envelope, to the homeowner.
 * What these hold is the three ways that can go wrong quietly: the wrong
 * documents, the wrong order, and a signature request addressed nowhere.
 *
 * No email leaves. With no RESEND_API_KEY and no SMTP_* the delivery helper
 * prints to the console, and that absence is the one thing standing between a
 * local test and real mail in a real homeowner's inbox.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const session = vi.hoisted(() => ({ requireUser: vi.fn(), getSessionUser: vi.fn() }));
vi.mock("@/server/auth/session", () => session);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { sendFinalDocsAction } = await import("../actions");

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let leadId: string;
let noEmailLeadId: string;
let certId: string;
let attestId: string;

/** A template with a real page, so the send is not refused for a missing PDF. */
const template = (name: string, over: Record<string, unknown> = {}) =>
  db.documentTemplate.create({
    data: {
      companyId,
      vertical: "solar",
      name,
      pages: [{ width: 612, height: 792 }],
      ...over,
    },
  });

/**
 * The company and its two homeowners are made once; the paperwork is rebuilt
 * per test, because most of these cases change what is in the packet. Scoped
 * deletes rather than a schema truncate: nothing here needs to reach another
 * company's rows, and raw SQL would step outside the vertical extension.
 */
async function company() {
  const c = await db.company.create({
    data: { name: "Packet Co", slug: `pk-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;

  leadId = (
    await db.lead.create({
      data: {
        companyId,
        vertical: "solar",
        firstName: "Dana",
        lastName: "Reyes",
        email: "dana@example.com",
      },
    })
  ).id;
  noEmailLeadId = (
    await db.lead.create({
      data: { companyId, vertical: "solar", firstName: "No", lastName: "Email" },
    })
  ).id;
}

async function fixtures() {
  // Packages first: a template a package points at cannot be deleted.
  await db.documentPackage.deleteMany({ where: { companyId } });
  await db.documentTemplate.deleteMany({ where: { companyId } });

  // Created in packet order, which IS the print order.
  certId = (await template("Certificate of Acceptance", { finalPacket: true })).id;
  attestId = (await template("Attestation of Customer Payment", { finalPacket: true })).id;
  // In the same company, deliberately not in the packet.
  await template("Solar Sales Agreement");
  // Ticked but retired: a template nobody can pick should not travel either.
  await template("Old Waiver", { finalPacket: true, active: false });

  session.requireUser.mockResolvedValue({
    userId: "pm-session",
    companyId,
    fullName: "Pat Moore",
    role: "super_admin",
    permissions: {},
  });
}

beforeAll(async () => {
  await company();
  await fixtures();
});
beforeEach(fixtures);
afterAll(async () => {
  await db.documentPackage.deleteMany({ where: { companyId } });
  await db.documentTemplate.deleteMany({ where: { companyId } });
  await db.activityLog.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

const send = (id: string) => runInVertical("solar", () => sendFinalDocsAction(id));

describe("send final docs to customer", () => {
  it("sends every ticked template as ONE envelope, in creation order", async () => {
    const res = await send(leadId);
    expect(res.ok).toBe(true);

    const packages = await db.documentPackage.findMany({ where: { leadId } });
    expect(packages).toHaveLength(1);
    expect(packages[0].status).toBe("sent");
    // The envelope's own template is the first of the packet.
    expect(packages[0].templateId).toBe(certId);

    const snapshot = packages[0].snapshot as { templateIds?: string[] };
    expect(snapshot.templateIds).toEqual([certId, attestId]);
    // Named for what it carries, so the deal's folder reads as the packet.
    expect(packages[0].title).toContain("Certificate of Acceptance");
    expect(packages[0].title).toContain("Attestation of Customer Payment");
  });

  it("addresses the homeowner, and nobody else", async () => {
    await send(leadId);
    const pkg = await db.documentPackage.findFirstOrThrow({ where: { leadId } });
    const signers = await db.documentSigner.findMany({ where: { packageId: pkg.id } });

    expect(signers).toHaveLength(1);
    expect(signers[0]).toMatchObject({
      role: "customer",
      name: "Dana Reyes",
      email: "dana@example.com",
    });
  });

  it("records who sent it — this one had somebody click it", async () => {
    await send(leadId);
    const pkg = await db.documentPackage.findFirstOrThrow({ where: { leadId } });
    expect(pkg.createdById).toBe("pm-session");
  });

  it("refuses rather than sending a signature request nowhere", async () => {
    const res = await send(noEmailLeadId);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/no email address/i);
    expect(await db.documentPackage.count({ where: { leadId: noEmailLeadId } })).toBe(0);
  });

  it("says so when nothing has been marked as a final document", async () => {
    await db.documentTemplate.updateMany({ where: { companyId }, data: { finalPacket: false } });
    const res = await send(leadId);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/marked as final documents/i);
    expect(await db.documentPackage.count({ where: { leadId } })).toBe(0);
  });

  it("refuses a deal the viewer cannot see", async () => {
    session.requireUser.mockResolvedValue({
      userId: "other-rep",
      companyId,
      fullName: "Other Rep",
      role: "sales_rep",
      permissions: {},
    });
    const res = await send(leadId);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/not found/i);
    expect(await db.documentPackage.count({ where: { leadId } })).toBe(0);
  });

  it("refuses a role that may not send documents at all", async () => {
    session.requireUser.mockResolvedValue({
      userId: "crew-session",
      companyId,
      fullName: "Crew Member",
      role: "installer",
      permissions: {},
    });
    const res = await send(leadId);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/not allowed/i);
    expect(await db.documentPackage.count({ where: { leadId } })).toBe(0);
  });

  it("can be sent again — the earlier envelope stays as it is", async () => {
    await send(leadId);
    const first = await db.documentPackage.findFirstOrThrow({ where: { leadId } });
    const again = await send(leadId);
    expect(again.ok).toBe(true);

    const all = await db.documentPackage.findMany({ where: { leadId }, orderBy: { createdAt: "asc" } });
    expect(all).toHaveLength(2);
    expect(all[0].id).toBe(first.id);
    expect(all[0].status).toBe("sent");
  });
});
