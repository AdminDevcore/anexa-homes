import type { BankRule, BankFeedTransaction } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { acceptFeedTransaction } from "./review";
import type { PostingActor } from "@/server/modules/books/posting";

/**
 * BANK RULES: a bookkeeper's standing instructions.
 *
 * Two hundred identical fuel receipts a month is not a judgement two hundred
 * times; it is one judgement applied two hundred times. A rule records that
 * judgement once.
 *
 * ── SUGGEST BY DEFAULT, POST ONLY IF ASKED ──────────────────────────────────
 * A matching rule normally fills the category in and waits. `autoPost` makes it
 * post unattended, and it is off unless explicitly enabled, because a wrong
 * rule that suggests is a wrong suggestion, while a wrong rule that posts has
 * already written to the books — and undoing it means a reversing entry for
 * every row it touched. The blast radius of the two is not comparable.
 *
 * ── SUGGESTIONS ARE COMPUTED, NEVER STORED ──────────────────────────────────
 * There is deliberately no `suggestedRuleId` column. A stored suggestion is a
 * copy that goes stale the moment a rule is edited, and the queue would then
 * show a category no rule would produce any more. Matching is cheap; the
 * correct answer is always the one derived now.
 *
 * ── FIRST MATCH WINS, AND THE ORDER IS TOTAL ────────────────────────────────
 * Rules are ordered by `priority`, then `createdAt`, then `id`. The last two
 * matter: with priority alone, two rules of equal priority would apply in
 * whatever order the database returned them, so the same row could categorise
 * differently between runs and nothing would look wrong either time.
 */

/** The row fields a rule can see. Narrow on purpose — a rule matches facts. */
export type MatchableRow = Pick<
  BankFeedTransaction,
  "amountCents" | "description" | "merchantName" | "bankAccountId"
>;

/**
 * Does this rule apply to this row?
 *
 * Pure, and exported, so the matching semantics can be tested exhaustively
 * without a database — which is where the interesting mistakes are.
 */
export function ruleMatches(rule: BankRule, row: MatchableRow): boolean {
  if (!rule.enabled) return false;

  // A rule pinned to one account must not reach into another.
  if (rule.bankAccountId && rule.bankAccountId !== row.bankAccountId) return false;

  /**
   * Direction is matched on the SIGN, which is what stops a rule for "SHELL"
   * catching a refund FROM Shell and booking a credit as fuel expense.
   */
  if (rule.direction === "money_out" && row.amountCents >= 0) return false;
  if (rule.direction === "money_in" && row.amountCents <= 0) return false;

  // Bounds are on the ABSOLUTE amount, so a rule reads the way a person says
  // it: "fuel under fifty pounds", not "fuel above minus fifty".
  const magnitude = Math.abs(row.amountCents);
  if (rule.minAmountCents !== null && magnitude < rule.minAmountCents) return false;
  if (rule.maxAmountCents !== null && magnitude > rule.maxAmountCents) return false;

  if (rule.matchText && rule.matchText.trim()) {
    const needle = rule.matchText.trim().toLowerCase();
    // Both fields, because banks put the useful name in either one depending on
    // the institution and sometimes on the transaction.
    const haystacks = [row.description, row.merchantName ?? ""].map((s) => s.toLowerCase());
    const hit = haystacks.some((h) => {
      if (rule.matchType === "equals") return h === needle;
      if (rule.matchType === "starts_with") return h.startsWith(needle);
      return h.includes(needle);
    });
    if (!hit) return false;
  }

  return true;
}

