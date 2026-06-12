import { execSync } from "node:child_process";

/**
 * Prepares an isolated test database BEFORE any E2E spec runs, so tests never
 * write to the dev database. We use a dedicated Postgres schema (`e2e_test`) on
 * the same instance — no CREATE DATABASE privilege required. Prisma creates the
 * schema + tables on `migrate deploy`, then we seed it fresh.
 *
 * Override the target with E2E_DATABASE_URL if you prefer a separate database.
 */
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  "postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=e2e_test";

export default function globalSetup() {
  const env = { ...process.env, DATABASE_URL: E2E_DATABASE_URL };
  console.log(`[e2e] Preparing isolated test schema: ${E2E_DATABASE_URL}`);
  execSync("pnpm exec prisma migrate deploy", { stdio: "inherit", env });
  execSync("pnpm exec tsx prisma/seed.ts", { stdio: "inherit", env });
  execSync("pnpm exec tsx prisma/seed-e2e-extra-tenant.ts", { stdio: "inherit", env });
}
