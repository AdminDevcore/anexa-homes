import { describe, it, expect } from "vitest";
import type { BankRule } from "@prisma/client";
import { ruleMatches, firstMatch, type MatchableRow } from "../rules";

/**
 * RULE MATCHING, tested exhaustively and without a database.
 *
 * This predicate decides what an unattended rule does to the books, so the
 * mistakes worth hunting are the ones that still look like a working rule:
 *
 *   • a "SHELL" expense rule catching a REFUND from Shell, booking money coming
 *     back as money going out;
 *   • amount bounds compared against a negative number, so "under $50" matches
 *     nothing or everything;
 *   • a rule pinned to one account reaching into another;
 *   • two rules of equal priority applying in whatever order the database
 *     happened to return, so the same row categorises differently between runs
 *     and neither result looks wrong.
 */

const base: BankRule = {
  id: "rule-1",
  companyId: "co-1",
  name: "Fuel",
  enabled: true,
  priority: 100,
  bankAccountId: null,
  direction: "any",
  matchText: null,
  matchType: "contains",
  minAmountCents: null,
  maxAmountCents: null,
  accountId: "acct-fuel",
  vertical: null,
  vendorId: null,
  memo: null,
  autoPost: false,
  timesApplied: 0,
  lastAppliedAt: null,
  createdById: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const rule = (patch: Partial<BankRule>): BankRule => ({ ...base, ...patch });

const row = (patch: Partial<MatchableRow>): MatchableRow => ({
  amountCents: -64_20,
  description: "SHELL OIL 574",
  merchantName: "Shell",
  bankAccountId: "bank-1",
  ...patch,
});

describe("ruleMatches", () => {
  it("a disabled rule never matches", () => {
    expect(ruleMatches(rule({ enabled: false, matchText: "SHELL" }), row({}))).toBe(false);
  });

  it("matches on description or merchant name, case-insensitively", () => {
    expect(ruleMatches(rule({ matchText: "shell oil" }), row({}))).toBe(true);
    // The useful name lives in either field depending on the institution.
    expect(
      ruleMatches(rule({ matchText: "shell" }), row({ description: "POS PURCHASE 4821" }))
    ).toBe(true);
    expect(ruleMatches(rule({ matchText: "texaco" }), row({}))).toBe(false);
  });

  it("honours the match type", () => {
    expect(ruleMatches(rule({ matchText: "shell", matchType: "starts_with" }), row({}))).toBe(true);
    expect(ruleMatches(rule({ matchText: "oil", matchType: "starts_with" }), row({}))).toBe(false);
    expect(
      ruleMatches(rule({ matchText: "shell oil 574", matchType: "equals" }), row({}))
    ).toBe(true);

    /**
     * `equals` is satisfied by EITHER field, so "shell" matches this row because
     * the merchant name is exactly "Shell" even though the description is not.
     *
     * That is deliberate — a bookkeeper writing a rule does not know which field
     * their bank populated, and demanding they guess would make `equals`
     * unusable. It is asserted here because it reads like a bug otherwise: the
     * first version of this test expected false.
     */
    expect(ruleMatches(rule({ matchText: "shell", matchType: "equals" }), row({}))).toBe(true);
    expect(
      ruleMatches(rule({ matchText: "shell", matchType: "equals" }), row({ merchantName: "Shell Oil" }))
    ).toBe(false);
    expect(ruleMatches(rule({ matchText: "shel", matchType: "equals" }), row({}))).toBe(false);
  });

  it("a money_out rule does NOT catch a refund from the same merchant", () => {
    const fuel = rule({ matchText: "shell", direction: "money_out" });
    expect(ruleMatches(fuel, row({ amountCents: -64_20 }))).toBe(true);

    /**
     * The trap. Without the sign check, a refund of £64.20 from Shell matches
     * the fuel rule and is booked as fuel EXPENSE — so a credit increases costs,
     * the entry balances, and the P&L is wrong in a way nothing flags.
     */
    expect(ruleMatches(fuel, row({ amountCents: 64_20 }))).toBe(false);
  });

  it("a money_in rule only catches money arriving", () => {
    const deposits = rule({ direction: "money_in", matchText: "deposit" });
    expect(ruleMatches(deposits, row({ amountCents: 8_400_00, description: "DEPOSIT" }))).toBe(true);
    expect(ruleMatches(deposits, row({ amountCents: -8_400_00, description: "DEPOSIT" }))).toBe(false);
  });

  it("`any` catches both directions", () => {
    const both = rule({ direction: "any", matchText: "shell" });
    expect(ruleMatches(both, row({ amountCents: -1 }))).toBe(true);
    expect(ruleMatches(both, row({ amountCents: 1 }))).toBe(true);
  });

  it("bounds are compared against the ABSOLUTE amount", () => {
    const small = rule({ maxAmountCents: 100_00, direction: "money_out" });

    // "under $100" must mean what a person means by it. Compared against the
    // signed value, every expense is below every bound and the rule catches
    // everything.
    expect(ruleMatches(small, row({ amountCents: -64_20 }))).toBe(true);
    expect(ruleMatches(small, row({ amountCents: -640_20 }))).toBe(false);

    const large = rule({ minAmountCents: 500_00, direction: "money_out" });
    expect(ruleMatches(large, row({ amountCents: -640_20 }))).toBe(true);
    expect(ruleMatches(large, row({ amountCents: -64_20 }))).toBe(false);
  });

  it("a rule pinned to one account does not reach into another", () => {
    const pinned = rule({ bankAccountId: "bank-1", matchText: "shell" });
    expect(ruleMatches(pinned, row({ bankAccountId: "bank-1" }))).toBe(true);
    expect(ruleMatches(pinned, row({ bankAccountId: "bank-2" }))).toBe(false);
    // Unpinned reaches everywhere, which is the documented default.
    expect(ruleMatches(rule({ matchText: "shell" }), row({ bankAccountId: "bank-2" }))).toBe(true);
  });

  it("a rule with no text matches on its other conditions alone", () => {
    const anyCard = rule({ bankAccountId: "bank-1", direction: "money_out" });
    expect(ruleMatches(anyCard, row({ description: "ANYTHING AT ALL" }))).toBe(true);
    // Whitespace is not a filter.
    expect(ruleMatches(rule({ matchText: "   " }), row({}))).toBe(true);
  });

  it("tolerates a row with no merchant name", () => {
    expect(ruleMatches(rule({ matchText: "shell" }), row({ merchantName: null }))).toBe(true);
    expect(
      ruleMatches(rule({ matchText: "shell" }), row({ merchantName: null, description: "X" }))
    ).toBe(false);
  });
});

describe("firstMatch", () => {
  it("takes the first rule in the list, which is the caller's ordering", () => {
    const specific = rule({ id: "specific", priority: 10, matchText: "shell oil", accountId: "acct-fuel" });
    const general = rule({ id: "general", priority: 50, matchText: "shell", accountId: "acct-misc" });

    // `activeRules` orders by priority, then createdAt, then id — a TOTAL order.
    // With priority alone, these two could swap between runs and the same row
    // would land in a different account each time, both looking correct.
    expect(firstMatch([specific, general], row({}))?.id).toBe("specific");
    expect(firstMatch([general, specific], row({}))?.id).toBe("general");
  });

  it("returns null when nothing applies", () => {
    expect(firstMatch([rule({ matchText: "texaco" })], row({}))).toBeNull();
  });

  it("skips a disabled rule and falls through to the next", () => {
    const off = rule({ id: "off", enabled: false, matchText: "shell" });
    const on = rule({ id: "on", matchText: "shell" });
    expect(firstMatch([off, on], row({}))?.id).toBe("on");
  });
});
