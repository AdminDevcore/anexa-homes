import { describe, it, expect } from "vitest";
import {
  isStatementSlug,
  paramsFrom,
  requestQuery,
  resolveStatementRequest,
} from "../statement-request";

/**
 * ONE READING OF THE REQUEST.
 *
 * The screen, the CSV and the PDF each parse the same query string. If they
 * ever disagree, somebody downloads a P&L that is not the P&L they were looking
 * at — and nothing about the file would say so. These tests pin the two
 * properties that prevent it:
 *
 *   1. the two entry points (a plain searchParams object on the page, a
 *      URLSearchParams in the route handlers) resolve IDENTICALLY;
 *   2. `requestQuery` ROUND-TRIPS, so the download link on the page reproduces
 *      the request the page was rendered with.
 *
 * `now` is injected so these are not time-dependent — a test that passes in
 * January and fails in December is worse than no test.
 */

const NOW = new Date("2026-06-15T10:00:00Z");

describe("resolveStatementRequest", () => {
  it("reads a URLSearchParams and a searchParams object identically", () => {
    const qs = "period=custom&from=2026-01-01&to=2026-03-31&basis=cash&compare=prior_year&vertical=solar";

    const fromUrl = resolveStatementRequest("profit-and-loss", new URLSearchParams(qs), NOW);
    const fromPage = resolveStatementRequest(
      "profit-and-loss",
      paramsFrom({
        period: "custom",
        from: "2026-01-01",
        to: "2026-03-31",
        basis: "cash",
        compare: "prior_year",
        vertical: "solar",
      }),
      NOW
    );

    expect(fromPage).toEqual(fromUrl);
  });

  /** The property the CSV/PDF links depend on. */
  it("round-trips through requestQuery", () => {
    for (const qs of [
      "period=ytd&basis=accrual&compare=none",
      "period=custom&from=2026-02-01&to=2026-02-28&basis=cash&compare=prior_period&vertical=roofing",
      "period=all&basis=accrual&compare=none&vertical=others",
      "period=last_year&basis=cash&compare=prior_year",
    ]) {
      const first = resolveStatementRequest("profit-and-loss", new URLSearchParams(qs), NOW);
      const again = resolveStatementRequest(
        "profit-and-loss",
        new URLSearchParams(requestQuery(first)),
        NOW
      );
      expect(again, `round-trip failed for ${qs}`).toEqual(first);
    }
  });

  /**
   * The divergence that prompted normalising inside the resolver.
   *
   * A page's `searchParams` omits an unset key; `URLSearchParams.get` returns
   * "" for `?period=`. Before the fix these produced `preset: "ytd"` and
   * `preset: ""` for the SAME url — and preset feeds `requestQuery`, so the
   * CSV link stopped describing the page it was on. Every enum happened to
   * survive it, which is exactly why it would have gone unnoticed.
   */
  it("treats an empty parameter as an absent one, from either entry point", () => {
    const fromUrl = resolveStatementRequest(
      "profit-and-loss",
      new URLSearchParams("period=&basis=&compare=&vertical=&account="),
      NOW
    );
    const fromPage = resolveStatementRequest("profit-and-loss", paramsFrom({}), NOW);

    expect(fromUrl).toEqual(fromPage);
    expect(fromUrl.preset).toBe("ytd");
    expect(fromUrl.accountId).toBeNull();
  });

  it("defaults to an accrual year-to-date with no comparison", () => {
    const r = resolveStatementRequest("profit-and-loss", new URLSearchParams(""), NOW);
    expect(r.basis).toBe("accrual");
    expect(r.comparison).toBe("none");
    expect(r.vertical).toBeNull();
    expect(r.preset).toBe("ytd");
    expect(r.period.startMs).toBe(Date.UTC(2026, 0, 1));
  });

  /** Anything unrecognised falls back rather than reaching a query. */
  it("refuses junk in every enum", () => {
    const r = resolveStatementRequest(
      "profit-and-loss",
      new URLSearchParams("basis=whatever&compare=sideways&vertical=plumbing"),
      NOW
    );
    expect(r.basis).toBe("accrual");
    expect(r.comparison).toBe("none");
    expect(r.vertical).toBeNull();
  });

  /**
   * "All time" is the case `reports/period.ts` cannot express — its Period has
   * non-null Dates, so an unbounded window has to be faked as a date far in the
   * past. The books need genuine nulls: a balance sheet has no lower bound.
   */
  it("expresses all-time as two open bounds", () => {
    const r = resolveStatementRequest("balance-sheet", new URLSearchParams("period=all"), NOW);
    expect(r.period.startMs).toBeNull();
    expect(r.period.endMs).toBeNull();
  });

  /**
   * A half-filled custom range is a form in progress, not a request. Reporting
   * some other window for it would put confident numbers on screen under a
   * heading nobody chose.
   */
  it("does not invent a window from a half-filled custom range", () => {
    const r = resolveStatementRequest(
      "profit-and-loss",
      new URLSearchParams("period=custom&from=2026-02-01"),
      NOW
    );
    expect(r.period.startMs).toBe(Date.UTC(2026, 0, 1)); // fell back to YTD
    expect(r.periodLabel).toBe("Year to date");
  });

  it("takes the snapshot at the end of the window, so a balance sheet agrees with the period", () => {
    const r = resolveStatementRequest(
      "balance-sheet",
      new URLSearchParams("period=last_year"),
      NOW
    );
    expect(r.asOf.getTime()).toBe(Date.UTC(2025, 11, 31, 23, 59, 59, 999));
  });

  it("carries the general ledger's account through", () => {
    const r = resolveStatementRequest(
      "general-ledger",
      new URLSearchParams("account=acc-42"),
      NOW
    );
    expect(r.accountId).toBe("acc-42");
    expect(requestQuery(r)).toContain("account=acc-42");
  });
});

describe("isStatementSlug", () => {
  it("accepts the four statements and nothing else", () => {
    for (const s of ["trial-balance", "profit-and-loss", "balance-sheet", "general-ledger"]) {
      expect(isStatementSlug(s)).toBe(true);
    }
    for (const s of ["", "payroll", "../../etc/passwd", "Trial-Balance"]) {
      expect(isStatementSlug(s)).toBe(false);
    }
  });
});
