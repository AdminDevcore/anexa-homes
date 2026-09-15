import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * CI guard for the ROW-SCOPE boundary.
 *
 * The sibling guard in server-action-boundary.test.ts stops a caller from
 * DECLARING which tenant they are. This one stops a caller from picking which
 * ROW inside that tenant they act on.
 *
 * Every export of a `"use server"` module is a public RPC endpoint, so a
 * `leadId` parameter is whatever the browser typed. Two questions have to be
 * asked about it, and having asked one it is easy to believe you have asked
 * both:
 *
 *   can(user, "update", "Lead")   — may you edit deals AT ALL?      (the matrix)
 *   leadAccessible(user, leadId)  — may you edit THIS one?          (listScope)
 *
 * `sales_rep` and `canvasser` both hold `Lead:update`. An action that checks
 * only the first and then reads `{ id: leadId, companyId }` lets any rep write
 * any deal in the company. That was true of 32 exports across solar/ on
 * 2026-09-10 — design, pricing, lender and credit settings on somebody else's
 * customer — while `/portal/leads/<id>` correctly 404'd the same person.
 *
 * THE RULE. If an export's parameters or body name a `leadId`, `projectId` or
 * `documentId`, its body must reach a scoping helper: `listScope`,
 * `leadAccessible`, `projectAccessible`, or a local function in the same file
 * that itself reaches one (so the `guard()` / `ensureScope()` wrappers this
 * codebase already uses count).
 *
 * WHAT THIS DOES NOT CHECK. It reads source text. It proves the question is
 * asked, not that the answer is obeyed, and it cannot see a helper in another
 * module — `esign/actions.ts` delegates to `sendForSignature`, which scopes
 * properly one file over, and is listed below for exactly that reason.
 *
 * `proposalId` is deliberately NOT in the trigger list. Solar keys eight
 * actions off it and every one of them now resolves the parent lead through
 * `leadAccessible`, but adding it here would flag a long tail across the app
 * that has not been audited. Widening the list is the obvious next ratchet.
 */

const REPO_ROOT = join(__dirname, "..", "..", "..");
const SCAN_DIRS = ["src"];
const SCAN_EXT = [".ts", ".tsx"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".next-e2e", "dist", "build", "__tests__"]);

/** The parameters that name ONE ROW of customer data. */
const ROW_KEY = /\b(leadId|projectId|documentId)\b/;

/** Where a row-scope decision can legitimately come from. */
const SCOPE_ROOTS = ["listScope", "leadAccessible", "projectAccessible"];

/**
 * Reviewed exceptions: asking `leadAccessible` here would be the WRONG
 * question, not a skipped one. Each entry says why.
 */
