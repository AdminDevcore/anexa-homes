import { defineConfig, devices } from "@playwright/test";
import { E2E_DATABASE_URL } from "./e2e/global-setup";

const PORT = process.env.E2E_PORT ?? "3001";

// The build dir follows the port. `next dev` refuses to start a second server
// against the same dist dir, so a fixed ".next-e2e" made two sessions running
// specs at once collide even when they picked different ports. Still matched by
// the /.next-* gitignore rule, which is also what keeps Tailwind from scanning it.
const DIST_DIR = PORT === "3001" ? ".next-e2e" : `.next-e2e-${PORT}`;

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
      NEXT_DIST_DIR: DIST_DIR,
      // Offline, deterministic AVM so tests don't hit (or need a key for) a real
      // provider. Clearly labeled "Test Fixture"; never used in dev/prod.
      PROPERTY_VALUE_PROVIDER: "fixture",
      PROPERTY_VALUE_API_KEY: "",
      // Offline deterministic homeowner skip-trace for E2E (fake data, never prod).
      SKIP_TRACE_PROVIDER: "fixture",
      SKIP_TRACE_API_KEY: "",
      // A key here only decides whether the Google basemaps are OFFERED. This
      // one is deliberately invalid: the tile proxy answers 404, Leaflet draws
      // blank tiles, and the wiring (auth, routing, URL state) is still exercised
      // without any test depending on Google being reachable.
      GOOGLE_MAPS_API_KEY: "e2e-not-a-real-key",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
