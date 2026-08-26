/**
 * The local-only overlay that sits on top of a copy of production.
 *
 * `npm run db:clone-live` restores live verbatim: every setting, every pipeline
 * stage, every scope item, every real deal. That copy is faithful but it is not
 * *usable* for testing, for two reasons:
 *
 *   1. You cannot log in as anyone but yourself. Live has five accounts and you
 *      know one password. Testing what a canvasser sees needs a canvasser.
 *   2. Nothing pays out. Live has no commission rules configured and no rep
 *      carries a split, so every deal on it computes to nothing. Watching money
 *      move requires money to be set up first.
 *
 * So this adds, on the local copy only: the eight role logins the /login demo
 * panel expects, a full commission configuration for both verticals, and five
 * demo deals placed either side of each vertical's commission gate (roofing's
 * depreciation request, solar's M1 funding) so a drag between stages visibly
 * generates a payout.
 *
 * Everything it writes is deterministic — fixed ids, fixed marker — so running
 * it twice changes nothing and never accumulates duplicates. Live's own rows are
 * touched in exactly one way: local passwords are reset so you can sign in as
 * the real team. Nothing else about them is edited.
 *
 *   npx tsx prisma/seed-local-demo.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * It refuses to run against anything but local Postgres. See guard() below.
 */
import { PrismaClient, type Vertical } from "@prisma/client";
import bcrypt from "bcryptjs";
import { findGateStage } from "../src/server/modules/payroll/gate";

const DEMO_PASSWORD = "Passw0rd!";

/** Placeholder stage key meaning "this vertical's commission gate, whatever it is called". */
const AT_GATE = "__commission_gate__";

/** Marker on everything this script creates, so a re-run replaces its own work. */
const DEMO_TAG = "LOCAL-DEMO";

/**
 * Fixed ids. A seed that generates fresh uuids each run cannot tell its previous
 * output apart from real data, and either duplicates or deletes too much.
 */
