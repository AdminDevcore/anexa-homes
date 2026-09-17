#!/usr/bin/env node
/**
 * eslint error ratchet.
 *
 * `main` carries 47 pre-existing eslint ERRORS. Clearing them is not a CI
 * chore: 41 of the 53 originally measured are React Compiler rules
 * (react-hooks/static-components, set-state-in-effect, purity, refs) spread
 * across 20 components, and rewriting those is a behavioural change that wants
 * its own review — not a drive-by fix to make a new pipeline green.
 *
 * So this gate blocks NEW errors and lets the existing ones be paid down.
 * Whenever the count drops, lower BASELINE to match. That is the ratchet: it
 * can only tighten, never slacken.
 *
 * Warnings are not gated. There are ~1614, nearly all unused-vars, and failing
 * on them would turn this job into noise people learn to ignore — which is how
 * the repo ended up with no working gate in the first place.
 *
 *   node scripts/lint-ratchet.mjs eslint-report.json
 */
import { readFileSync } from "node:fs";

const BASELINE = 47;

const reportPath = process.argv[2];
if (!reportPath) {
  console.error("usage: node scripts/lint-ratchet.mjs <eslint-report.json>");
  process.exit(2);
}

const report = JSON.parse(readFileSync(reportPath, "utf8"));

const byRule = new Map();
let errors = 0;
for (const file of report) {
  for (const message of file.messages) {
    if (message.severity !== 2) continue;
    errors += 1;
    byRule.set(message.ruleId, (byRule.get(message.ruleId) ?? 0) + 1);
  }
}

console.log(`eslint errors: ${errors}   baseline: ${BASELINE}`);
for (const [rule, count] of [...byRule].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(3)}  ${rule}`);
}

if (errors > BASELINE) {
  console.error(
    `\nFAIL: ${errors - BASELINE} new eslint error(s) above the baseline of ${BASELINE}.`,
  );
  process.exit(1);
}

if (errors < BASELINE) {
  console.log(
    `\n${BASELINE - errors} error(s) fixed. Lower BASELINE in scripts/lint-ratchet.mjs to ${errors} to lock that in.`,
  );
}