const ALLOWED: Record<string, string> = {
  // ── THERE IS NO ROW YET ───────────────────────────────────────────────────
  "src/server/modules/leads/manage.ts#createLeadAction":
    "Creates the lead. Nothing to scope against until it exists.",
  "src/server/modules/canvassing/actions.ts#convertKnockToLeadAction":
    "Creates a lead from a knock; the knock is what gets authorised, by knockScope.",

  // ── SCOPED BY THE CANVASSING SYSTEM, NOT listScope ────────────────────────
  // Canvassing carries its own row-scope rules (knockScope + the explicit
  // `repId !== me.userId && !canManageAllCanvassing(role)` checks). Deliberately
  // NOT unified with listScope in this pass — see the divergence note in the
  // repo's rbac docs. These are scoped; they are just scoped elsewhere.
  "src/server/modules/canvassing/actions.ts#updateKnockAction": "Authorised against the knock, by knockScope.",
  "src/server/modules/canvassing/actions.ts#convertKnockToAppointmentAction": "Authorised against the knock.",
  "src/server/modules/canvassing/actions.ts#rescheduleAppointmentAction": "Authorised against the knock.",
  "src/server/modules/canvassing/actions.ts#cancelAppointmentAction":
    "Authorised against the knock, with an explicit repId/canManageAllCanvassing check.",

  // ── THE PERMISSION IS THE BOUNDARY (no rep can reach these at all) ────────
  // `update`/`approve Commission`, `Payroll` and `Bookkeeping` are held only by
  // super_admin, admin and accounting — roles whose listScope is the whole
  // company anyway, so the row check would be a no-op that reads like a control.
  "src/server/modules/bookkeeping/actions.ts#createTransactionAction":
    "Bookkeeping:create — accounting/owner only; projectId is a tag on a ledger row.",
  "src/server/modules/bookkeeping/actions.ts#updateTransactionAction":
    "Bookkeeping:update — accounting/owner only; projectId is a tag on a ledger row.",
  "src/server/modules/contractor-pay/actions.ts#generateContractorPayAction":
    "Takes no row id; ContractorInvoice:update is accounting/owner only.",
  "src/server/modules/costs/actions.ts#deleteProjectCostAction": "Commission:update — finance roles only.",
  "src/server/modules/costs/actions.ts#generateDealCommissionAction": "Commission:update — finance roles only.",
  "src/server/modules/costs/actions.ts#setDealAdjustmentAction": "Commission:update — finance roles only.",
  "src/server/modules/costs/actions.ts#setDealRepGetsAction": "Commission:update — finance roles only.",
  "src/server/modules/costs/actions.ts#setDealLeadProvidedAction": "Commission:update — finance roles only.",
  "src/server/modules/payroll/actions.ts#generateCommissionsAction": "Payroll — accounting/owner only.",
  "src/server/modules/payroll/actions.ts#approveCommissionAction": "Commission:approve — finance roles only.",
  "src/server/modules/payroll/ledger-actions.ts#addPayrollAdjustmentAction": "Payroll — accounting/owner only.",
  "src/server/modules/payroll/ledger-actions.ts#requestChargebackAction": "Payroll — accounting/owner only.",

  // ── COMPANY STATIONERY, NOT A CUSTOMER'S PAPERWORK ───────────────────────
  // `documentId` here is a PDF inside a DocumentTemplate — the blank contract
  // the company sends, owned by the company and scoped by ownedTemplate() /
  // ownedDocument(). No deal is involved.
  "src/server/modules/esign/actions.ts#saveTemplateFieldsAction": "Template stationery; ownedTemplate(companyId).",
  "src/server/modules/esign/actions.ts#uploadTemplatePdfAction": "Template stationery; ownedTemplate(companyId).",
  "src/server/modules/esign/actions.ts#addTemplateDocumentAction": "Template stationery; ownedTemplate(companyId).",
  "src/server/modules/esign/actions.ts#renameTemplateDocumentAction": "Template stationery; ownedDocument(companyId).",
  "src/server/modules/esign/actions.ts#deleteTemplateDocumentAction": "Template stationery; ownedDocument(companyId).",

  // ── SCOPED ONE FILE OVER (this guard cannot follow imports) ──────────────
  "src/server/modules/esign/actions.ts#sendDocumentAction":
    "Delegates to sendForSignature(), which applies listScope(user,'Lead') — esign/service.ts:131.",
  "src/server/modules/esign/actions.ts#sendDocumentsAction":
    "Delegates to sendForSignature(), which applies listScope(user,'Lead') — esign/service.ts:131.",
};

/**
 * Real gaps, audited on 2026-09-10 and deliberately NOT fixed in the solar
 * pass. This is DEBT, not permission: every one of these lets a role that can
 * reach the feature act on a row outside their own scope.
 *
 * It is a ratchet. The test below fails if the list grows, and fails if an
 * entry is fixed but left here — so the number can only go down, and nobody
 * can quietly add to it instead of scoping a new action.
 */
const KNOWN_GAPS: Record<string, string> = {
  "src/server/modules/canvassing/actions.ts#updateLeadPositionAction":
    "Moves an existing lead's map pin on companyId alone — any rep can move any pin.",
  "src/server/modules/costs/actions.ts#setProjectScheduleAction":
    "Also reachable with Project:update, which managers hold, so it escapes the finance-only reasoning above.",
  "src/server/modules/estimates/actions.ts#deleteEstimateLineAction":
    "Scoped to the estimate's leadId but not to the viewer's leads.",
  "src/server/modules/files/actions.ts#moveFileAction": "File perms are held by reps; companyId only.",
  "src/server/modules/files/actions.ts#deleteFileAction": "File perms are held by reps; companyId only.",
  "src/server/modules/projects/actions.ts#unassignCrewAction": "Project:update reaches any job in the company.",
  "src/server/modules/projects/actions.ts#setInstallerRoleAction": "Project:update reaches any job in the company.",
  "src/server/modules/projects/actions.ts#unassignInstallerAction": "Project:update reaches any job in the company.",
  "src/server/modules/proposals/actions.ts#updateProposalContentAction":
    "Roofing proposal, companyId only — the same shape solar just had.",
  "src/server/modules/proposals/actions.ts#generateProposalAction": "Roofing proposal, companyId only.",
  "src/server/modules/proposals/actions.ts#emailProposalAction": "Roofing proposal, companyId only.",
  "src/server/modules/proposals/actions.ts#selectPaymentOptionAction": "Roofing proposal, companyId only.",
  "src/server/modules/scope/actions.ts#deleteScopeLineAction":
    "The one export in this file that skips its own leadAccessible() helper.",
};

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SCAN_EXT.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

function isUseServerModule(src: string): boolean {
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) continue;
    return line === '"use server";' || line === "'use server';";
  }
  return false;
}

function matchAt(src: string, from: number, open: string, close: string): number {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return src.length;
}

