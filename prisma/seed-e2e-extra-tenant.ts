import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash("Passw0rd!", 10);

  // Upsert Summit Roofing company with distinct branding.
  const company = await prisma.company.upsert({
    where: { slug: "summit-roofing" },
    create: {
      name: "Summit Roofing",
      slug: "summit-roofing",
      phone: "(111) 222-3333",
      email: "hello@summitroofing.test",
      website: "https://summitroofing.test",
      address: "500 Mountain View Drive",
      city: "Asheville",
      state: "NC",
      zip: "28801",
      timezone: "America/New_York",
      settings: {
        create: {
          logoUrl: null, // Will show initials badge + name
          primaryColor: "#1F2937",
          accentColor: "#10B981",
          recordPrefix: "SR-",
          supportPhone: "(111) 222-3333",
          supportEmail: "support@summitroofing.test",
          currencyCode: "EUR",
          locale: "de-DE",
          emailFromName: "Summit Roofing",
          requiredDocuments: ["roofing_contract"],
        },
      },
    },
    update: {}, // Do nothing if it exists
  });

  // Upsert owner user for Summit Roofing using the compound unique constraint.
  const ownerUser = await prisma.user.upsert({
    where: { companyId_email: { companyId: company.id, email: "ownerb@summitroofing.test" } },
    create: {
      companyId: company.id,
      email: "ownerb@summitroofing.test",
      passwordHash: password,
      firstName: "Benjamin",
      lastName: "Stone",
      phone: "(111) 222-3333",
      role: "super_admin",
      status: "active",
      title: "Owner / CEO",
      industries: ["roofing", "solar", "water"],
    },
    update: {}, // Do nothing if it exists
  });

  // Ensure the owner has completed onboarding so they land in /portal.
  await prisma.userOnboarding.upsert({
    where: { userId: ownerUser.id },
    create: { userId: ownerUser.id, completedAt: new Date() },
    update: { completedAt: new Date() },
  });

  console.log("✅ E2E extra tenant seed complete.");
  console.log("   Company: Summit Roofing (slug: summit-roofing)");
  console.log("   Owner: ownerb@summitroofing.test / Passw0rd!");
  console.log("   Settings: recordPrefix SR-, currencyCode EUR, locale de-DE, supportPhone (111) 222-3333");
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
