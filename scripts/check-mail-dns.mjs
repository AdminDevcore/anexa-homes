#!/usr/bin/env node
// Mail-deliverability DNS check for the sending domain.
//
// Why this exists: team notifications were silently "Suppressed" by Resend
// because the ROOT domain's MX records pointed at an Amazon SES bounce/feedback
// host (`feedback-smtp.*.amazonses.com`) instead of (only) the real inbound
// mail host. Mail to @anexahomes.com hard-bounced → Resend suppressed those
// addresses → nothing ever got delivered to them.
//
// Run after changing DNS to confirm the fix took:
//   node scripts/check-mail-dns.mjs                 (defaults to anexahomes.com)
//   node scripts/check-mail-dns.mjs example.com
//
// Exit code 0 = healthy, 1 = problem found. No dependencies, no env needed.

import { resolveMx, resolveTxt } from "node:dns/promises";

const domain = process.argv[2] || "anexahomes.com";
const C = { red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", dim: "\x1b[2m", reset: "\x1b[0m", bold: "\x1b[1m" };
const ok = (m) => console.log(`${C.green}✓${C.reset} ${m}`);
const bad = (m) => console.log(`${C.red}✗${C.reset} ${m}`);
const warn = (m) => console.log(`${C.yellow}!${C.reset} ${m}`);

// A host is "inbound mail" if it actually accepts mail for real mailboxes.
const GOOGLE_INBOUND = /(^|\.)aspmx\.l\.google\.com$|(^|\.)googlemail\.com$|^smtp\.google\.com$/i;
// SES bounce/feedback hosts belong on a `send.` MAIL-FROM subdomain, NEVER on
// the root domain's MX. Their presence on the root is the bug we hunt for.
const SES_FEEDBACK = /feedback-smtp\..*\.amazonses\.com$/i;

let problems = 0;

async function main() {
  console.log(`\n${C.bold}Mail DNS check — ${domain}${C.reset}\n`);

  // --- Root MX: where INBOUND mail to this domain is delivered ----------------
  let mx = [];
  try {
    mx = await resolveMx(domain);
  } catch {
    bad(`No MX records on ${domain} — the domain cannot receive mail at all.`);
    problems++;
  }
  mx.sort((a, b) => a.priority - b.priority);

  if (mx.length) {
    console.log(`${C.dim}Root MX records:${C.reset}`);
    for (const r of mx) console.log(`  ${String(r.priority).padStart(3)}  ${r.exchange}`);
    console.log();
  }

  const sesOnRoot = mx.filter((r) => SES_FEEDBACK.test(r.exchange));
  const inbound = mx.filter((r) => GOOGLE_INBOUND.test(r.exchange));

  if (sesOnRoot.length) {
    bad(`SES bounce/feedback host on the ROOT MX: ${sesOnRoot.map((r) => r.exchange).join(", ")}`);
    console.log(`     ${C.dim}This rejects inbound mail → hard bounce → Resend suppression.`);
    console.log(`     Remove it from the root domain. It belongs only on send.${domain}.${C.reset}`);
    problems++;
  } else {
    ok("No SES feedback host polluting the root MX.");
  }

  if (inbound.length) {
    ok(`Real inbound mail host present: ${inbound.map((r) => r.exchange).join(", ")}`);
    // Mixed priorities with a bad host already flagged above; warn on ties.
    const topPriority = mx[0]?.priority;
    const tiedNonInbound = mx.filter((r) => r.priority === topPriority && !GOOGLE_INBOUND.test(r.exchange));
    if (tiedNonInbound.length) {
      warn(`Another host shares the top priority (${topPriority}) with your inbound host — mail is split between them.`);
    }
  } else if (mx.length) {
    bad("No recognized inbound mail host (expected aspmx.l.google.com or smtp.google.com).");
    problems++;
  }

  // --- SPF: outbound authorization -------------------------------------------
  let txt = [];
  try {
    txt = (await resolveTxt(domain)).map((parts) => parts.join(""));
  } catch { /* ignore */ }
  const spf = txt.find((t) => /^v=spf1/i.test(t));
  if (spf) {
    ok(`SPF present: ${spf}`);
    if (!/amazonses\.com/i.test(spf)) warn("SPF does not include amazonses.com (Resend sends via SES).");
  } else {
    warn("No SPF (v=spf1) record on the root — add one for cleaner outbound auth/reputation.");
    console.log(`     ${C.dim}Suggested: v=spf1 include:amazonses.com include:_spf.google.com ~all${C.reset}`);
  }

  // --- Resend DKIM ------------------------------------------------------------
  try {
    const dkim = await resolveTxt(`resend._domainkey.${domain}`);
    if (dkim.flat().join("").includes("p=")) ok("Resend DKIM key found (resend._domainkey).");
  } catch {
    warn("No resend._domainkey DKIM record found — Resend sending domain may be unverified.");
  }

  console.log();
  if (problems === 0) {
    console.log(`${C.green}${C.bold}PASS${C.reset} — mail routing looks correct. Now remove the affected`);
    console.log(`addresses from the Resend suppression list (dashboard), then re-send.\n`);
    process.exit(0);
  } else {
    console.log(`${C.red}${C.bold}FAIL${C.reset} — ${problems} problem(s) above. Fix DNS first; clearing the`);
    console.log(`Resend suppression list before this passes will not stick (it re-suppresses).\n`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
