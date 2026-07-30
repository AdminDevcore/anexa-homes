import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Playwright builds the app into its own dist dir (playwright.config.ts sets
    // NEXT_DIST_DIR). Same generated output as .next — never lint it.
    ".next-e2e/**",
  ]),
  // ---------------------------------------------------------------------
  // Vertical isolation guard: raw SQL bypasses the Prisma client extension
  // that injects `vertical` into every read/write (see src/server/vertical/).
  // A raw query on a vertical-scoped table would silently cross workspaces.
  // Use the scoped Prisma client, or `rawUnscoped()` for a reviewed exception.
  // The companion test `src/lib/__tests__/no-raw-sql.test.ts` is the CI backstop
  // (it also covers scripts/ and prisma/, which eslint does not lint).
  // ---------------------------------------------------------------------
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[property.name=/^\\$(query|execute)Raw(Unsafe)?$/]",
          message:
            "Raw SQL bypasses vertical scoping. Use the scoped Prisma client, or wrap a reviewed exception in rawUnscoped() from @/server/vertical/context.",
        },
      ],
    },
  },
  {
    // MUST come after the rule above — in flat config, later blocks win.
    //
    // The isolation suite resets its own throwaway Postgres schema and must use
    // the UNextended client to build cross-vertical fixtures — the very thing it
    // then proves is unreachable. Mirrored in no-raw-sql.test.ts's allowlist.
    files: ["src/server/vertical/__tests__/*.itest.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
]);

export default eslintConfig;
