/**
 * Clean production seed — config scaffolding + a single owner login, NO demo deals.
 *
 * Creates everything the app needs to function out of the box (company + branding,
 * pipelines/stages for all three workspaces, lead sources, commission &
 * notification rules, photo/document templates, scope template + master catalog,
 * starter bookkeeping categories) and ONE super_admin owner. No fake leads,
 * projects, claims, knocks, conversations, knowledge articles, or transactions.
 *
 * Run once against the prod DB:
 *   OWNER_EMAIL=you@co.com OWNER_PASSWORD='...' \
 *     DATABASE_URL="<prod-url>" pnpm tsx prisma/seed-clean.ts
 *
 * OWNER_EMAIL / OWNER_PASSWORD / OWNER_NAME / COMPANY_NAME are read from env;
 * each falls back to a sensible default (a random password is generated and
 * printed if OWNER_PASSWORD is unset). COMPANY_PHONE / COMPANY_EMAIL /
 * COMPANY_ADDRESS / COMPANY_CITY / COMPANY_STATE / COMPANY_ZIP are optional and
 * have no defaults — they are the identity printed on customer-facing
 * documents, and the seed says so on the way out when they are left unset.
 */
import { PrismaClient, type Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { DEFAULT_SCOPE_CATALOG } from "../src/lib/scope-catalog";
import { defaultItems, defaultName } from "../src/server/modules/photos/defaults";

const prisma = new PrismaClient();

const STAGES = [
  { key: "new_lead", name: "New Appointment", color: "#A1A1AA" },
  { key: "appointment_set", name: "Appointment Set", color: "#60A5FA" },
  { key: "inspection_complete", name: "Inspection Complete", color: "#38BDF8" },
  { key: "claim_opened", name: "Insurance Claim Opened", color: "#818CF8" },
  { key: "adjuster_meeting", name: "Adjuster Meeting Scheduled", color: "#A78BFA" },
  { key: "scope_received", name: "Scope Received", color: "#C084FC" },
  { key: "supplement_needed", name: "Supplement Needed", color: "#F472B6" },
  { key: "contract_signed", name: "Contract Signed", color: "#FB923C", countsAsSold: true },
  { key: "material_ordered", name: "Material Ordered", color: "#FBBF24" },
  { key: "scheduled", name: "Scheduled", color: "#FACC15" },
  { key: "in_production", name: "In Production", color: "#A3E635" },
  { key: "qc_inspection", name: "QC Inspection", color: "#4ADE80" },
  { key: "invoice_sent", name: "Invoice Sent", color: "#34D399" },
  { key: "depreciation_requested", name: "Depreciation Requested", color: "#2DD4BF" },
  { key: "paid", name: "Paid", color: "#22C55E", isWon: true },
  { key: "closed", name: "Closed", color: "#16A34A", isWon: true },
];

const SOLAR_STAGES = [
  { key: "new_appt", name: "New Appointment", color: "#FBBF24" },
  { key: "site_survey", name: "Site Survey", color: "#F59E0B" },
  { key: "proposal_sent", name: "Proposal Sent", color: "#F97316" },
  { key: "contract_signed", name: "Contract Signed", color: "#FB923C", countsAsSold: true, milestone: "contract_signed" as const },
  { key: "permitting", name: "Permitting", color: "#A78BFA" },
  { key: "install_scheduled", name: "Install Scheduled", color: "#60A5FA" },
  { key: "installed", name: "Installed", color: "#34D399" },
  // The solar commission gate: the lender's first milestone payment, and the
  // first money the company sees on the deal. Nothing pays a rep before it.
  { key: "m1_funding", name: "M1 Funding", color: "#14B8A6" },
  { key: "pto", name: "PTO / Activated", color: "#22C55E" },
  { key: "paid", name: "Paid", color: "#16A34A", isWon: true },
];
const OTHERS_STAGES = [
  { key: "new_lead", name: "New Lead", color: "#94A3B8" },
  { key: "qualified", name: "Qualified", color: "#38BDF8" },
  { key: "quoted", name: "Quoted", color: "#6366F1" },
  { key: "subbed_out", name: "Subbed Out", color: "#F59E0B" },
  { key: "closed", name: "Closed", color: "#16A34A", isWon: true },
];

/**
 * Where dead deals go. Appended to every pipeline rather than written into the
 * lists above, because it is a dead end rather than a step: Advance on the deal
 * page walks the progression and skips it. A pipeline with nothing flagged
 * `isLost` has no cancel action at all.
 */
const CANCELLED_STAGE = { key: "cancelled", name: "Cancelled", color: "#EF4444", isLost: true };

const DOC_TEMPLATES: { name: string; type: any }[] = [
  { name: "Roofing Contract", type: "roofing_contract" },
  { name: "Insurance Contingency Agreement", type: "insurance_contingency" },
  { name: "Certificate of Completion", type: "certificate_of_completion" },
  { name: "Change Order", type: "change_order" },
  { name: "Depreciation Request", type: "depreciation_request" },
  { name: "Final Invoice", type: "final_invoice" },
  { name: "Warranty Certificate", type: "warranty_certificate" },
  { name: "Customer Closeout Sheet", type: "customer_closeout" },
];
const LETTER = [{ width: 612, height: 792 }];

async function main() {
  const OWNER_EMAIL = (process.env.OWNER_EMAIL || "mustafa.joulani@primeslr.com").toLowerCase();
  const OWNER_PASSWORD = process.env.OWNER_PASSWORD || crypto.randomBytes(9).toString("base64url");
  const OWNER_NAME = process.env.OWNER_NAME || "Mustafa Joulani";
  const COMPANY_NAME = process.env.COMPANY_NAME || "Anexa Homes";
  // The identity a customer-facing document carries. Optional here — a tenant
  // can fill them in Settings -> Branding -> Company Information — but they are
  // NOT seeded blank: `phone: ""` used to be written here, which reads as "set"
  // to anything doing a null check while printing nothing on the document, and
  // left the live company blocked from generating a solar proposal with no
  // screen that could clear it.
  const COMPANY_PHONE = process.env.COMPANY_PHONE?.trim() || null;
  const COMPANY_EMAIL = process.env.COMPANY_EMAIL?.trim().toLowerCase() || null;
  const COMPANY_ADDRESS = process.env.COMPANY_ADDRESS?.trim() || null;
  const COMPANY_CITY = process.env.COMPANY_CITY?.trim() || null;
  const COMPANY_STATE = process.env.COMPANY_STATE?.trim() || null;
  const COMPANY_ZIP = process.env.COMPANY_ZIP?.trim() || null;
  const [ownerFirst, ...ownerRest] = OWNER_NAME.trim().split(/\s+/);
  const ownerLast = ownerRest.join(" ") || "";
  const generatedPw = !process.env.OWNER_PASSWORD;

  // Safety: refuse to wipe a DB that already has real data.
  const existing = await prisma.company.count();
  if (existing > 0) {
    throw new Error(
      `Refusing to seed: ${existing} company(ies) already exist. ` +
        `This clean seed is for an empty database. Delete data manually if you really mean to reset.`
    );
  }

  const passwordHash = await bcrypt.hash(OWNER_PASSWORD, 10);

  const company = await prisma.company.create({
    data: {
      name: COMPANY_NAME,
      slug: "anexa-homes",
      phone: COMPANY_PHONE,
      email: COMPANY_EMAIL,
      address: COMPANY_ADDRESS,
      city: COMPANY_CITY,
      state: COMPANY_STATE,
      zip: COMPANY_ZIP,
      timezone: "America/Chicago",
      settings: {
        create: {
          primaryColor: "#0B0B0C",
          accentColor: "#F4631E",
          recordPrefix: "AH-",
          currencyCode: "USD",
          locale: "en-US",
          emailFromName: COMPANY_NAME,
          requiredDocuments: ["roofing_contract", "insurance_contingency"],
        },
      },
    },
  });

  // The single owner / super admin.
  const owner = await prisma.user.create({
    data: {
      companyId: company.id,
      email: OWNER_EMAIL,
      passwordHash,
      firstName: ownerFirst,
      lastName: ownerLast,
      role: "super_admin" as Role,
      title: "Owner",
      verticals: ["roofing", "solar", "others"],
      employeeNo: 1,
    },
  });
  // Owner skips the new-hire onboarding wizard.
  await prisma.userOnboarding.create({ data: { userId: owner.id, completedAt: new Date() } });

  // Lead sources (starter set — editable in Settings).
  const sourceNames = ["Storm Canvassing", "Referral", "Website", "Google Ads", "Insurance Partner"];
  for (let i = 0; i < sourceNames.length; i++) {
    await prisma.leadSource.create({ data: { companyId: company.id, name: sourceNames[i], position: i } });
  }

  // Pipelines + stages for all three workspaces.
  const pipeline = await prisma.pipeline.create({
    data: { companyId: company.id, name: "Roofing Pipeline", vertical: "roofing", isDefault: true },
  });
  const stages: { key: string; id: string }[] = [];
  const roofingStages = [...STAGES, CANCELLED_STAGE];
  for (let i = 0; i < roofingStages.length; i++) {
    const s = roofingStages[i];
    const created = await prisma.pipelineStage.create({
      data: {
        pipelineId: pipeline.id,
        key: s.key,
        name: s.name,
        color: s.color,
        position: i,
        isWon: (s as { isWon?: boolean }).isWon ?? false,
        countsAsSold: (s as { countsAsSold?: boolean }).countsAsSold ?? false,
        isLost: (s as { isLost?: boolean }).isLost ?? false,
      },
      select: { key: true, id: true },
    });
    stages.push(created);
  }
  const stageByKey = Object.fromEntries(stages.map((s) => [s.key, s]));

  for (const [vertical, name, defs] of [
    ["solar", "Solar Pipeline", SOLAR_STAGES] as const,
    ["others", "Others Pipeline", OTHERS_STAGES] as const,
  ]) {
    const p = await prisma.pipeline.create({ data: { companyId: company.id, name, vertical, isDefault: true } });
    for (let i = 0; i < defs.length; i++) {
      const s = defs[i];
      await prisma.pipelineStage.create({
        data: {
          pipelineId: p.id, key: s.key, name: s.name, color: s.color, position: i,
          isWon: (s as { isWon?: boolean }).isWon ?? false,
          countsAsSold: (s as { countsAsSold?: boolean }).countsAsSold ?? false,
          milestone: (s as { milestone?: "contract_signed" }).milestone ?? null,
        },
      });
    }
    await prisma.pipelineStage.create({
      data: {
        pipelineId: p.id,
        key: CANCELLED_STAGE.key,
        name: CANCELLED_STAGE.name,
        color: CANCELLED_STAGE.color,
        position: defs.length,
        isLost: true,
      },
    });
  }

  // Commission rules (starter — tune in Settings → Commissions).
  await prisma.commissionRule.createMany({
    data: [
      { companyId: company.id, name: "Sales Rep — 10%", role: "sales_rep", type: "percentage", percent: 10 },
      { companyId: company.id, name: "Manager Override — 3%", role: "manager", type: "percentage", percent: 3 },
      { companyId: company.id, name: "Crew Flat — $1,500", role: "installer", type: "flat", flatAmount: 150000 },
    ],
  });

  // Default notification rules (editable in Settings → Notifications).
  await prisma.notificationRule.createMany({
    data: [
      {
        companyId: company.id,
        name: "New appointment → Managers",
        event: "lead_created",
        conditions: {},
        recipients: { roles: ["manager", "admin"], userIds: [], dynamic: [] },
        channels: ["in_app"],
        titleTemplate: "New appointment: {{customer}}",
        bodyTemplate: "{{actor}} added a new appointment — {{customer}}.",
      },
      {
        companyId: company.id,
        name: "Appointment assigned → Rep",
        event: "lead_assigned",
        conditions: {},
        recipients: { roles: [], userIds: [], dynamic: ["assigned_rep"] },
        channels: ["in_app"],
        titleTemplate: "Appointment assigned: {{customer}}",
        bodyTemplate: "You were assigned the appointment {{customer}}.",
      },
      {
        companyId: company.id,
        name: "Contract Signed stage → Manager & PM",
        event: "stage_changed",
        conditions: { stageId: stageByKey["contract_signed"].id },
        recipients: { roles: ["manager"], userIds: [], dynamic: ["project_manager"] },
        channels: ["in_app", "email"],
        titleTemplate: "Contract signed: {{customer}}",
        bodyTemplate: "{{actor}} moved {{customer}} to {{stage}}.",
      },
      {
        companyId: company.id,
        name: "Document completed → Customer & Rep",
        event: "document_completed",
        conditions: {},
        recipients: { roles: [], userIds: [], dynamic: ["customer", "assigned_rep"] },
        channels: ["in_app"],
        titleTemplate: "Signed: {{document}}",
        bodyTemplate: "All parties signed {{document}}.",
      },
      {
        companyId: company.id,
        name: "Task assigned → Assignee",
        event: "task_assigned",
        conditions: {},
        recipients: { roles: [], userIds: [], dynamic: ["task_assignee"] },
        channels: ["in_app"],
        titleTemplate: "New task: {{task}}",
        bodyTemplate: "{{actor}} assigned you a task — {{task}}.",
      },
    ],
  });

  // Photo templates (CompanyCam-style) — admin-editable in Settings.
  const siteTemplate = await prisma.photoTemplate.create({
    data: { companyId: company.id, name: "Site / Inspection Photos", kind: "site", position: 0 },
  });
  await prisma.photoTemplateItem.createMany({
    data: [
      { templateId: siteTemplate.id, label: "Front of house", required: true, position: 0 },
      { templateId: siteTemplate.id, label: "Address / house number", required: false, position: 1 },
      { templateId: siteTemplate.id, label: "Full roof — each slope", required: true, position: 2 },
      { templateId: siteTemplate.id, label: "Roof damage — close-up", required: true, position: 3 },
      { templateId: siteTemplate.id, label: "Hail hits / test square", required: false, position: 4 },
      { templateId: siteTemplate.id, label: "Gutters & downspouts", required: false, position: 5 },
      { templateId: siteTemplate.id, label: "Soft metals (vents, flashing)", required: false, position: 6 },
      { templateId: siteTemplate.id, label: "Collateral damage (fence, AC, screens)", required: false, position: 7 },
      { templateId: siteTemplate.id, label: "Interior damage (if any)", required: false, position: 8 },
    ],
  });
  const installTemplate = await prisma.photoTemplate.create({
    data: { companyId: company.id, name: "Install Photos", kind: "install", position: 0 },
  });
  await prisma.photoTemplateItem.createMany({
    data: [
      { templateId: installTemplate.id, label: "Before — full roof", required: true, position: 0 },
      { templateId: installTemplate.id, label: "Tear-off in progress", required: true, position: 1 },
      { templateId: installTemplate.id, label: "Decking / wood replacement", required: false, position: 2 },
      { templateId: installTemplate.id, label: "Underlayment / ice & water", required: true, position: 3 },
      { templateId: installTemplate.id, label: "Flashing & valleys", required: false, position: 4 },
      { templateId: installTemplate.id, label: "Ridge vent", required: false, position: 5 },
      { templateId: installTemplate.id, label: "Final — full roof", required: true, position: 6 },
      { templateId: installTemplate.id, label: "Cleanup / magnet sweep", required: false, position: 7 },
      { templateId: installTemplate.id, label: "Yard sign placed", required: false, position: 8 },
    ],
  });

  // Solar's own pair. PhotoTemplate is vertical-isolated, so the roofing rows
  // above are invisible from the Solar workspace — a solar job photographs a
  // main panel, a meter and an attic, not hail hits, and needs its own list.
  for (const kind of ["site", "install"] as const) {
    const solarTemplate = await prisma.photoTemplate.create({
      data: { companyId: company.id, name: defaultName("solar", kind), kind, position: 0, vertical: "solar" },
    });
    await prisma.photoTemplateItem.createMany({
      data: defaultItems("solar", kind).map((d, i) => ({
        templateId: solarTemplate.id,
        label: d.label,
        required: d.required,
        position: i,
      })),
    });
  }

  // Document templates (the 8) with a couple signature/date fields.
  for (const t of DOC_TEMPLATES) {
    await prisma.documentTemplate.create({
      data: {
        companyId: company.id,
        name: t.name,
        type: t.type,
        description: `${t.name} for ${COMPANY_NAME} customers.`,
        pages: LETTER,
        body: [
          { page: 1, type: "heading", text: t.name, x: 56, y: 720 },
          { page: 1, type: "text", text: "Customer: {{customer.fullName}}", x: 56, y: 680 },
          { page: 1, type: "text", text: "Property: {{project.address}}", x: 56, y: 660 },
        ],
        fields: {
          create: [
            { page: 1, x: 56, y: 140, width: 220, height: 48, type: "signature", signerRole: "customer", label: "Customer Signature" },
            { page: 1, x: 320, y: 140, width: 160, height: 40, type: "date", signerRole: "customer", label: "Date", valueToken: "{{today}}" },
          ],
        },
      },
    });
  }

  // Scope of Work template (starter pricing — tune per market in Settings).
  const scopeTemplate = [
    { category: "Roofing", description: "Shingles — remove & replace", unit: "sq", ins: 35000, cost: 21000 },
    { category: "Roofing", description: "Synthetic underlayment", unit: "sq", ins: 4500, cost: 2200 },
    { category: "Roofing", description: "Ridge cap shingles", unit: "lf", ins: 800, cost: 450 },
    { category: "Roofing", description: "Starter strip", unit: "lf", ins: 250, cost: 120 },
    { category: "Roofing", description: "Drip edge", unit: "lf", ins: 300, cost: 150 },
    { category: "Roofing", description: "Ice & water shield (valleys)", unit: "lf", ins: 600, cost: 300 },
    { category: "Roofing", description: "Pipe boot / flashing", unit: "ea", ins: 4500, cost: 1800 },
    { category: "Gutters", description: '6" K-style gutter', unit: "lf", ins: 1200, cost: 750 },
    { category: "Labor", description: "Tear-off labor", unit: "sq", ins: 0, cost: 6500 },
    { category: "Disposal", description: "Dumpster / haul-off", unit: "ea", ins: 45000, cost: 40000 },
  ];
  await prisma.scopeTemplateItem.createMany({
    data: scopeTemplate.map((t, i) => ({
      companyId: company.id,
      vertical: "roofing" as const,
      position: i,
      category: t.category,
      description: t.description,
      unit: t.unit,
      defaultInsuranceUnitPrice: t.ins,
      defaultCostUnitPrice: t.cost,
    })),
  });

  // Master scope catalog — full insurance-restoration line-item list (no pricing).
  await prisma.scopeCatalogItem.createMany({
    data: DEFAULT_SCOPE_CATALOG.map((c, i) => ({
      companyId: company.id,
      position: i,
      category: c.category,
      subcategory: c.subcategory,
      description: c.description,
      unit: c.unit,
      trade: c.trade,
      isCommonInsuranceItem: c.common,
      isSupplementEligible: c.supplement,
      isActive: true,
    })),
  });

  // Starter bookkeeping categories (no transactions).
  await prisma.bookkeepingCategory.createMany({
    data: [
      { companyId: company.id, name: "Job Revenue", type: "income" },
      { companyId: company.id, name: "Materials", type: "expense" },
      { companyId: company.id, name: "Subcontractor Labor", type: "expense" },
      { companyId: company.id, name: "Overhead", type: "expense" },
    ],
  });

  await prisma.activityLog.create({
    data: { companyId: company.id, type: "system", message: `${COMPANY_NAME} CRM initialized.`, actorId: owner.id },
  });

  console.log("✅ Clean seed complete.");
  console.log(`   Company: ${COMPANY_NAME} (slug: anexa-homes)`);
  const missing = [
    !COMPANY_PHONE && "phone",
    !COMPANY_EMAIL && "email",
    !COMPANY_ADDRESS && "address",
  ].filter(Boolean);
  if (missing.length) {
    console.log(`   ⚠️  No company ${missing.join(", ")} set. A solar proposal will not`);
    console.log("      generate until these are filled in Settings → Branding →");
    console.log("      Company Information (or seeded via COMPANY_PHONE / COMPANY_EMAIL /");
    console.log("      COMPANY_ADDRESS / COMPANY_CITY / COMPANY_STATE / COMPANY_ZIP).");
  }
  console.log(`   Owner login: ${OWNER_EMAIL}`);
  if (generatedPw) {
    console.log(`   Generated password: ${OWNER_PASSWORD}`);
    console.log("   ⚠️  Save this now and change it after first login.");
  } else {
    console.log("   Password: (the OWNER_PASSWORD you provided)");
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
