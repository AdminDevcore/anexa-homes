import { defineConfig, devices } from "@playwright/test";
import { E2E_DATABASE_URL } from "./e2e/global-setup";

const PORT = process.env.E2E_PORT ?? "3001";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  // Build + seed the isolated `e2e_test` schema before any spec runs.
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
    headless: true,
  },
  // Boot a dedicated app server pointed at the isolated test database, on its own
  // build dir so it never collides with the dev server's `.next`. reuseExistingServer
  // is false so tests can never accidentally run against a dev-DB server.
  webServer: {
    command: `next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      DATABASE_URL: E2E_DATABASE_URL,
      NEXT_DIST_DIR: ".next-e2e",
      // Offline, deterministic AVM so tests don't hit (or need a key for) a real
      // provider. Clearly labeled "Test Fixture"; never used in dev/prod.
      PROPERTY_VALUE_PROVIDER: "fixture",
      PROPERTY_VALUE_API_KEY: "",
      // Offline deterministic homeowner skip-trace for E2E (fake data, never prod).
      SKIP_TRACE_PROVIDER: "fixture",
      SKIP_TRACE_API_KEY: "",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
