/**
 * Production build check: every ENABLED agent must point at a handler this
 * build contains. Runs after `prisma generate` and before `next build`; exit 1
 * fails the build, and the previous deployment keeps serving.
 *
 * Previews and local builds skip it, by the same rule as prod-migrate.mjs:
 * they must never read the production database. By the time this runs,
 * prod-migrate has already applied migrations, so `agents` exists.
 */
import { PrismaClient } from "@prisma/client";
import { formatUnknownHandlers, unknownHandlers } from "../src/server/modules/agents/handler-check";

async function main() {
  if (process.env.VERCEL_ENV !== "production") {
    console.log(`[check-agent-handlers] VERCEL_ENV=${process.env.VERCEL_ENV ?? "(unset)"} — not a production build, skipping.`);
    return;
  }
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.agent.findMany({
      where: { enabled: true },
      orderBy: [{ companyId: "asc" }, { name: "asc" }],
      select: { name: true, handlerKey: true, company: { select: { name: true } } },
    });
    const broken = unknownHandlers(rows.map((r) => ({ company: r.company.name, name: r.name, handlerKey: r.handlerKey })));
    if (broken.length > 0) {
      console.error(formatUnknownHandlers(broken));
      process.exitCode = 1;
      return;
    }
    console.log(`[check-agent-handlers] ${rows.length} enabled agent(s), every handler present.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[check-agent-handlers] could not run", err);
  process.exit(1);
});
