import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { Role } from "@prisma/client";
import { verticalExtension } from "@/server/vertical/extension";
import { runUnscoped } from "@/server/vertical/context";
import { computeCommissionsForProject } from "@/server/modules/payroll/engine";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";

/**
 * WHO IS ALLOWED TO CARRY PAY TERMS.
 *
 * The deal's rep picker offers every staff role, and an owner who sells his own
 * deals is assigned to them as the rep — but the Pay structure card, and the
 * action behind it, admitted only `sales_rep` and `manager`. So a solar deal
 * sold by the owner reached M1 Funding with a rep who had no $/W anywhere,
 * `resolveSolarPayTerms` returned null exactly as designed, and the engine wrote
 * no line at all. There was no field on any page to fix it with.
 *
 * The two ends of that gate are what these tests hold: management can be paid,
 * the back office still cannot, and a deal sold by an owner actually pays.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const session = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/server/auth/session", () => session);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { updateMemberPayAction } = await import("../actions");

const raw = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
const db = raw.$extends(verticalExtension());

let companyId: string;

/** $0.35/W flat, on a 10 kW system through a fixed-pay lender. */
const PER_WATT_MILLS = 350;
const KW = 10;

const member = (role: Role, tag: string) =>
  raw.user.create({
    data: {
      companyId,
      email: `${tag}-${process.pid}-${role}@test.local`,
      passwordHash: "x",
      firstName: role,
      lastName: "Member",
      role,
      verticals: ["roofing", "solar"],
    },
  });

async function resetFixtures() {
  await raw.$executeRawUnsafe('TRUNCATE TABLE "companies" CASCADE');
  const company = await raw.company.create({
    data: { name: "Pay Roles Co", slug: `pr-${process.pid}-${Date.now()}`, overheadPct: 0, paFeePct: 0 },
  });
  companyId = company.id;
  session.requireUser.mockResolvedValue({
    userId: "owner-session",
    companyId,
    role: "super_admin",
    permissions: {},
  });
}

beforeAll(resetFixtures);
beforeEach(resetFixtures);
afterAll(async () => {
  await raw.$disconnect();
});

describe("which roles carry a pay structure", () => {
  it.each<Role>(["super_admin", "admin", "manager", "sales_rep"])(
    "lets a %s be given solar terms",
    async (role) => {
      const u = await member(role, "ok");
      const res = await updateMemberPayAction({ userId: u.id, solarPerWattMills: PER_WATT_MILLS });
      expect(res).toEqual({ ok: true });
      const after = await raw.user.findUniqueOrThrow({ where: { id: u.id } });
      expect(after.solarPerWattMills).toBe(PER_WATT_MILLS);
    }
  );

  it.each<Role>(["installer", "accounting", "canvasser", "marketing"])(
    "refuses to write terms onto a %s the engine never reads",
    async (role) => {
      const u = await member(role, "no");
      const res = await updateMemberPayAction({ userId: u.id, solarPerWattMills: PER_WATT_MILLS });
      expect(res.ok).toBe(false);
      const after = await raw.user.findUniqueOrThrow({ where: { id: u.id } });
      expect(after.solarPerWattMills).toBeNull();
    }
  );
});

describe("a deal sold by the owner", () => {
  it("pays him, once his rate exists", async () => {
    const owner = await member("super_admin", "sells");
    await updateMemberPayAction({ userId: owner.id, solarPerWattMills: PER_WATT_MILLS });

    const lender = await raw.solarLender.create({
      data: { companyId, name: "Amos Capital Fund", repPayMode: "per_watt" },
    });
    const lead = await raw.lead.create({
      data: { companyId, vertical: "solar", firstName: "Owner", lastName: "Deal", assignedRepId: owner.id },
    });
    await raw.solarDesign.create({
      data: { companyId, leadId: lead.id, systemSizeKwDc: KW, lenderId: lender.id },
    });
    await raw.solarFinance.create({
      data: {
        companyId, leadId: lead.id, product: "loan",
        baseFinalPpwCents: 550, dealerFeePct: 65, finalPriceCents: KW * 1000 * 550,
      },
    });
    const project = await raw.project.create({
      data: { companyId, vertical: "solar", leadId: lead.id, projectNumber: `OWN-${process.pid}`, contractValue: 0 },
    });

    // Unscoped, the way the payroll cron runs it.
    const created = await runUnscoped("test: payroll runs company-wide", () =>
      computeCommissionsForProject(db, companyId, project.id)
    );
    expect(created).toBe(1);

    const line = await raw.commission.findFirstOrThrow({
      where: { projectId: project.id, userId: owner.id },
    });
    // $0.35/W × 10,000 W.
    expect(line.amount).toBe(350_000);
    expect(line.solarBasis).toBe("per_watt");
  });
});
