// FIRST, and for its side effect: loads `.env` into the runner the way `next dev`
// loads it into the app. Everything below reads `process.env` at module scope, so
// this import must stay above them. See e2e/load-env.ts for what went wrong without it.
import "./e2e/load-env";

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
  projects: [
    // Runs BEFORE anything else and stops the run if it fails. The failure it
    // exists to catch — the app having a workspace switched on that the suite is
    // skipping — is invisible in a report that says "passed, 84 skipped", and it
    // survived precisely because nothing ever went red. A dependency makes it
    // impossible to miss and cheap to hit: ~10 seconds, not 20 minutes in.
    {
      name: "preflight",
      testMatch: /vertical-coverage\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /vertical-coverage\.spec\.ts/,
      dependencies: ["preflight"],
    },
  ],
});
