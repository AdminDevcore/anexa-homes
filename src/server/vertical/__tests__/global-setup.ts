import { execSync } from "node:child_process";

/**
 * Prepares an isolated Postgres schema for the vertical-isolation integration
 * suite, so it never touches the dev schema (`public`) or the Playwright one
 * (`e2e_test`). Uses a schema rather than a database so no CREATE DATABASE
 * privilege is needed.
 *
 * Override with VERTICAL_TEST_DATABASE_URL to point somewhere else.
 */
export const TEST_DATABASE_URL =
  process.env.VERTICAL_TEST_DATABASE_URL ??
  "postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=vertical_test";

export default function globalSetup() {
  const env = { ...process.env, DATABASE_URL: TEST_DATABASE_URL };
  console.log(`[vertical] preparing isolated test schema: ${TEST_DATABASE_URL}`);
  execSync("pnpm exec prisma migrate deploy", { stdio: "inherit", env });
}
