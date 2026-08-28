import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";
import { sendForSignatureAction } from "../actions/send-for-signature";
import type { ActionContext } from "../types";

/**
 * Sending a document for signature with nobody logged in.
 *
 * No email actually leaves: with no RESEND_API_KEY and no SMTP_* the delivery
 * helper prints to the console. That absence is deliberate and must stay —
 * it is the one thing standing between a local test and real mail landing in a
 * real homeowner's inbox.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let templateId: string;
let withEmail: string;
let withoutEmail: string;
let repLead: string;

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "Sign Co", slug: `sg-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;
  const t = await db.documentTemplate.create({
    data: {
      companyId,
      vertical: "solar",
      name: "Lien Waiver",
      pages: [{ width: 612, height: 792 }],
    },
  });
  templateId = t.id;

  withEmail = (
    await db.lead.create({
      data: {
        companyId,
        vertical: "solar",
        firstName: "Has",
        lastName: "Email",
        email: "has@example.com",
      },
    })
  ).id;

  withoutEmail = (
    await db.lead.create({
      data: { companyId, vertical: "solar", firstName: "No", lastName: "Email" },
    })
  ).id;

  const rep = await db.user.create({
    data: {
      companyId,
      email: `rep-${process.pid}-${Date.now()}@example.com`,
      firstName: "Tyler",
      lastName: "Brooks",
      role: "sales_rep",
    },
  });
  repLead = (
    await db.lead.create({
      data: {
        companyId,
        vertical: "solar",
        firstName: "Rep",
        lastName: "Deal",
        assignedRepId: rep.id,
      },
    })
  ).id;
});

afterAll(async () => {
  await db.documentSigner.deleteMany({ where: { companyId } });
  await db.documentPackage.deleteMany({ where: { companyId } });
  await db.documentTemplate.deleteMany({ where: { companyId } });
  await db.activityLog.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId } });
  await db.user.deleteMany({ where: { companyId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

const run = (leadId: string, config: unknown, over: Partial<ActionContext> = {}) =>
  runInVertical("solar", () =>
    sendForSignatureAction.run({ companyId, vertical: "solar", leadId, config, depth: 0, ...over })
  );

describe("send_for_signature", () => {
  it("creates a sent package addressed to the customer", async () => {
    const res = await run(withEmail, { templateId, signer: "customer" });
    expect(res.ok).toBe(true);

    const pkg = await db.documentPackage.findFirst({ where: { leadId: withEmail } });
    expect(pkg?.status).toBe("sent");
    // Nobody clicked send, so nobody is recorded as having.
    expect(pkg?.createdById).toBeNull();

    const signer = await db.documentSigner.findFirst({ where: { packageId: pkg!.id } });
    expect(signer?.email).toBe("has@example.com");
    expect(signer?.role).toBe("customer");
  });

  it("can address the assigned rep instead", async () => {
    const res = await run(repLead, { templateId, signer: "assigned_rep" });
    expect(res.ok).toBe(true);
    const pkg = await db.documentPackage.findFirst({ where: { leadId: repLead } });
    const signer = await db.documentSigner.findFirst({ where: { packageId: pkg!.id } });
    expect(signer?.role).toBe("company_rep");
    expect(signer?.name).toBe("Tyler Brooks");
  });

  it("fails rather than sending a document nowhere", async () => {
    const res = await run(withoutEmail, { templateId, signer: "customer" });
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/no email/i);
    expect(await db.documentPackage.count({ where: { leadId: withoutEmail } })).toBe(0);
  });

  it("fails when the deal has no assigned rep", async () => {
    const res = await run(withEmail, { templateId, signer: "assigned_rep" });
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/no assigned rep/i);
  });

  it("rejects an unknown signer role", () => {
    expect(sendForSignatureAction.parseConfig({ templateId, signer: "the dog" }).ok).toBe(false);
  });
});