const ID = {
  user: (n: number) => `d0000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
  lead: (n: number) => `d1000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
  project: (n: number) => `d2000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
  rule: (n: number) => `d3000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
  txn: (n: number) => `d4000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
  crew: (n: number) => `d5000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
  misc: (n: number) => `d6000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
};

// ─────────────────────────────────────────────────────────────────────────────
// Guard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * This script rewrites users' passwords and creates deals. Pointed at
 * production it would hand out a known password to five real accounts. So the
 * target is checked, not assumed — and there is no flag to override it.
 */
function guard(): void {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) {
    console.error("\nREFUSING TO SEED\n  DATABASE_URL is not set.\n");
    process.exit(1);
  }
  const host = url.replace(/^[a-z]+:\/\//, "").replace(/^[^@]*@/, "").replace(/\/.*$/, "");
  const [hostname, port] = host.split(":");
  const isLocal = ["127.0.0.1", "localhost", "::1"].includes(hostname);
  if (!isLocal || port !== "5544") {
    console.error(
      "\nREFUSING TO SEED\n" +
        `  DATABASE_URL points at ${hostname}:${port ?? "?"}.\n` +
        "  This script resets passwords to a password printed on screen. It only\n" +
        "  ever runs against the local database on 127.0.0.1:5544.\n"
    );
    process.exit(1);
  }
  if (/supabase|pooler|amazonaws|neon\.tech/i.test(url)) {
    console.error("\nREFUSING TO SEED\n  DATABASE_URL names a hosted database provider.\n");
    process.exit(1);
  }
}

guard();
const db = new PrismaClient();

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// ─────────────────────────────────────────────────────────────────────────────
// Roles: the accounts the /login demo panel offers
// ─────────────────────────────────────────────────────────────────────────────

type DemoUser = {
  n: number;
  email: string;
  firstName: string;
  lastName: string;
  role: "super_admin" | "admin" | "manager" | "sales_rep" | "canvasser" | "marketing" | "installer" | "accounting";
  title: string;
  employeeNo: number;
};

const DEMO_USERS: DemoUser[] = [
  { n: 1, email: "owner@anexahomes.com",      firstName: "Demo", lastName: "Owner",      role: "super_admin", title: "Owner",             employeeNo: 101 },
  { n: 2, email: "officeadmin@anexahomes.com",firstName: "Demo", lastName: "Admin",      role: "admin",       title: "Office Admin",      employeeNo: 102 },
  { n: 3, email: "manager@anexahomes.com",    firstName: "Demo", lastName: "Manager",    role: "manager",     title: "Sales Manager",     employeeNo: 103 },
  { n: 4, email: "rep@anexahomes.com",        firstName: "Demo", lastName: "Rep",        role: "sales_rep",   title: "Sales Rep",         employeeNo: 104 },
  { n: 5, email: "canvasser@anexahomes.com",  firstName: "Demo", lastName: "Canvasser",  role: "canvasser",   title: "Canvasser",         employeeNo: 105 },
  { n: 6, email: "marketing@anexahomes.com",  firstName: "Demo", lastName: "Marketing",  role: "marketing",   title: "Marketing",         employeeNo: 106 },
  { n: 7, email: "installer@anexahomes.com",  firstName: "Demo", lastName: "Installer",  role: "installer",   title: "Crew Lead",         employeeNo: 107 },
  { n: 8, email: "accounting@anexahomes.com", firstName: "Demo", lastName: "Accounting", role: "accounting",  title: "Accounting",        employeeNo: 108 },
];

async function seedUsers(companyId: string, hash: string) {
  const both: Vertical[] = ["roofing", "solar"];

  for (const u of DEMO_USERS) {
    // Commission terms live on the user, not on a rule: roofing pays the rep and
    // every active sales manager their own % of the deal's profit pool, and
    // solar pays the rep a redline overage or a flat rate per watt. A user with
    // none of these set generates no line at all, which is why a straight copy
    // of live pays nothing.
    const comp =
      u.role === "sales_rep"
        ? {
            commissionSplitPct: 40,        // self-generated deal: 40% of the pool
            providedLeadType: "percentage",
            providedLeadSplitPct: 30,      // company-provided lead: 30%
            deductiblePct: 10,             // 10% of the customer-paid deductible
            solarRedlineCentsPerWatt: 210, // company keeps $2.10/W net; rep keeps the rest
            solarPerWattMills: 300,        // or a flat $0.30/W on a fixed-pay lender
          }
        : u.role === "manager"
          ? { commissionSplitPct: 10, providedLeadType: "percentage", providedLeadSplitPct: 10 }
          : {};

    const base = {
      companyId,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role,
      status: "active" as const,
      title: u.title,
      employeeNo: u.employeeNo,
      passwordHash: hash,
      verticals: both,
      ...comp,
    };

    await db.user.upsert({
      where: { id: ID.user(u.n) },
      // A re-run must not clobber changes made through the UI beyond the fields
      // this script owns — but it does restore the password, which is the point.
      update: { passwordHash: hash, role: u.role, status: "active", verticals: both, ...comp },
      create: { id: ID.user(u.n), ...base },
    });
  }

  // Mark the demo accounts' onboarding done. The portal redirects anyone whose
  // UserOnboarding has no completedAt straight to the payroll-details form, so
  // without this every one of these logins lands on a wall asking for an SSN
  // instead of the screen you signed in to look at. The encrypted fields stay
  // null — nothing here invents identity or bank details.
  for (const u of DEMO_USERS) {
    const onboarding = {
      userId: ID.user(u.n),
      legalFirstName: u.firstName,
      legalLastName: u.lastName,
      taxClassification: "individual",
      signatureName: `${u.firstName} ${u.lastName}`,
      signedAt: new Date(),
      completedAt: new Date(),
    };
    await db.userOnboarding.upsert({
      where: { userId: ID.user(u.n) },
      update: { completedAt: new Date() },
      create: onboarding,
    });
  }

  // Live's own accounts: password only. Their roles, names, teams and comp are
  // whatever production says they are, and this script has no business editing
  // them — it just makes them reachable without knowing the real passwords.
  const real = await db.user.findMany({
    where: { companyId, status: "active", id: { notIn: DEMO_USERS.map((u) => ID.user(u.n)) } },
    select: { id: true, email: true, role: true, firstName: true, lastName: true },
  });
  for (const r of real) {
    await db.user.update({ where: { id: r.id }, data: { passwordHash: hash } });
  }
  return real;
}

// ─────────────────────────────────────────────────────────────────────────────
// Commission configuration
// ─────────────────────────────────────────────────────────────────────────────

async function seedCommissionConfig(companyId: string) {
  // Overhead and the PA fee come off the pool before anyone splits it. Live
  // already carries 10/10; this only asserts it so the demo maths is stated.
  await db.company.update({ where: { id: companyId }, data: { overheadPct: 10, paFeePct: 10 } });

  // Rules cover the two roles that are NOT paid from the split: the project
  // manager and the install crew.
  const rules = [
    { n: 1, vertical: "roofing" as const, name: "Project Manager — 2% of contract", role: "project_manager", type: "percentage" as const, percent: 2, flatAmount: 0 },
    { n: 2, vertical: "roofing" as const, name: "Install Crew — $1,500 per roof",   role: "installer",       type: "flat" as const,       percent: 0, flatAmount: 150_000 },
    { n: 3, vertical: "solar" as const,   name: "Solar PM — 1% of contract",        role: "project_manager", type: "percentage" as const, percent: 1, flatAmount: 0 },
  ];
  for (const r of rules) {
    const { n, ...data } = r;
    await db.commissionRule.upsert({
      where: { id: ID.rule(n) },
      update: { ...data, active: true },
      create: { id: ID.rule(n), companyId, active: true, ...data },
    });
  }

  // Overrides: the sales manager earns off the demo rep's deals, at a different
  // rate per vertical — which is the whole reason overrides are matched on the
  // deal's vertical rather than the workspace you happen to be looking at.
  const overrides = [
    { n: 1, vertical: "roofing" as const, percent: 5 },
    { n: 2, vertical: "solar" as const,   percent: 2 },
  ];
  for (const o of overrides) {
    await db.commissionOverride.upsert({
      where: { id: ID.misc(o.n) },
      update: { percent: o.percent, type: "percentage" },
      create: {
        id: ID.misc(o.n),
        companyId,
        beneficiaryId: ID.user(3), // Demo Manager
        sourceId: ID.user(4),      // earns off Demo Rep
        vertical: o.vertical,
        type: "percentage",
        percent: o.percent,
      },
    });
  }

  // A crew with the installer account on it, so the installer rule has someone
  // to pay. Rule-based installer pay reaches whoever is a crew member on the
  // project — not everyone with the installer role.
  await db.crew.upsert({
    where: { id: ID.crew(1) },
    update: { active: true },
    create: { id: ID.crew(1), companyId, name: "Demo Crew A", leadName: "Demo Installer", active: true },
  });
  await db.crewMember.upsert({
    where: { id: ID.crew(2) },
    update: { userId: ID.user(7) },
    create: { id: ID.crew(2), crewId: ID.crew(1), userId: ID.user(7), name: "Demo Installer", role: "installer" },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Demo deals
// ─────────────────────────────────────────────────────────────────────────────

type RoofDeal = {
  n: number;
  first: string;
  last: string;
  address: string;
  city: string;
  stageKey: string;
  contractCents: number;
  supplementCents: number;
  deductibleCents: number;
  /** Approved, deal-tagged bookkeeping expenses — the job cost the pool nets off. */
  costs: { desc: string; category: "Materials" | "Subcontractor Labor"; cents: number }[];
  status: "not_started" | "in_production" | "qc" | "completed";
  companyProvidedLead: boolean;
  withCrew: boolean;
};

/**
 * Placed deliberately either side of the commission gate. Roofing generates
 * nothing until a deal reaches "Depreciation Requested", so one deal sits just
 * short of it: drag that one forward, press Generate, and the payout appears.
 */
const ROOF_DEALS: RoofDeal[] = [
  {
    n: 1, first: "Dana", last: "Whitaker",
    address: "4820 Cedar Ridge Dr", city: "Plano",
    stageKey: "invoice_sent",             // one stage BEFORE the gate
    contractCents: 3_180_000, supplementCents: 265_000, deductibleCents: 250_000,
    costs: [
      { desc: "Shingles + underlayment", category: "Materials", cents: 812_000 },
      { desc: "Tear-off and install crew", category: "Subcontractor Labor", cents: 640_000 },
    ],
    status: "qc", companyProvidedLead: false, withCrew: true,
  },
  {
    n: 2, first: "Marco", last: "Ramirez",
    address: "1177 Blackthorn Ln", city: "Frisco",
    stageKey: "depreciation_requested",   // AT the gate — pays immediately
    contractCents: 2_850_000, supplementCents: 420_000, deductibleCents: 250_000,
    costs: [
      { desc: "Shingles + accessories", category: "Materials", cents: 705_000 },
      { desc: "Install labor", category: "Subcontractor Labor", cents: 575_000 },
    ],
    status: "completed", companyProvidedLead: true, withCrew: true,
  },
  {
    n: 3, first: "Priya", last: "Nair",
    address: "908 Windmill Crossing", city: "McKinney",
    stageKey: "paid",                     // past the gate and collected
    contractCents: 4_120_000, supplementCents: 0, deductibleCents: 100_000,
    costs: [
      { desc: "Metal panels", category: "Materials", cents: 1_240_000 },
      { desc: "Install labor", category: "Subcontractor Labor", cents: 600_000 },
    ],
    status: "completed", companyProvidedLead: false, withCrew: true,
  },
];

type SolarDeal = {
  n: number;
  first: string;
  last: string;
  address: string;
  city: string;
  stageKey: string;
  kwDc: number;
  stickerPpwCents: number;
  dealerFeePct: number;
  /** Which live lender the deal is routed to — this is what picks the pay basis. */
  lenderName: string;
  status: "not_started" | "in_production";
};

const SOLAR_DEALS: SolarDeal[] = [
  {
    n: 4, first: "Elena", last: "Alvarez",
    address: "2312 Sunfield Way", city: "Allen",
    stageKey: "install_scheduled",        // BEFORE the M1 gate — cannot pay yet
    kwDc: 8.4, stickerPpwCents: 320, dealerFeePct: 20,
    lenderName: "Climate First",          // redline lender → rep keeps the overage
    status: "not_started",
  },
  {
    n: 5, first: "Trent", last: "Brooks",
    address: "615 Harper Field Rd", city: "Prosper",
    stageKey: AT_GATE,                    // AT M1 Funding — the lender has paid, so the rep can
    kwDc: 11.2, stickerPpwCents: 305, dealerFeePct: 20,
    lenderName: "Amos Capital Fund",      // per-watt lender → flat rate, price irrelevant
    status: "in_production",
  },
];

async function seedDeals(companyId: string) {
  // Wipe the commissions this overlay's OWN deals are carrying. They were
  // generated against wherever the gate stood at the time, so leaving them in
  // place after a deal moves — or after the gate itself moves — produces the one
  // thing the demo is meant to disprove: a paid-out line on a deal that has not
  // reached its gate. Only the fixed demo project ids are touched; live's rows
  // are never in this list.
  await db.commission.deleteMany({
    where: { companyId, projectId: { in: [1, 2, 3, 4, 5].map((n) => ID.project(n)) } },
  });

  const pipelines = await db.pipeline.findMany({
    where: { companyId },
    select: { id: true, vertical: true, stages: { select: { id: true, key: true, name: true, position: true } } },
  });
  const roofPipe = pipelines.find((p) => p.vertical === "roofing");
  const solarPipe = pipelines.find((p) => p.vertical === "solar");
  if (!roofPipe || !solarPipe) throw new Error("Live's roofing and solar pipelines were not found.");

  // AT_GATE resolves to whatever stage that vertical's commission gate lives on.
  // Live's solar gate is a hand-made stage whose key is `partial_funding_26`,
  // an artefact of it having been created as "Partial Funding" and renamed to
  // "M1 Funding" afterwards — so the demo must not hardcode a key here.
  const stageOf = (p: typeof roofPipe, key: string) => {
    const s = key === AT_GATE ? findGateStage(p!.vertical, p!.stages) : p!.stages.find((x) => x.key === key);
    if (!s) throw new Error(`Stage '${key}' not found in the ${p!.vertical} pipeline.`);
    return s;
  };

  const categories = await db.bookkeepingCategory.findMany({ where: { companyId }, select: { id: true, name: true } });
  const catId = (name: string) => categories.find((c) => c.name === name)?.id ?? null;

  // ---- Roofing --------------------------------------------------------------
  let txnSeq = 0;
  for (const d of ROOF_DEALS) {
    const stage = stageOf(roofPipe, d.stageKey);
    const lead = {
      companyId,
      firstName: d.first,
      lastName: d.last,
      email: `${d.first.toLowerCase()}.${d.last.toLowerCase()}@example.com`,
      phone: `469-555-01${String(d.n).padStart(2, "0")}`,
      address: d.address,
      city: d.city,
      state: "TX",
      zip: "75024",
      vertical: "roofing" as const,
      serviceType: "roofing" as const,
      dealType: "insurance" as const,
      status: (d.stageKey === "paid" ? "won" : "open") as "won" | "open",
      pipelineId: roofPipe.id,
      stageId: stage.id,
      stageChangedAt: new Date(),
      value: d.contractCents,
      assignedRepId: ID.user(4),
      notes: `${DEMO_TAG} — sample deal for testing commissions. Not a real customer.`,
    };
    await db.lead.upsert({ where: { id: ID.lead(d.n) }, update: lead, create: { id: ID.lead(d.n), ...lead } });

    const project = {
      companyId,
      vertical: "roofing" as const,
      leadId: ID.lead(d.n),
      projectNumber: `DEMO-${String(d.n).padStart(3, "0")}`,
      status: d.status,
      serviceType: "roofing" as const,
      managerId: ID.user(3),
      address: d.address,
      city: d.city,
      state: "TX",
      zip: "75024",
      roofingType: "Shingle",
      squares: 32,
      contractValue: d.contractCents,
      supplementCents: d.supplementCents,
      deductibleCents: d.deductibleCents,
      companyProvidedLead: d.companyProvidedLead,
      notes: `${DEMO_TAG}`,
    };
    await db.project.upsert({ where: { id: ID.project(d.n) }, update: project, create: { id: ID.project(d.n), ...project } });

    if (d.withCrew) {
      await db.projectCrew.upsert({
        where: { projectId_crewId: { projectId: ID.project(d.n), crewId: ID.crew(1) } },
        update: {},
        create: { projectId: ID.project(d.n), crewId: ID.crew(1), role: "install" },
      });
    }

    // Job cost. Only APPROVED, project-tagged, categorised expenses count — an
    // unapproved receipt is invisible to the pool, by design.
    for (const c of d.costs) {
      txnSeq += 1;
      const txn = {
        companyId,
        vertical: "roofing" as const,
        date: new Date(),
        description: `${c.desc} — ${d.last}`,
        amountCents: -c.cents,     // negative: money out
        vendor: "Demo Supply Co.",
        categoryId: catId(c.category),
        projectId: ID.project(d.n),
        status: "categorized",
        approved: true,
        notes: DEMO_TAG,
      };
      await db.transaction.upsert({ where: { id: ID.txn(txnSeq) }, update: txn, create: { id: ID.txn(txnSeq), ...txn } });
    }
  }

  // ---- Solar ----------------------------------------------------------------
  const lenders = await db.solarLender.findMany({ where: { companyId }, select: { id: true, name: true, repPayMode: true } });
  const modules = await db.solarEquipment.findMany({
    where: { companyId, kind: "module", isActive: true },
    select: { id: true, ratingW: true },
    orderBy: [{ isDefault: "desc" }, { rank: "asc" }],
    take: 1,
  });
  const inverters = await db.solarEquipment.findMany({
    where: { companyId, kind: "inverter", isActive: true },
    select: { id: true },
    orderBy: [{ isDefault: "desc" }, { rank: "asc" }],
    take: 1,
  });

  for (const d of SOLAR_DEALS) {
    const stage = stageOf(solarPipe, d.stageKey);
    const lender = lenders.find((l) => l.name === d.lenderName) ?? lenders[0] ?? null;

    const lead = {
      companyId,
      firstName: d.first,
      lastName: d.last,
      email: `${d.first.toLowerCase()}.${d.last.toLowerCase()}@example.com`,
      phone: `469-555-02${String(d.n).padStart(2, "0")}`,
      address: d.address,
      city: d.city,
      state: "TX",
      zip: "75002",
      vertical: "solar" as const,
      serviceType: "solar" as const,
      dealType: "cash" as const,
      status: "open" as const,
      pipelineId: solarPipe.id,
      stageId: stage.id,
      stageChangedAt: new Date(),
      assignedRepId: ID.user(4),
      notes: `${DEMO_TAG} — sample solar deal. Not a real customer.`,
    };
    await db.lead.upsert({ where: { id: ID.lead(d.n) }, update: lead, create: { id: ID.lead(d.n), ...lead } });

    // contractValue stays 0: nothing writes a solar price onto the Project row,
    // and the pay engine reads SolarFinance instead. Setting it here would
    // invent a number the rest of the app does not believe.
    const project = {
      companyId,
      vertical: "solar" as const,
      leadId: ID.lead(d.n),
      projectNumber: `DEMO-${String(d.n).padStart(3, "0")}`,
      status: d.status,
      serviceType: "solar" as const,
      managerId: ID.user(3),
      address: d.address,
      city: d.city,
      state: "TX",
      zip: "75002",
      contractValue: 0,
      notes: `${DEMO_TAG}`,
    };
    await db.project.upsert({ where: { id: ID.project(d.n) }, update: project, create: { id: ID.project(d.n), ...project } });

    const watts = Math.round(d.kwDc * 1000);
    const moduleWatts = modules[0]?.ratingW ?? 400;
    const design = {
      companyId,
      leadId: ID.lead(d.n),
      utilityProvider: "Oncor",
      avgMonthlyBillCents: 24_000,
      annualUsageKwh: 15_600,
      mountType: "roof" as const,
      lenderId: lender?.id ?? null,
      moduleId: modules[0]?.id ?? null,
      moduleQty: Math.max(1, Math.round(watts / moduleWatts)),
      inverterId: inverters[0]?.id ?? null,
      systemSizeKwDc: d.kwDc,
      systemSizeKwAc: Math.round(d.kwDc * 0.85 * 100) / 100,
      year1ProductionKwh: Math.round(d.kwDc * 1450),
      offsetPct: 96,
    };
    await db.solarDesign.upsert({ where: { leadId: ID.lead(d.n) }, update: design, create: design });

    // Priced the way the app prices: the sticker carries the dealer fee, and the
    // fee comes back out to give the base price the rep is redlined against.
    const baseSticker = watts * d.stickerPpwCents;
    const basePrice = baseSticker - Math.round(baseSticker * (d.dealerFeePct / 100));
    const finance = {
      companyId,
      leadId: ID.lead(d.n),
      product: "loan" as const,
      grossPpwCents: d.stickerPpwCents,
      dealerFeePct: d.dealerFeePct,
      adderTotalCents: 0,
      contractPriceCents: baseSticker,
      itcEstimateCents: Math.round(baseSticker * 0.3),
      aprPct: 5.99,
      loanTermMonths: 300,
    };
    await db.solarFinance.upsert({ where: { leadId: ID.lead(d.n) }, update: finance, create: finance });

    const mode = lender?.repPayMode ?? "redline";
    const pay =
      mode === "per_watt"
        ? Math.round((watts * 300) / 10)
        : Math.max(0, basePrice - 210 * watts);
    console.log(
      `    ${d.first} ${d.last}: ${d.kwDc} kW via ${lender?.name ?? "no lender"} (${mode}) → rep earns ${usd(pay)}`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const company = await db.company.findFirst({ select: { id: true, name: true } });
  if (!company) throw new Error("No company found. Run `npm run db:clone-live` first.");

  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

  console.log(`\nCompany: ${company.name}`);
  console.log("\n  Logins...");
  const real = await seedUsers(company.id, hash);

  console.log("  Commission configuration...");
  await seedCommissionConfig(company.id);

  console.log("  Demo deals...");
  await seedDeals(company.id);

  // ---- What you can now do -------------------------------------------------
  console.log(`\n${"─".repeat(72)}`);
  console.log(`Every account below signs in with the password:  ${DEMO_PASSWORD}`);
  console.log(`${"─".repeat(72)}`);
  console.log("\n  Demo accounts — one click each on the /login panel:");
  for (const u of DEMO_USERS) console.log(`    ${u.email.padEnd(30)} ${u.role.padEnd(12)} ${u.title}`);
  console.log("\n  Live's real accounts — type the address, same password:");
  for (const r of real) console.log(`    ${r.email.padEnd(30)} ${r.role.padEnd(12)} ${r.firstName} ${r.lastName}`);

  const pipes = await db.pipeline.findMany({
    where: { companyId: company.id },
    select: { vertical: true, stages: { select: { id: true, key: true, name: true } } },
  });
  const gateName = (v: string) =>
    findGateStage(v, pipes.find((p) => p.vertical === v)?.stages ?? [])?.name ?? "the gate";
  console.log(`\n  Watching a commission appear:`);
  console.log(`    1. Sign in as owner@anexahomes.com and open Commissions.`);
  console.log(`    2. Roofing gates at "${gateName("roofing")}", Solar at "${gateName("solar")}".`);
  console.log(`    3. Press Generate. Ramirez, Nair and Brooks pay out. Whitaker and`);
  console.log(`       Alvarez do not — both sit short of their pipeline's gate.`);
  console.log(`    4. Drag one of them into its gate stage, Generate again, and its`);
  console.log(`       lines appear. Approve them to move them into payroll.\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
