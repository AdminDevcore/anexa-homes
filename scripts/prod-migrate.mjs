// Apply pending Prisma migrations as part of the PRODUCTION Vercel build.
//
// Why this exists: pushing to `main` auto-deploys, but migrations were manual,
// so every schema change opened a window — and on 2026-08-27 an indefinite one —
// where live code read tables the database did not have. A single missed
// migration (`20260827210000_automation_rules`) 500'd all of /portal/settings,
// because one `automationRule.count()` in the hub's inventory is awaited before
// the page renders. Code can no longer arrive ahead of its schema: the build
// migrates first, and a migration that fails fails the build, leaving the
// previous deployment serving.
//
// The one behaviour to keep in mind: the migration lands a few seconds BEFORE
// the new code goes live, so a DESTRUCTIVE migration (dropping a column the
// outgoing build still selects) can error for the length of that window. Ship
// destructive changes in two deploys — stop reading it, then drop it — exactly
// as you would with any zero-downtime rollout.

import { execFileSync } from "node:child_process";

const NPX = process.platform === "win32" ? "npx.cmd" : "npx";

// Previews and local `npm run build` must never touch the production database.
// VERCEL_ENV is "production" only for a deployment promoted to the production
// domain; branch and preview builds get "preview", and locally it is unset.
if (process.env.VERCEL_ENV !== "production") {
  console.log(
    `[prod-migrate] VERCEL_ENV=${process.env.VERCEL_ENV ?? "(unset)"} — not a production build, skipping migrations.`,
  );
  process.exit(0);
}

/**
 * The runtime DATABASE_URL is Supabase's TRANSACTION pooler (:6543,
 * `pgbouncer=true`), which cannot run migrations: Prisma needs session-level
 * advisory locks and prepared statements. The session pooler is the same host
 * on :5432 with no pooler parameters.
 *
 * This is built with the URL parser rather than by editing the string, and that
 * is the whole point of the function. Hand-editing has burned this project
 * before: removing `?pgbouncer=true` and `&connection_limit=1` piecemeal leaves
 * `/postgres&pool_timeout=20?sslmode=require`, which the pooler ACCEPTS as a
 * database named `postgres&pool_timeout=20` — `migrate deploy` then reports
 * success against a phantom database while the real one stays untouched.
 * Setting `.port` and replacing `.search` cannot produce that string.
 */
function migrateUrl() {
  // An explicit override wins, for the day the pooler topology changes.
  const explicit = process.env.MIGRATE_DATABASE_URL;
  if (explicit) return explicit;

  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set — cannot migrate.");

  const url = new URL(raw);
  if (url.port === "6543") url.port = "5432";
  url.search = "?sslmode=require";

  // A pooler URL with no database path is the phantom-database shape above.
  if (!url.pathname || url.pathname === "/") {
    throw new Error(`Refusing to migrate: no database in ${redact(url)}`);
  }
  return url.toString();
}

function redact(url) {
  const u = new URL(String(url));
  if (u.password) u.password = "***";
  return u.toString();
}

function prisma(args, env) {
  execFileSync(NPX, ["prisma", ...args], { stdio: "inherit", env });
}

const url = migrateUrl();
const env = { ...process.env, DATABASE_URL: url };

console.log(`[prod-migrate] applying migrations to ${redact(url)}`);
prisma(["migrate", "deploy"], env);

// "All migrations have been successfully applied" is not evidence — it is what
// the CLI printed while writing to a phantom database. `migrate status` exits
// non-zero while anything is unapplied, so this is the assertion that the
// deploy actually landed, and it is what fails the build if it did not.
prisma(["migrate", "status"], env);

console.log("[prod-migrate] database is up to date.");
