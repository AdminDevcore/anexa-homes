import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

const require = createRequire(import.meta.url);

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      /**
       * next-auth's lib/env.js imports "next/server". `next` ships no `exports`
       * map, so Node's CJS resolution finds server.js while vite's stricter ESM
       * resolver refuses to add the extension, and any test that transitively
       * touches the session helpers dies on import. Kept identical to
       * vitest.integration.config.ts so a test behaves the same in both suites.
       */
      "next/server": require.resolve("next/server"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // next-auth must be transformed by vite rather than loaded straight by
    // Node, so the alias above actually applies to it.
    server: { deps: { inline: [/next-auth/] } },
  },
});
