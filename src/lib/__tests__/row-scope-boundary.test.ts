import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * CI guard for the ROW-SCOPE boundary.
 *
 * A caller can pick which ROW inside their tenant they act on, and this stops
 * them. Its sibling — a guard against an action accepting the TENANT itself as
 * a parameter — does not exist yet, and that gap has already been real once:
 * `solar/storage.ts` exported reads taking `companyId`, which inside a
 * `"use server"` module hands the tenant boundary to the caller. That file was
 * deleted for unrelated reasons before this branch landed, so there is nothing
 * left to point at — which is exactly why the RULE is written down here rather
 * than left as an example. A caller-supplied company is not something a row
 * check can repair; the fix is to take the export off the RPC surface.
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
 * THE RULE. If an export's parameters or body name a `leadId`, `projectId`,
 * `documentId` or `proposalId`, its body must reach a scoping helper:
 * `listScope`, `leadAccessible`, `projectAccessible`, or a local function in
 * the same file that itself reaches one (so the `guard()` wrappers this
 * codebase already uses count).
 *
 * WHAT THIS DOES NOT CHECK. It reads source text. It proves the question is
 * asked, not that the answer is obeyed, and it cannot see a helper in another
 * module — `esign/actions.ts` delegates to `sendForSignature`, which scopes
 * properly one file over, and is listed below for exactly that reason.
 *
 * `proposalId` was added to the triggers on 2026-09-11 and surfaced nothing:
 * all twelve proposal-keyed exports already named `leadId` in their bodies,
 * because acting on a proposal means resolving the deal behind it. It is in the
 * list anyway — the guard should say what it means, not rely on a coincidence
 * of how these functions happen to be written today.
 */

const REPO_ROOT = join(__dirname, "..", "..", "..");
const SCAN_DIRS = ["src"];
const SCAN_EXT = [".ts", ".tsx"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".next-e2e", "dist", "build", "__tests__"]);

/** The parameters that name ONE ROW of customer data. */
const ROW_KEY = /\b(leadId|projectId|documentId|proposalId)\b/;

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

  // ── THE CUSTOMER'S OWN ACTION, NO SESSION TO SCOPE ───────────────────────
  "src/server/modules/solar/proposal-sign-action.ts#signSolarProposalAction":
    "The homeowner signing, authorised by the share token alone (acceptSolarProposal). " +
    "The proposalId it names is the row that token unlocked, handed back by the server " +
    "to file the signed PDF — never a value the caller supplies.",
  "src/server/modules/proposals/actions.ts#selectPaymentOptionAction":
    "The homeowner picking how they want to pay, resolved by publicToken under " +
    "runUnscoped. There is no `user` here — a staff scope check would break the " +
    "customer's own presentation, the same way it would on the solar sign and " +
    "qualify actions.",

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
  "src/server/modules/books/actions.ts#postManualEntryAction":
    "Bookkeeping:create — accounting/owner only. The projectId on a journal LINE is a " +
    "department/job tag on a ledger row, not a deal being edited: the entry posts to the " +
    "chart of accounts either way, and an unreachable projectId tags a line with a job the " +
    "poster cannot see rather than modifying that job. " +
    "IF `accountant_readonly` (Phase 3) IS EVER GRANTED Bookkeeping:create, this entry stops " +
    "being true — that role exists to change nothing, so it must hold read/export only.",
  "src/server/modules/books/ar-ap-actions.ts#createInvoiceAction":
    "Bookkeeping:create — accounting/owner only. The projectId says which JOB is being " +
    "billed, so the invoice lands in that job's department revenue; it is a tag on a " +
    "receivable, not a deal being edited. Reaching an invisible job would file revenue " +
    "against work the biller cannot see rather than modifying that work. Same reasoning, " +
    "and the same caveat, as postManualEntryAction above: if accountant_readonly is ever " +
    "granted Bookkeeping:create, this entry stops being true.",
  "src/server/modules/books/ar-ap-actions.ts#createBillAction":
    "Bookkeeping:create — accounting/owner only. The projectId is the optional job a COST " +
    "is attributed to, for job costing; the bill posts to the expense account either way.",
  "src/server/modules/books/ar-ap-actions.ts#syncExpectedFundingsAction":
    "Bookkeeping:create — accounting/owner only. Reads the deal's financing to work out " +
    "what the lender owes and writes the expected milestones. It creates no customer data " +
    "and changes nothing on the deal; a leadAccessible check here would gate a finance " +
    "role's own ledger against a sales scope that role does not have.",
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
    const offenders = unscoped.filter((e) => !(e in ALLOWED));

    expect(
      offenders,
      `These server actions act on a row the caller named, without asking whether\n` +
        `the caller may reach it. Add leadAccessible(user, leadId) — or if the id\n` +
        `cannot cross a scope boundary there, add an ALLOWED entry saying why:\n` +
        offenders.map((e) => `  • ${e}`).join("\n")
    ).toEqual([]);
  });

  it("no exception names an export that no longer exists", () => {
    const live = new Set<string>();
    for (const file of serverModules) {
      const src = readFileSync(file, "utf8");
      for (const fn of functions(src, EXPORTED())) live.add(`${repoPath(file)}#${fn.name}`);
    }
    const stale = Object.keys(ALLOWED).filter((e) => !live.has(e));

    expect(
      stale,
      `ALLOWED names exports that are gone. Delete these entries:\n` +
        stale.map((e) => `  • ${e}`).join("\n")
    ).toEqual([]);
  });
});
