import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * DB-backed integration suite, kept separate from `pnpm test` so the unit suite
 * stays sub-second and its pass count remains a stable regression baseline.
 *
 *   pnpm test:integration
 *
 * Runs against an isolated `vertical_test` Postgres schema on the local dev
 * instance — never the dev schema, never production.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["src/**/*.itest.ts"],
    environment: "node",
    globalSetup: "./src/server/vertical/__tests__/global-setup.ts",
    // The extension resolves context per query; parallel files sharing one
    // Postgres schema would race on fixtures.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
