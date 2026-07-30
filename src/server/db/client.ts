import { PrismaClient } from "@prisma/client";
import { verticalExtension } from "@/server/vertical/extension";

/**
 * The application's Prisma client, wrapped in the vertical-isolation extension.
 *
 * Because the extension sits on the model API, every `prisma.<model>.<op>()`
 * call in the app is scoped to the active vertical without the call site
 * knowing — including calls written in the future. See src/server/vertical/.
 *
 * With SOLAR_VERTICAL_ENABLED off the extension hands every query straight
 * through, so this is behaviourally identical to a bare PrismaClient.
 *
 * Note: the seed scripts deliberately construct their own *unextended* client,
 * because seeding writes rows into several verticals at once.
 */
function createPrismaClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  }).$extends(verticalExtension());
}

type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as unknown as {
  prisma: ExtendedPrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
