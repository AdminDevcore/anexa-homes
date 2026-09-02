import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";
import { createSignaturePackage } from "../service";

/**
 * The company's half of a document, applied by the send itself.
 *
 * No email leaves: with no RESEND_API_KEY the delivery helper prints to the
 * console. That absence is deliberate — it is the one thing between a local
 * test and real mail reaching a real homeowner.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

const SIG = "data:image/png;base64,iVBORw0KGgo=";
const INI = "data:image/png;base64,aW5pdGlhbHM=";

let companyId: string;
let signerId: string;
let otherSignerId: string;
let leadId: string;
let coLeadId: string;
/** Customer signs, we counter-sign. */
let bothTemplate: string;
/** Nobody outside the company signs it — an installer attestation. */
let companyOnlyTemplate: string;
/** Has a company block but names a signer of its own. */
let namedSignerTemplate: string;
/** No company fields at all. */
let customerOnlyTemplate: string;

async function templateWith(
  name: string,
  fields: { type: "signature" | "initials" | "date" | "text"; signerRole: string; valueToken?: string }[],
  companySignerId?: string
) {
  const t = await db.documentTemplate.create({
    data: {
      companyId,
      vertical: "solar",
      name,
      pages: [{ width: 612, height: 792 }],
      companySignerId: companySignerId ?? null,
    },
  });
  let y = 700;
  for (const f of fields) {
    await db.documentTemplateField.create({
      data: {
        templateId: t.id,
        page: 1,
        x: 60,
        y: (y -= 40),
        width: 160,
        height: 40,
        type: f.type,
        signerRole: f.signerRole as "customer" | "co_customer" | "company_rep" | "witness",
        valueToken: f.valueToken ?? null,
      },
    });
  }
  return t.id;
}

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "Countersign Co", slug: `cs-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;

  signerId = (
    await db.companySigner.create({
      data: {
        companyId,
        name: "Mustafa Joulani",
        title: "Owner",
        licenseNumber: "TX-12345",
        credentials: [{ key: "nabcep", label: "NABCEP #", value: "PV-041234" }],
        signatureData: SIG,
        initialsData: INI,
        isDefault: true,
      },
    })
  ).id;

  otherSignerId = (
    await db.companySigner.create({
      data: { companyId, name: "Sofia Nguyen", title: "Project Manager", signatureData: SIG },
    })
  ).id;

  leadId = (
    await db.lead.create({
      data: {
        companyId,
        vertical: "solar",
        firstName: "Nancy",
        lastName: "Moore",
        email: "nancy@example.com",
      },
    })
  ).id;

  coLeadId = (
    await db.lead.create({
      data: {
        companyId,
        vertical: "solar",
        firstName: "Pat",
        lastName: "Reyes",
        email: "pat@example.com",
        coOwnerName: "Jo Reyes",
        coOwnerEmail: "jo@example.com",
      },
    })
  ).id;

  bothTemplate = await templateWith("Install Agreement", [
    { type: "signature", signerRole: "customer" },
    { type: "signature", signerRole: "company_rep" },
    { type: "date", signerRole: "company_rep" },
    { type: "text", signerRole: "company_rep", valueToken: "{{signer.title}}" },
  ]);
  companyOnlyTemplate = await templateWith("Installer Attestation", [
    { type: "signature", signerRole: "company_rep" },
    { type: "initials", signerRole: "company_rep" },
  ]);
  namedSignerTemplate = await templateWith(
    "Signed Final Permit",
    [{ type: "signature", signerRole: "company_rep" }],
    otherSignerId
  );
  customerOnlyTemplate = await templateWith("Photo Release", [
    { type: "signature", signerRole: "customer" },
  ]);
});

afterAll(async () => {
  await db.documentEvent.deleteMany({ where: { companyId } });
  await db.documentFieldValue.deleteMany({ where: { package: { companyId } } });
  await db.documentSigner.deleteMany({ where: { companyId } });
  await db.documentPackage.deleteMany({ where: { companyId } });
  await db.documentTemplateField.deleteMany({ where: { template: { companyId } } });
  await db.documentTemplate.deleteMany({ where: { companyId } });
  await db.fileAsset.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId } });
  await db.companySigner.deleteMany({ where: { companyId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

const send = (templateIds: string[], lead: string, signers: Parameters<typeof createSignaturePackage>[0]["input"]["signers"]) =>
  runInVertical("solar", () =>
    createSignaturePackage({
      companyId,
      actor: { id: "u1", name: "Sarah Chen" },
      input: { templateIds, leadId: lead, signers },
    })
  );

const customer = [{ role: "customer" as const, name: "Nancy Moore", email: "nancy@example.com", order: 1 }];

describe("the company signature is applied at send", () => {
  it("creates an already-signed company signer with the saved mark", async () => {
    const res = await send([bothTemplate], leadId, customer);

    const rep = await db.documentSigner.findFirst({
      where: { packageId: res.packageId, role: "company_rep" },
    });
    expect(rep?.status).toBe("signed");
    expect(rep?.signedAt).not.toBeNull();
    expect(rep?.signatureData).toBe(SIG);
    // Not a recipient: an address here would email a link for a signature that
    // already exists.
    expect(rep?.email).toBeNull();
    // After the humans, so the certificate reads in signing order.
    expect(rep!.order).toBeGreaterThan(1);
  });

  it("stamps the signature and the date, and leaves mapped text to its token", async () => {
    const res = await send([bothTemplate], leadId, customer);
    const values = await db.documentFieldValue.findMany({ where: { packageId: res.packageId } });
    const byType = new Map(values.map((v) => [v.type, v.value]));

    expect(byType.get("signature")).toBe(SIG);
    expect(byType.get("date")).toBeTruthy();
    // The title field is mapped to {{signer.title}} and resolved at stamp time
    // from the frozen snapshot — writing a value here too would be dead data.
    expect(byType.has("text")).toBe(false);
  });

  it("freezes the signer into the snapshot, so editing them later cannot rewrite it", async () => {
    const res = await send([bothTemplate], leadId, customer);
    const pkg = await db.documentPackage.findUnique({ where: { id: res.packageId } });
    const frozen = (pkg!.snapshot as { companySigner?: Record<string, unknown> }).companySigner;

    expect(frozen).toMatchObject({
      name: "Mustafa Joulani",
      title: "Owner",
      license: "TX-12345",
      appliedBy: "Sarah Chen",
    });

    await db.companySigner.update({ where: { id: signerId }, data: { title: "Chief Executive" } });
    const after = await db.documentPackage.findUnique({ where: { id: res.packageId } });
    expect((after!.snapshot as { companySigner?: { title: string } }).companySigner?.title).toBe("Owner");
    await db.companySigner.update({ where: { id: signerId }, data: { title: "Owner" } });
  });

  it("records who applied it, and on whose authority", async () => {
    const res = await send([bothTemplate], leadId, customer);
    const event = await db.documentEvent.findFirst({
      where: { packageId: res.packageId, type: "signed" },
    });
    expect(event?.actor).toContain("Mustafa Joulani");
    expect(event?.actor).toContain("Sarah Chen");
    expect(event?.metadata).toMatchObject({ onBehalfOf: "Mustafa Joulani", appliedBy: "Sarah Chen" });
  });

  it("uses the initials mark for an initials field", async () => {
    const res = await send([companyOnlyTemplate], leadId, []);
    const values = await db.documentFieldValue.findMany({ where: { packageId: res.packageId } });
    expect(values.find((v) => v.type === "initials")?.value).toBe(INI);
  });

  it("prefers the signer the template names over the company default", async () => {
    const res = await send([namedSignerTemplate], leadId, customer);
    const rep = await db.documentSigner.findFirst({
      where: { packageId: res.packageId, role: "company_rep" },
    });
    expect(rep?.name).toBe("Sofia Nguyen");
  });

  it("finishes a company-only document on the spot", async () => {
    // An installer attestation has no customer signer, so it never reaches the
    // completion check in recordSignature — the send has to run it.
    const res = await send([companyOnlyTemplate], leadId, []);
    const pkg = await db.documentPackage.findUnique({ where: { id: res.packageId } });
    expect(pkg?.status).toBe("completed");
    expect(pkg?.completedAt).not.toBeNull();
    expect(pkg?.signedFileId).not.toBeNull();
  });

  it("drops a company rep the caller nominated — we own that role now", async () => {
    const res = await send([bothTemplate], leadId, [
      ...customer,
      { role: "company_rep", name: "Somebody Else", email: "else@example.com", order: 2 },
    ]);
    const reps = await db.documentSigner.findMany({
      where: { packageId: res.packageId, role: "company_rep" },
    });
    expect(reps).toHaveLength(1);
    expect(reps[0].name).toBe("Mustafa Joulani");
  });

  it("still honours a nominated rep when the template has no company fields", async () => {
    // Nothing changed for these: no company signature resolves, so the caller's
    // nomination stands exactly as it did before authorised signers existed.
    const res = await send([customerOnlyTemplate], leadId, [
      ...customer,
      { role: "company_rep", name: "Tyler Brooks", email: "tyler@example.com", order: 2 },
    ]);
    const rep = await db.documentSigner.findFirst({
      where: { packageId: res.packageId, role: "company_rep" },
    });
    expect(rep?.name).toBe("Tyler Brooks");
    expect(rep?.status).toBe("sent");
  });

  it("refuses the send when nobody is authorised to sign", async () => {
    await db.companySigner.updateMany({ where: { companyId }, data: { active: false } });
    const before = await db.documentPackage.count({ where: { companyId } });
    try {
      await expect(send([bothTemplate], leadId, customer)).rejects.toThrow(/authorised signer/i);
      // Refused, not half-written. Counted rather than searched for: earlier
      // tests in this file have already written packages of their own.
      expect(await db.documentPackage.count({ where: { companyId } })).toBe(before);
    } finally {
      await db.companySigner.updateMany({ where: { companyId }, data: { active: true } });
    }
  });
});

describe("the co-owner signs too", () => {
  it("gives the co-owner their own signer row at the same order", async () => {
    const { defaultSignersForLead } = await import("../household-signers");
    const lead = await db.lead.findUniqueOrThrow({ where: { id: coLeadId } });
    const res = await send([bothTemplate], coLeadId, defaultSignersForLead(lead));

    const signers = await db.documentSigner.findMany({
      where: { packageId: res.packageId },
      orderBy: { order: "asc" },
    });
    const household = signers.filter((s) => s.role === "customer" || s.role === "co_customer");
    expect(household).toHaveLength(2);
    expect(household[0].order).toBe(household[1].order);
    expect(household.find((s) => s.role === "co_customer")?.email).toBe("jo@example.com");
  });

  it("leaves the envelope open until both of them have signed", async () => {
    const { defaultSignersForLead } = await import("../household-signers");
    const lead = await db.lead.findUniqueOrThrow({ where: { id: coLeadId } });
    const res = await send([bothTemplate], coLeadId, defaultSignersForLead(lead));
    const pkg = await db.documentPackage.findUnique({ where: { id: res.packageId } });
    // Our half is already signed; two customers are not.
    expect(pkg?.status).toBe("sent");
    expect(
      await db.documentSigner.count({ where: { packageId: res.packageId, status: { not: "signed" } } })
    ).toBe(2);
  });
});
