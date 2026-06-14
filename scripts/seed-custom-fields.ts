/**
 * Seed a comprehensive set of claim + property custom fields on the appointment
 * (lead) entity. Idempotent: keyed by (companyId, entity, key) — re-running skips
 * existing fields. Keys use the same slug() the UI uses, so they're editable on
 * Settings -> Custom Fields like any hand-added field.
 */
import { PrismaClient, type CustomFieldType, Prisma } from "@prisma/client";
const prisma = new PrismaClient();

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "field";

type F = { label: string; type: CustomFieldType; options?: string[] };
const LEAD_FIELDS: F[] = [
  // ── Claim / insurance ──
  { label: "Insurance Carrier", type: "text" },
  { label: "Claim Number", type: "text" },
  { label: "Policy Number", type: "text" },
  { label: "Date of Loss", type: "date" },
  { label: "Damage Type", type: "select", options: ["Hail", "Wind", "Hail + Wind", "Storm", "Fire", "Water", "Other"] },
  { label: "Claim Status", type: "select", options: ["Not Filed", "Filed", "Inspection Scheduled", "Approved", "Partially Approved", "Denied", "Supplement Pending"] },
  { label: "Adjuster Name", type: "text" },
  { label: "Adjuster Phone", type: "text" },
  { label: "Adjuster Meeting Date", type: "date" },
  { label: "RCV (Replacement Cost)", type: "number" },
  { label: "ACV (Actual Cash Value)", type: "number" },
  { label: "Deductible", type: "number" },
  { label: "Depreciation", type: "number" },
  { label: "Mortgage Company", type: "text" },
  // ── Property / roof ──
  { label: "Number of Stories", type: "number" },
  { label: "Roof Type", type: "select", options: ["3-Tab Shingle", "Architectural Shingle", "Metal", "Tile", "Flat / TPO", "Wood Shake", "Other"] },
  { label: "Roof Pitch", type: "text" },
  { label: "Squares", type: "number" },
  { label: "Number of Layers", type: "number" },
  { label: "Year Built", type: "number" },
  { label: "Roof Age (Years)", type: "number" },
  { label: "Gate / Lockbox Code", type: "text" },
  { label: "HOA Community", type: "checkbox" },
];

async function main() {
  for (const company of await prisma.company.findMany({ select: { id: true, name: true } })) {
    // Position after any existing lead fields, preserving their order.
    let pos = await prisma.customFieldDef.count({ where: { companyId: company.id, entity: "lead" } });
    let added = 0, skipped = 0;
    for (const f of LEAD_FIELDS) {
      const key = slug(f.label);
      const exists = await prisma.customFieldDef.findFirst({ where: { companyId: company.id, entity: "lead", key }, select: { id: true } });
      if (exists) { skipped++; continue; }
      await prisma.customFieldDef.create({
        data: {
          companyId: company.id,
          entity: "lead",
          key,
          label: f.label,
          type: f.type,
          options: (f.options ?? []) as unknown as Prisma.InputJsonValue,
          required: false,
          position: pos++,
        },
      });
      added++;
    }
    console.log(`✅ ${company.name}: added ${added} lead fields${skipped ? `, skipped ${skipped} existing` : ""}`);
  }
}
main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
