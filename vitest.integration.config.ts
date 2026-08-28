import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { TEST_DATABASE_URL } from "./src/server/vertical/__tests__/global-setup";

/**
 * DB-backed integration suite, kept separate from `pnpm test` so the unit suite
 * stays sub-second and its pass count remains a stable regression baseline.
 *
 *   pnpm test:integration
 *
 * Runs against an isolated `vertical_test` Postgres schema on the local dev
 * instance — never the dev schema, never production.
 */
const require = createRequire(import.meta.url);

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      /**
       * next-auth's lib/env.js imports "next/server". `next` ships no `exports`
       * map, so Node's CJS resolution happily finds server.js while vite's
       * stricter ESM resolver refuses to add the extension — and any test that
       * transitively touches the session helpers dies on import.
       *
       * That chain is wider than it looks: notifications -> branding -> session,
       * so it caught the e-sign service too.
       */
      "next/server": require.resolve("next/server"),
    },
  },
  test: {
    include: ["src/**/*.itest.ts"],
    environment: "node",
    globalSetup: "./src/server/vertical/__tests__/global-setup.ts",
    // Point the APP client (@/server/db/client, which reads DATABASE_URL) at the
    // same isolated schema. Tests that exercise real server modules pull it in
    // transitively; without this a helper deep in the call graph would quietly
    // read and write the dev database.
    env: { DATABASE_URL: TEST_DATABASE_URL },
    // next-auth must be transformed by vite rather than loaded straight by
    // Node, so the "next/server" alias above actually applies to it.
    server: { deps: { inline: [/next-auth/] } },
    // The extension resolves context per query; parallel files sharing one
    // Postgres schema would race on fixtures.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