/** Enabled rules in the order they must be considered. */
export async function activeRules(companyId: string): Promise<BankRule[]> {
  return prisma.bankRule.findMany({
    where: { companyId, enabled: true },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
}

/** The first rule that applies, or null. */
export function firstMatch(rules: BankRule[], row: MatchableRow): BankRule | null {
  return rules.find((r) => ruleMatches(r, row)) ?? null;
}

export type RuleSuggestion = {
  feedTransactionId: string;
  ruleId: string;
  ruleName: string;
  accountId: string;
  vertical: BankRule["vertical"];
  vendorId: string | null;
  memo: string | null;
  autoPost: boolean;
};

/**
 * What the rules would say about everything currently in the queue.
 *
 * Read-only: this is what the review screen shows beside each row. It posts
 * nothing, which is why it is safe to call on every render.
 */
export async function suggestionsForQueue(
  companyId: string,
  limit = 200
): Promise<RuleSuggestion[]> {
  const [rules, rows] = await Promise.all([
    activeRules(companyId),
    prisma.bankFeedTransaction.findMany({
      where: { companyId, status: "review" },
      orderBy: { postedAt: "desc" },
      take: limit,
      select: {
        id: true,
        amountCents: true,
        description: true,
        merchantName: true,
        bankAccountId: true,
      },
    }),
  ]);
  if (rules.length === 0) return [];

  const out: RuleSuggestion[] = [];
  for (const row of rows) {
    const rule = firstMatch(rules, row);
    if (!rule) continue;
    out.push({
      feedTransactionId: row.id,
      ruleId: rule.id,
      ruleName: rule.name,
      accountId: rule.accountId,
      vertical: rule.vertical,
      vendorId: rule.vendorId,
      memo: rule.memo,
      autoPost: rule.autoPost,
    });
  }
  return out;
}

export type AutoPostResult = {
  considered: number;
  posted: number;
  skipped: number;
  errors: { feedTransactionId: string; error: string }[];
};

/**
 * Post the rows an `autoPost` rule claims, and leave everything else alone.
 *
 * Runs after a sync. A row whose rule fails to post is reported and LEFT IN THE
 * QUEUE rather than marked in any way — the person still has to deal with it,
 * and silently swallowing the failure would make it look handled.
 *
 * Pending rows are never posted: `acceptFeedTransaction` refuses them, which is
 * the single place that rule lives.
 */
export async function applyAutoPostRules(args: {
  companyId: string;
  actor: PostingActor;
  limit?: number;
}): Promise<AutoPostResult> {
  const result: AutoPostResult = { considered: 0, posted: 0, skipped: 0, errors: [] };

  const rules = (await activeRules(args.companyId)).filter((r) => r.autoPost);
  if (rules.length === 0) return result;

  const rows = await prisma.bankFeedTransaction.findMany({
    where: { companyId: args.companyId, status: "review", pending: false },
    orderBy: { postedAt: "asc" },
    take: args.limit ?? 200,
    select: {
      id: true,
      amountCents: true,
      description: true,
      merchantName: true,
      bankAccountId: true,
    },
  });

  for (const row of rows) {
    result.considered += 1;
    const rule = firstMatch(rules, row);
    if (!rule) {
      result.skipped += 1;
      continue;
    }

    const res = await acceptFeedTransaction({
      companyId: args.companyId,
      feedTransactionId: row.id,
      memo: rule.memo,
      actor: args.actor,
      lines: [
        {
          accountId: rule.accountId,
          // The whole amount: a rule categorises a transaction, it does not
          // split one. A split is a judgement about this row in particular,
          // which is exactly what a standing instruction cannot make.
          amountCents: Math.abs(row.amountCents),
          vertical: rule.vertical,
          vendorId: rule.vendorId,
          memo: rule.memo,
        },
      ],
    });

    if (!res.ok) {
      result.errors.push({ feedTransactionId: row.id, error: res.error });
      continue;
    }

    result.posted += 1;
    // Counted so a rule that matches nothing — or everything — is visible in
    // the UI rather than merely suspected.
    await prisma.bankRule.update({
      where: { id: rule.id },
      data: { timesApplied: { increment: 1 }, lastAppliedAt: new Date() },
    });
  }

  return result;
}