/**
 * The `{` that opens a function BODY, stepping over a return type annotation.
 *
 * `): Promise<{ ok: true } | { ok: false }> {` puts two braces in front of the
 * one that matters. Skipping them is what makes this guard see inside a
 * wrapper like `ensureScope()` — with the naive "first brace after the
 * parens", ten already-scoped exports read as unscoped.
 */
function bodyStart(src: string, paramsEnd: number): number {
  let i = paramsEnd + 1;
  let angle = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "<") angle++;
    else if (c === ">" && angle > 0) angle--;
    else if (c === "{" && angle === 0) {
      let j = i - 1;
      while (j >= 0 && /\s/.test(src[j])) j--;
      const prev = src[j];
      // A type literal hangs off `:`, `|` or `&`; a body hangs off `)` or `>`.
      if (prev === ":" || prev === "|" || prev === "&") {
        i = matchAt(src, i, "{", "}") + 1;
        continue;
      }
      return i;
    }
    i++;
  }
  return -1;
}

type Fn = { name: string; params: string; body: string };

function functions(src: string, re: RegExp): Fn[] {
  const out: Fn[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const paramsEnd = matchAt(src, re.lastIndex - 1, "(", ")");
    const start = bodyStart(src, paramsEnd);
    if (start < 0) continue;
    out.push({
      name: m[1],
      params: src.slice(re.lastIndex, paramsEnd),
      body: src.slice(start, matchAt(src, start, "{", "}") + 1),
    });
  }
  return out;
}

const EXPORTED = () => /^export\s+(?:async\s+)?function\s+(\w+)\s*\(/gm;
const ANY_FN = () => /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g;

/** SCOPE_ROOTS plus any local wrapper that reaches one, to a fixpoint. */
function scopingSymbols(src: string): Set<string> {
  const symbols = new Set(SCOPE_ROOTS);
  for (let pass = 0; pass < 4; pass++) {
    const before = symbols.size;
    for (const fn of functions(src, ANY_FN())) {
      if ([...symbols].some((s) => fn.body.includes(`${s}(`))) symbols.add(fn.name);
    }
    if (symbols.size === before) break;
  }
  return symbols;
}

function repoPath(file: string): string {
  return relative(REPO_ROOT, file).split(sep).join("/");
}

describe("row-scope boundary", () => {
  const files = SCAN_DIRS.flatMap((d) => walk(join(REPO_ROOT, d)));
  const serverModules = files.filter((f) => isUseServerModule(readFileSync(f, "utf8")));

  /** Every deal-keyed export, split into scoped and unscoped. */
  const unscoped: string[] = [];
  let dealKeyed = 0;
  for (const file of serverModules) {
    const src = readFileSync(file, "utf8");
    const symbols = scopingSymbols(src);
    for (const fn of functions(src, EXPORTED())) {
      if (!ROW_KEY.test(fn.params + fn.body)) continue;
      dealKeyed++;
      if (![...symbols].some((s) => fn.body.includes(`${s}(`))) {
        unscoped.push(`${repoPath(file)}#${fn.name}`);
      }
    }
  }

  it("finds the server-action modules and their deal-keyed exports", () => {
    // If the detector broke, everything below would pass vacuously.
    expect(serverModules.length).toBeGreaterThan(30);
    expect(dealKeyed).toBeGreaterThan(80);
  });

  it("every deal-keyed server action resolves the row through the viewer's scope", () => {
    const offenders = unscoped.filter((e) => !(e in ALLOWED) && !(e in KNOWN_GAPS));

    expect(
      offenders,
      `These server actions act on a row the caller named, without asking whether\n` +
        `the caller may reach it. Add leadAccessible(user, leadId) — or if the id\n` +
        `cannot cross a scope boundary there, add an ALLOWED entry saying why:\n` +
        offenders.map((e) => `  • ${e}`).join("\n")
    ).toEqual([]);
  });

  it("the known-gap list only ever shrinks", () => {
    const stillOpen = new Set(unscoped);
    const fixed = Object.keys(KNOWN_GAPS).filter((e) => !stillOpen.has(e));

    expect(
      fixed,
      `These are scoped now. Delete them from KNOWN_GAPS so the list keeps meaning\n` +
        `something:\n` +
        fixed.map((e) => `  • ${e}`).join("\n")
    ).toEqual([]);
  });

  it("no exception names an export that no longer exists", () => {
    const live = new Set<string>();
    for (const file of serverModules) {
      const src = readFileSync(file, "utf8");
      for (const fn of functions(src, EXPORTED())) live.add(`${repoPath(file)}#${fn.name}`);
    }
    const stale = [...Object.keys(ALLOWED), ...Object.keys(KNOWN_GAPS)].filter((e) => !live.has(e));

    expect(
      stale,
      `ALLOWED / KNOWN_GAPS name exports that are gone. Delete these entries:\n` +
        stale.map((e) => `  • ${e}`).join("\n")
    ).toEqual([]);
  });
});
