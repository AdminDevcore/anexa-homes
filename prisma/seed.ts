import { PrismaClient, type Role, type KnockDisposition as KnockDispo } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DEFAULT_SCOPE_CATALOG } from "../src/lib/scope-catalog";

const prisma = new PrismaClient();

const STAGES = [
  { key: "new_lead", name: "New Appointment", color: "#A1A1AA" },
  { key: "appointment_set", name: "Appointment Set", color: "#60A5FA" },
  { key: "inspection_complete", name: "Inspection Complete", color: "#38BDF8" },
  { key: "claim_opened", name: "Insurance Claim Opened", color: "#818CF8" },
  { key: "adjuster_meeting", name: "Adjuster Meeting Scheduled", color: "#A78BFA" },
  { key: "scope_received", name: "Scope Received", color: "#C084FC" },
  { key: "supplement_needed", name: "Supplement Needed", color: "#F472B6" },
  { key: "contract_signed", name: "Contract Signed", color: "#FB923C" },
  { key: "material_ordered", name: "Material Ordered", color: "#FBBF24" },
  { key: "scheduled", name: "Scheduled", color: "#FACC15" },
  { key: "in_production", name: "In Production", color: "#A3E635" },
  { key: "qc_inspection", name: "QC Inspection", color: "#4ADE80" },
  { key: "invoice_sent", name: "Invoice Sent", color: "#34D399" },
  { key: "depreciation_requested", name: "Depreciation Requested", color: "#2DD4BF" },
  { key: "paid", name: "Paid", color: "#22C55E", isWon: true },
  { key: "closed", name: "Closed", color: "#16A34A", isWon: true },
];

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
  const password = await bcrypt.hash("Passw0rd!", 10);

  // Clean slate for idempotent seeding (dev only). TRUNCATE ... CASCADE wipes the
  // whole schema regardless of onDelete rules, so reseeding is order-independent.
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "companies" CASCADE');

  const company = await prisma.company.create({
    data: {
      name: "Anexa Homes",
      slug: "anexa-homes",
      phone: "(866) 650-9996",
      email: "support@anexahomes.com",
      website: "https://anexahomes.com",
      address: "508 North Bowser Road",
      city: "Richardson",
      state: "TX",
      zip: "75081",
      timezone: "America/Chicago",
      settings: {
        create: {
          logoUrl: "/anexa-logo.png",
          primaryColor: "#0B0B0C",
          accentColor: "#F4631E",
          recordPrefix: "AH-",
          supportPhone: "(866) 650-9996",
          supportEmail: "support@anexahomes.com",
          currencyCode: "USD",
          locale: "en-US",
          emailFromName: "Anexa Homes",
          requiredDocuments: ["roofing_contract", "insurance_contingency"],
        },
      },
    },
  });

  // Users — one per role.
  const userDefs: {
    key: string;
    role: Role;
    firstName: string;
    lastName: string;
    title?: string;
  }[] = [
    { key: "owner", role: "super_admin", firstName: "Marcus", lastName: "Reed", title: "Owner / CEO" },
    { key: "admin", role: "admin", firstName: "Dana", lastName: "Hill", title: "Operations Admin" },
    { key: "manager", role: "manager", firstName: "Priya", lastName: "Shah", title: "Sales Manager" },
    { key: "rep", role: "sales_rep", firstName: "Tyler", lastName: "Brooks", title: "Roofing Consultant" },
    { key: "rep2", role: "sales_rep", firstName: "Dylan", lastName: "Foster", title: "Roofing Consultant" },
    { key: "canvasser", role: "canvasser", firstName: "Cody", lastName: "Nguyen", title: "Canvasser" },
    { key: "marketing", role: "marketing", firstName: "Mia", lastName: "Lopez", title: "Marketing Partner" },
    { key: "installer", role: "installer", firstName: "Carlos", lastName: "Diaz", title: "Crew Lead" },
    { key: "accounting", role: "accounting", firstName: "Wendy", lastName: "Carter", title: "Accounting" },
    // Sofia manages projects (a Manager who is set as Project.managerId).
    { key: "pm", role: "manager", firstName: "Sofia", lastName: "Nguyen", title: "Project Manager" },
    { key: "office", role: "accounting", firstName: "Jordan", lastName: "Lee", title: "Office Coordinator" },
    { key: "customer", role: "customer", firstName: "Robert", lastName: "Johnson" },
  ];

  const users: Record<string, { id: string }> = {};
  for (const u of userDefs) {
    const created = await prisma.user.create({
      data: {
        companyId: company.id,
        email: `${u.key}@anexahomes.com`,
        passwordHash: password,
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role,
        title: u.title,
        phone: "(555) 123-4567",
        // Everyone can switch all three workspaces by default; the installer is
        // restricted to Roofing only (demoing per-user industry access).
        industries: u.key === "installer" ? ["roofing"] : ["roofing", "solar", "others"],
      },
    });
    users[u.key] = created;
  }

  // Cody (canvasser) reports to Tyler (rep): every knock/lead/appointment Cody
  // generates auto-assigns to and is visible by Tyler.
  await prisma.user.update({ where: { id: users.canvasser.id }, data: { salesRepId: users.rep.id } });
  // Tyler & Dylan (reps) report to Priya (manager): she sees only her team's work.
  // Give reps a commission split so per-deal profit estimates are meaningful.
  await prisma.user.update({ where: { id: users.rep.id }, data: { managerId: users.manager.id, commissionSplitPct: 45, deductiblePct: 100 } });
  await prisma.user.update({ where: { id: users.rep2.id }, data: { managerId: users.manager.id, commissionSplitPct: 40 } });

  // Demo staff have already completed onboarding (so they land in the portal, not
  // the new-hire wizard). Real invited users still go through onboarding.
  await prisma.userOnboarding.createMany({
    data: Object.values(users).map((u) => ({ userId: u.id, completedAt: new Date() })),
  });

  // Crews (link the installer user to Crew A so their job scope works)
  const crewA = await prisma.crew.create({
    data: {
      companyId: company.id,
      name: "Crew A — Diaz",
      leadName: "Carlos Diaz",
      phone: "(555) 333-2211",
      members: {
        create: [
          { userId: users.installer.id, name: "Carlos Diaz", role: "supervisor", payRate: 0 },
          { name: "Miguel Santos", role: "installer", payRate: 0 },
          { name: "Andre Cole", role: "installer", payRate: 0 },
        ],
      },
    },
  });
  const crewB = await prisma.crew.create({
    data: {
      companyId: company.id,
      name: "Crew B — Rivera",
      leadName: "Luis Rivera",
      phone: "(555) 333-9988",
      members: { create: [{ name: "Luis Rivera", role: "supervisor", payRate: 0 }, { name: "Sam Patel", role: "installer", payRate: 0 }] },
    },
  });

  // Lead sources
  const sourceNames = ["Storm Canvassing", "Referral", "Website", "Google Ads", "Insurance Partner"];
  const sources = [];
  for (let i = 0; i < sourceNames.length; i++) {
    sources.push(
      await prisma.leadSource.create({
        data: { companyId: company.id, name: sourceNames[i], position: i },
      })
    );
  }

  // Pipeline + stages (Roofing is the established workspace).
  const pipeline = await prisma.pipeline.create({
    data: { companyId: company.id, name: "Roofing Pipeline", industry: "roofing", isDefault: true },
  });
  const stages = [];
  for (let i = 0; i < STAGES.length; i++) {
    const s = STAGES[i];
    stages.push(
      await prisma.pipelineStage.create({
        data: {
          pipelineId: pipeline.id,
          key: s.key,
          name: s.name,
          color: s.color,
          position: i,
          isWon: (s as { isWon?: boolean }).isWon ?? false,
        },
      })
    );
  }
  const stageByKey = Object.fromEntries(stages.map((s) => [s.key, s]));

  // Solar + Others are separate, isolated workspaces with their own starter stages
  // (different process). The team can customize these as they ramp each up.
  const SOLAR_STAGES = [
    { key: "new_appt", name: "New Appointment", color: "#FBBF24" },
    { key: "site_survey", name: "Site Survey", color: "#F59E0B" },
    { key: "proposal_sent", name: "Proposal Sent", color: "#F97316" },
    { key: "contract_signed", name: "Contract Signed", color: "#FB923C" },
    { key: "permitting", name: "Permitting", color: "#A78BFA" },
    { key: "install_scheduled", name: "Install Scheduled", color: "#60A5FA" },
    { key: "installed", name: "Installed", color: "#34D399" },
    { key: "pto", name: "PTO / Activated", color: "#22C55E" },
    { key: "paid", name: "Paid", color: "#16A34A", isWon: true },
  ];
  // "Others" is a catch-all workspace for miscellaneous leads to sub out.
  const OTHERS_STAGES = [
    { key: "new_lead", name: "New Lead", color: "#94A3B8" },
    { key: "qualified", name: "Qualified", color: "#38BDF8" },
    { key: "quoted", name: "Quoted", color: "#6366F1" },
    { key: "subbed_out", name: "Subbed Out", color: "#F59E0B" },
    { key: "closed", name: "Closed", color: "#16A34A", isWon: true },
  ];
  for (const [industry, name, defs] of [
    ["solar", "Solar Pipeline", SOLAR_STAGES] as const,
    ["others", "Others Pipeline", OTHERS_STAGES] as const,
  ]) {
    const p = await prisma.pipeline.create({ data: { companyId: company.id, name, industry, isDefault: true } });
    for (let i = 0; i < defs.length; i++) {
      const s = defs[i];
      await prisma.pipelineStage.create({
        data: { pipelineId: p.id, key: s.key, name: s.name, color: s.color, position: i, isWon: (s as { isWon?: boolean }).isWon ?? false },
      });
    }
  }

  // Commission rules
  await prisma.commissionRule.createMany({
    data: [
      { companyId: company.id, name: "Sales Rep — 10%", role: "sales_rep", type: "percentage", percent: 10 },
      { companyId: company.id, name: "Manager Override — 3%", role: "manager", type: "percentage", percent: 3 },
      { companyId: company.id, name: "Crew Flat — $1,500", role: "installer", type: "flat", flatAmount: 150000 },
    ],
  });

  // The sales-rep commission rule is the single source of truth for rep commissions
  // (label + ruleId), so seeded commissions match what the engine would generate.
  const salesRepRule = await prisma.commissionRule.findFirstOrThrow({
    where: { companyId: company.id, role: "sales_rep" },
  });

  // Default notification rules (fully editable in Settings → Notifications)
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

  // Internal team chat: a company-wide channel (all staff) + a sample DM.
  const staffKeys = ["owner", "admin", "manager", "rep", "pm", "installer", "office", "accounting"];
  const generalChannel = await prisma.conversation.create({
    data: {
      companyId: company.id,
      type: "channel",
      name: "Company Announcements",
      createdById: users.owner.id,
      members: { create: staffKeys.map((k) => ({ userId: users[k].id })) },
    },
  });
  await prisma.message.createMany({
    data: [
      {
        companyId: company.id,
        conversationId: generalChannel.id,
        senderId: users.owner.id,
        body: "Welcome to the Anexa Homes team chat! Use this channel for company-wide updates.",
      },
      {
        companyId: company.id,
        conversationId: generalChannel.id,
        senderId: users.manager.id,
        body: "Reminder: log your inspections in the CRM the same day. 🙌",
      },
    ],
  });
  // Manager <-> Rep DM (allowed; rep<->rep would not be).
  const dm = await prisma.conversation.create({
    data: {
      companyId: company.id,
      type: "dm",
      dmKey: [users.manager.id, users.rep.id].sort().join(":"),
      createdById: users.manager.id,
      members: { create: [{ userId: users.manager.id }, { userId: users.rep.id }] },
    },
  });
  await prisma.message.create({
    data: {
      companyId: company.id,
      conversationId: dm.id,
      senderId: users.manager.id,
      body: "Hey Tyler — great work on the Johnson roof. Let's sync on the Plano leads tomorrow.",
    },
  });

  // Canvassing: a territory assigned to the rep + a few seeded door-knocks.
  const territory = await prisma.territory.create({
    data: {
      companyId: company.id,
      name: "Downtown Dallas",
      color: "#F4631E",
      polygon: [
        [32.795, -96.815],
        [32.795, -96.795],
        [32.775, -96.795],
        [32.775, -96.815],
      ],
      assignedRepId: users.rep.id,
      createdById: users.manager.id,
    },
  });
  const knockSeed: { lat: number; lng: number; address: string; disposition: KnockDispo; notes: string | null }[] = [
    { lat: 32.788, lng: -96.805, address: "101 Main St", disposition: "appointment", notes: "Interested — appt Tue 4pm" },
    { lat: 32.786, lng: -96.808, address: "215 Elm St", disposition: "not_home", notes: null },
    { lat: 32.79, lng: -96.802, address: "330 Commerce St", disposition: "not_interested", notes: null },
    { lat: 32.784, lng: -96.806, address: "44 Akard St", disposition: "sold", notes: "Signed contract!" },
  ];
  await prisma.knock.createMany({
    data: knockSeed.map((k) => ({
      companyId: company.id,
      repId: users.rep.id,
      territoryId: territory.id,
      lat: k.lat,
      lng: k.lng,
      address: k.address,
      city: "Dallas",
      state: "TX",
      disposition: k.disposition,
      notes: k.notes,
    })),
  });

  // Auto-generated "Not knocked" house pins (as if the territory was populated
  // from the address dataset) — repId null until a rep knocks them.
  const notKnockedSeed = [
    { lat: 32.787, lng: -96.804, address: "110 Main St" },
    { lat: 32.789, lng: -96.806, address: "225 Elm St" },
    { lat: 32.785, lng: -96.807, address: "318 Commerce St" },
    { lat: 32.7865, lng: -96.8035, address: "52 Akard St" },
  ];
  await prisma.knock.createMany({
    data: notKnockedSeed.map((k) => ({
      companyId: company.id,
      repId: null,
      territoryId: territory.id,
      lat: k.lat,
      lng: k.lng,
      address: k.address,
      city: "Dallas",
      state: "TX",
      disposition: "not_knocked" as KnockDispo,
      notes: null,
    })),
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

  // Document templates (the 8) with a couple signature/date fields
  for (const t of DOC_TEMPLATES) {
    await prisma.documentTemplate.create({
      data: {
        companyId: company.id,
        name: t.name,
        type: t.type,
        description: `${t.name} for Anexa Homes customers.`,
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

  // Sample leads spread across stages.
  //
  // `apptDays` (negative = past, positive = future, omitted = never scheduled)
  // and `outcome` exist so the Appointments list has every filter bucket to
  // show out of the box: Not ran (past, unlogged), a couple of logged outcomes,
  // Upcoming, and Unscheduled.
  const leadSeed: {
    first: string; last: string; stage: string; value: number; status: string;
    customer?: string; service: string; apptDays?: number; outcome?: string;
  }[] = [
    { first: "Robert", last: "Johnson", stage: "in_production", value: 2450000, status: "open", customer: "customer", service: "roofing", apptDays: -9, outcome: "Ran" },
    { first: "Emily", last: "Watson", stage: "new_lead", value: 1800000, status: "open", service: "solar", apptDays: -6, outcome: "Ran" },
    { first: "David", last: "Kim", stage: "appointment_set", value: 2100000, status: "open", service: "windows", apptDays: -4, outcome: "No Show" },
    { first: "Maria", last: "Garcia", stage: "claim_opened", value: 2750000, status: "open", service: "solar", apptDays: -3 },
    { first: "James", last: "Miller", stage: "contract_signed", value: 3200000, status: "open", service: "roofing", apptDays: -2 },
    { first: "Linda", last: "Davis", stage: "scope_received", value: 1950000, status: "open", service: "water_filtration", apptDays: -1 },
    { first: "Chris", last: "Wilson", stage: "paid", value: 2890000, status: "won", service: "roofing", apptDays: 2 },
    { first: "Nancy", last: "Moore", stage: "qc_inspection", value: 2300000, status: "open", service: "hvac", apptDays: 5 },
    { first: "Kevin", last: "Taylor", stage: "scheduled", value: 2050000, status: "open", service: "roofing" },
    { first: "Sarah", last: "Anderson", stage: "inspection_complete", value: 1750000, status: "open", service: "roofing" },
  ];
  const daysFromNow = (d: number) => new Date(Date.now() + d * 24 * 60 * 60 * 1000);

  let projNum = 1001;
  for (let i = 0; i < leadSeed.length; i++) {
    const l = leadSeed[i];
    const stage = stageByKey[l.stage];
    const lead = await prisma.lead.create({
      data: {
        companyId: company.id,
        firstName: l.first,
        lastName: l.last,
        email: `${l.first.toLowerCase()}.${l.last.toLowerCase()}@example.com`,
        phone: "(555) 987-6543",
        address: `${100 + i} Oak Street`,
        city: "Dallas",
        state: "TX",
        zip: "75201",
        pipelineId: pipeline.id,
        stageId: stage.id,
        position: i,
        status: l.status as any,
        serviceType: l.service as any,
        value: l.value,
        sourceId: sources[i % sources.length].id,
        assignedRepId: users.rep.id,
        createdById: users.manager.id,
        customerUserId: l.customer ? users[l.customer].id : null,
        appointmentAt: l.apptDays === undefined ? null : daysFromNow(l.apptDays),
        appointmentDisposition: l.outcome ?? null,
        claimStatus: ["claim_opened", "scope_received", "contract_signed"].includes(l.stage)
          ? "filed"
          : "not_filed",
        notes: "Initial inspection scheduled. Hail damage on north slope.",
      },
    });

    // Create a project for advanced-stage leads
    const advanced = ["contract_signed", "scheduled", "in_production", "qc_inspection", "paid"].includes(l.stage);
    if (advanced) {
      const project = await prisma.project.create({
        data: {
          companyId: company.id,
          leadId: lead.id,
          projectNumber: `AH-${projNum++}`,
          status: l.stage === "in_production" ? "in_production" : l.stage === "qc_inspection" ? "qc" : l.stage === "paid" ? "completed" : "not_started",
          serviceType: l.service as any,
          managerId: users.pm.id,
          address: lead.address,
          city: lead.city,
          state: lead.state,
          zip: lead.zip,
          roofingType: "Architectural Shingle",
          materialSelection: "GAF Timberline HDZ — Charcoal",
          squares: 32,
          pitch: "6/12",
          tearOffLayers: 1,
          contractValue: l.value,
          qcChecklist: [
            { label: "Magnetic nail sweep complete", done: l.stage === "paid" },
            { label: "Gutters cleaned", done: l.stage === "paid" },
            { label: "Final photos uploaded", done: ["qc_inspection", "paid"].includes(l.stage) },
          ],
        },
      });

      await prisma.claim.create({
        data: {
          companyId: company.id,
          leadId: lead.id,
          projectId: project.id,
          carrier: "State Farm",
          claimNumber: `SF-2026-${4000 + i}`,
          policyNumber: `POL-${90000 + i}`,
          adjusterName: "Greg Holloway",
          adjusterPhone: "(555) 222-1111",
          status: "approved",
          rcv: l.value,
          acv: Math.round(l.value * 0.78),
          deductible: 250000,
          depreciation: Math.round(l.value * 0.22),
        },
      });

      await prisma.roofMeasurement.create({
        data: {
          companyId: company.id,
          leadId: lead.id,
          projectId: project.id,
          source: "eagleview",
          totalSquares: 32,
          wastePct: 12,
          pitch: "6/12",
          ridgeLf: 120,
          hipLf: 60,
          valleyLf: 45,
          eaveLf: 180,
          rakeLf: 90,
        },
      });

      // Assign crews + a daily report for jobs in/after production.
      if (["scheduled", "in_production", "qc_inspection", "paid"].includes(l.stage)) {
        await prisma.projectCrew.create({
          data: { projectId: project.id, crewId: crewA.id, role: "Tear-off & install" },
        });
      }
      if (["in_production", "qc_inspection"].includes(l.stage)) {
        await prisma.projectCrew.create({
          data: { projectId: project.id, crewId: crewB.id, role: "Detail & cleanup" },
        });
        await prisma.dailyReport.create({
          data: {
            companyId: company.id,
            projectId: project.id,
            reportedById: users.installer.id,
            squaresCompleted: 18,
            crewSize: 5,
            weather: "Clear, 82°F",
            summary: "Completed front and north slopes. Underlayment and shingles installed.",
          },
        });
      }

      // Commission for the rep on the project
      if (l.stage === "paid") {
        await prisma.commission.create({
          data: {
            companyId: company.id,
            projectId: project.id,
            userId: users.rep.id,
            ruleId: salesRepRule.id,
            label: salesRepRule.name,
            baseAmount: l.value,
            amount: Math.round(l.value * salesRepRule.percent / 100),
            status: "approved",
            approvedAt: new Date(),
          },
        });
      }
    }
  }

  // ── Knowledge Base / Training (role-gated) ────────────────────────────────
  const repTraining = await prisma.knowledgeCategory.create({
    data: {
      companyId: company.id,
      industry: "roofing",
      name: "Sales Rep Training",
      description: "Scripts, objection handling, and onboarding for roofing consultants.",
      visibleRoles: ["sales_rep"],
      position: 0,
    },
  });
  await prisma.knowledgeItem.createMany({
    data: [
      {
        companyId: company.id,
        categoryId: repTraining.id,
        type: "article",
        title: "Door Approach Script",
        description: "The opening lines that get a storm inspection booked.",
        body:
          "Hi, I'm with Anexa Homes — we're inspecting roofs in the neighborhood after the recent storm.\n\n" +
          "We've already helped a few of your neighbors file successful insurance claims. " +
          "I'd love to do a free 15-minute inspection and let you know if you have any storm damage. " +
          "Worst case, you get peace of mind. Does the front or back of the house have the most sun exposure?",
        position: 0,
        createdById: users.manager.id,
      },
      {
        companyId: company.id,
        categoryId: repTraining.id,
        type: "link",
        title: "Insurance Claim Process Overview",
        description: "How a storm claim flows from inspection to approval.",
        url: "https://www.iii.org/article/how-to-file-a-homeowners-insurance-claim",
        position: 1,
        createdById: users.manager.id,
      },
    ],
  });

  await prisma.knowledgeCategory.create({
    data: {
      companyId: company.id,
      industry: "roofing",
      name: "Installer / Crew Training",
      description: "Safety, install standards, and photo documentation requirements.",
      visibleRoles: ["installer"],
      position: 1,
      items: {
        create: [
          {
            companyId: company.id,
            type: "article",
            title: "Job Site Safety Checklist",
            description: "Required PPE and fall-protection steps before any install.",
            body:
              "Before stepping on a roof: harness anchored, ladder secured at 4:1 angle, " +
              "ground area cleared of crew and homeowners, weather checked for wind/lightning. " +
              "Document the dump trailer placement and magnetic nail sweep at end of day.",
            position: 0,
            createdById: users.manager.id,
          },
        ],
      },
    },
  });

  await prisma.knowledgeCategory.create({
    data: {
      companyId: company.id,
      industry: "roofing",
      name: "Company-Wide",
      description: "Resources everyone on the team should know.",
      visibleRoles: ["sales_rep", "canvasser", "marketing", "installer", "accounting"],
      position: 2,
      items: {
        create: [
          {
            companyId: company.id,
            type: "article",
            title: "Welcome to Anexa Homes",
            description: "Our mission, values, and who to contact.",
            body:
              "Welcome to the team! Anexa Homes is built on doing right by homeowners. " +
              "Questions? Reach out in the #company-announcements channel or to your manager.",
            position: 0,
            createdById: users.owner.id,
          },
        ],
      },
    },
  });

  // ── Scope of Work template + demo scope ───────────────────────────────────
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
      industry: "roofing" as const,
      position: i,
      category: t.category,
      description: t.description,
      unit: t.unit,
      defaultInsuranceUnitPrice: t.ins,
      defaultCostUnitPrice: t.cost,
    })),
  });

  // Master scope catalog — the full insurance-restoration line-item list (no pricing).
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

  // A demo scope on the Scope Received deal (Linda Davis) so the calculator has data.
  const scopeLead = await prisma.lead.findFirst({
    where: { companyId: company.id, firstName: "Linda", lastName: "Davis" },
    select: { id: true },
  });
  if (scopeLead) {
    const demoScope = await prisma.scopeOfWork.create({
      data: { companyId: company.id, leadId: scopeLead.id, industry: "roofing" },
      select: { id: true },
    });
    await prisma.scopeLine.createMany({
      data: [
        { category: "Roofing", description: "Shingles — remove & replace", quantity: 30, unit: "sq", insuranceUnitPrice: 35000, costUnitPrice: 21000 },
        { category: "Roofing", description: "Synthetic underlayment", quantity: 30, unit: "sq", insuranceUnitPrice: 4500, costUnitPrice: 2200 },
        { category: "Gutters", description: '6" K-style gutter', quantity: 140, unit: "lf", insuranceUnitPrice: 1200, costUnitPrice: 750 },
        { category: "Labor", description: "Tear-off labor", quantity: 30, unit: "sq", insuranceUnitPrice: 0, costUnitPrice: 6500 },
      ].map((l, i) => ({
        companyId: company.id,
        scopeId: demoScope.id,
        position: i,
        ...l,
      })),
    });
  }

  // ── Bookkeeping demo: categories + per-job transactions + an invoice ───────
  const demoJob = await prisma.project.findFirst({
    where: { companyId: company.id },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (demoJob) {
    // Give the demo job a customer-paid deductible so the profit card shows it.
    await prisma.project.update({ where: { id: demoJob.id }, data: { deductibleCents: 250000 } });
    const [revCat, matCat] = await Promise.all([
      prisma.bookkeepingCategory.create({ data: { companyId: company.id, name: "Job Revenue", type: "income" } }),
      prisma.bookkeepingCategory.create({ data: { companyId: company.id, name: "Materials", type: "expense" } }),
    ]);
    await prisma.transaction.createMany({
      data: [
        {
          companyId: company.id,
          date: new Date("2026-06-05"),
          description: "Customer deposit — roof replacement",
          amountCents: 850000,
          vendor: "Chris Wilson",
          account: "Operating Checking",
          categoryId: revCat.id,
          projectId: demoJob.id,
          status: "categorized",
          approved: true,
          createdById: users.accounting.id,
        },
        {
          companyId: company.id,
          date: new Date("2026-06-07"),
          description: "Shingles & underlayment — ABC Supply",
          amountCents: -420000,
          vendor: "ABC Supply",
          account: "Operating Checking",
          categoryId: matCat.id,
          projectId: demoJob.id,
          status: "categorized",
          approved: true,
          createdById: users.accounting.id,
        },
        {
          companyId: company.id,
          date: new Date("2026-06-09"),
          description: "Dumpster rental",
          amountCents: -45000,
          vendor: "Waste Mgmt",
          account: "Operating Checking",
          categoryId: matCat.id,
          projectId: demoJob.id,
          status: "categorized",
          approved: true,
          createdById: users.accounting.id,
        },
      ],
    });
    // An unreviewed transaction so "Auto-suggest" + the pencil/receipt flow are demoable.
    await prisma.transaction.create({
      data: {
        companyId: company.id,
        date: new Date("2026-06-12"),
        description: "ABC Supplier — shingle delivery",
        amountCents: -1000000,
        account: "Operating Checking",
        status: "uncategorized",
        approved: false,
        source: "import",
      },
    });

    // Two distinct 1099 subcontractors (construction vs. installation) + their
    // payments, so the Financial report's "Contractor payments by contractor"
    // table shows real per-contractor lines instead of $0.
    const [constructionVendor, installVendor] = await Promise.all([
      prisma.bookkeepingVendor.create({ data: { companyId: company.id, name: "Summit Construction Crew", is1099: true, einTaxId: "47-1100221" } }),
      prisma.bookkeepingVendor.create({ data: { companyId: company.id, name: "ProInstall Roofing", is1099: true, einTaxId: "47-2200332" } }),
    ]);
    const laborCat = await prisma.bookkeepingCategory.create({ data: { companyId: company.id, name: "Subcontractor Labor", type: "expense" } });
    await prisma.transaction.createMany({
      data: [
        {
          companyId: company.id,
          date: new Date("2026-06-08"),
          description: "Tear-off & structural repair — Summit Construction Crew",
          amountCents: -380000,
          vendor: constructionVendor.name,
          account: "Operating Checking",
          categoryId: laborCat.id,
          projectId: demoJob.id,
          status: "categorized",
          approved: true,
          createdById: users.accounting.id,
        },
        {
          companyId: company.id,
          date: new Date("2026-06-10"),
          description: "Shingle installation labor — ProInstall Roofing",
          amountCents: -265000,
          vendor: installVendor.name,
          account: "Operating Checking",
          categoryId: laborCat.id,
          projectId: demoJob.id,
          status: "categorized",
          approved: true,
          createdById: users.accounting.id,
        },
      ],
    });
  }

  // Demo custom fields on the appointment form (one required, one optional).
  await prisma.customFieldDef.createMany({
    data: [
      { companyId: company.id, entity: "lead", key: "damage_type", label: "Damage Type", type: "select", options: ["Hail", "Wind", "Hail + Wind", "Other"], required: true, position: 0 },
      { companyId: company.id, entity: "lead", key: "roof_age_years", label: "Roof Age (years)", type: "number", required: false, position: 1 },
    ],
  });

  await prisma.activityLog.create({
    data: {
      companyId: company.id,
      type: "system",
      message: "Anexa Homes CRM initialized with seed data.",
      actorId: users.owner.id,
    },
  });

  // Sequential employee numbers per company, by join (createdAt) order.
  for (const co of await prisma.company.findMany({ select: { id: true } })) {
    const team = await prisma.user.findMany({ where: { companyId: co.id }, orderBy: { createdAt: "asc" }, select: { id: true } });
    let n = 0;
    for (const u of team) {
      n += 1;
      await prisma.user.update({ where: { id: u.id }, data: { employeeNo: n } });
    }
  }

  console.log("✅ Seed complete.");
  console.log("   Company: Anexa Homes (slug: anexa-homes)");
  console.log("   Login password for all users: Passw0rd!");
  console.log("   Emails: owner@ admin@ manager@ rep@ pm@ installer@ office@ accounting@ customer@anexahomes.com");
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
