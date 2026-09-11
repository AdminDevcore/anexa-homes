import { loadEnvConfig } from "@next/env";

/**
 * Give the Playwright RUNNER the same environment the app under test gets.
 *
 * THE BUG THIS EXISTS TO PREVENT. `next dev` loads `.env` itself; the Playwright
 * runner does not load anything. So for as long as this file did not exist, the
 * two processes disagreed: `.env` set `SOLAR_VERTICAL_ENABLED=1`, the app booted
 * with the Solar workspace switched ON, and every spec that asked
 * `process.env.SOLAR_VERTICAL_ENABLED` in the runner got `undefined` and called
 * `test.skip()`. A plain `pnpm e2e` therefore exercised solar in the app while
 * skipping the ~84 tests across 20 spec files that cover it, and reported green.
 * Nobody had to make a mistake for that to happen — it was the default.
 *
 * WHY NEXT'S OWN LOADER RATHER THAN dotenv OR A HAND-ROLLED PARSER. The whole
 * defect is two processes resolving the same variable differently, so the fix
 * has to be the app's own resolution, not a second implementation of it that
 * agrees today. `loadEnvConfig` is what `next dev` calls, with Next's precedence
 * (`.env.local` over `.env`, NODE_ENV-specific files, `.env.development` under
 * dev) — pinned to the same version as `next` in package.json so the two cannot
 * drift apart on an upgrade.
 *
 * IMPORT THIS FIRST, AND FOR ITS SIDE EFFECT. ES modules evaluate in import
 * order, and anything that reads `process.env` at module scope — `E2E_PORT`,
 * `E2E_DATABASE_URL` — must be evaluated after this has run, or it reads the
 * pre-`.env` value and the problem comes back one variable at a time.
 *
 * `dev: true` because the server under test is `next dev`. Nothing here targets
 * the test database: both places that matter (`global-setup`'s seed env and
 * `webServer.env`) set `DATABASE_URL` explicitly, so loading the developer's own
 * `DATABASE_URL` into the runner cannot point the suite at the dev database.
 */
loadEnvConfig(process.cwd(), true);
