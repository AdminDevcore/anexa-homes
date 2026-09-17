import { describe, it, expect } from "vitest";
import { parseStatement, detectFormat, toProviderTransactions } from "../import";

/**
 * STATEMENT PARSING, which is where an import quietly goes wrong.
 *
 * Every case below produces a plausible-looking row when it is handled badly:
 * a debit column read as positive inverts the P&L, a mis-read date files a
 * transaction in the wrong month (and possibly a closed period), and a dedupe
 * that is too eager silently deletes real money.
 *
 * Pure functions, so no database — the parser is worth testing on its own
 * before any of it reaches the queue.
 */

const ACCOUNT = "bank-account-1";

describe("CSV parsing", () => {
  it("reads a single signed amount column", () => {
    const { rows, errors } = parseStatement(
      ["Date,Description,Amount", "2026-06-15,HOME DEPOT #4821,-125.00", "2026-06-16,DEPOSIT,8400.00"].join("\n"),
      "csv"
    );
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0].amountCents).toBe(-125_00);
    expect(rows[1].amountCents).toBe(8_400_00);
  });

  it("NEGATES a separate debit column", () => {
    const { rows } = parseStatement(
      ["Date,Description,Debit,Credit", "06/15/2026,SUPPLIER,125.00,", "06/16/2026,CUSTOMER,,500.00"].join("\n"),
      "csv"
    );
    // The debit column is money OUT even though the file writes it positive.
    // Read literally, every expense becomes income and the P&L inverts.
    expect(rows[0].amountCents).toBe(-125_00);
    expect(rows[1].amountCents).toBe(500_00);
  });

  it("reads the accountants' parenthesised negative, and strips currency noise", () => {
    const { rows } = parseStatement(
      ["Date,Description,Amount", "2026-06-15,FEE,(45.00)", "2026-06-16,BIG ONE,\"$1,234.56\""].join("\n"),
      "csv"
    );
    expect(rows[0].amountCents).toBe(-45_00);
    expect(rows[1].amountCents).toBe(1_234_56);
  });

  it("handles quoted fields containing commas and quotes", () => {
    const { rows } = parseStatement(
      ['Date,Description,Amount', '2026-06-15,"SMITH, JONES & CO ""LTD""",-90.00'].join("\n"),
      "csv"
    );
    expect(rows[0].description).toBe('SMITH, JONES & CO "LTD"');
  });

  it("reads the date formats banks actually emit", () => {
    const { rows } = parseStatement(
      [
        "Date,Description,Amount",
        "2026-06-15,ISO,-1.00",
        "06/15/2026,US SLASH,-2.00",
        "6/5/26,TWO DIGIT YEAR,-3.00",
      ].join("\n"),
      "csv"
    );
    expect(rows[0].postedAt.toISOString().slice(0, 10)).toBe("2026-06-15");
    expect(rows[1].postedAt.toISOString().slice(0, 10)).toBe("2026-06-15");
    // Ambiguous DD/MM vs MM/DD is resolved US-style, which is stated in the
    // module rather than assumed silently.
    expect(rows[2].postedAt.toISOString().slice(0, 10)).toBe("2026-06-05");
  });

  it("reports a bad row and keeps the good ones", () => {
    const { rows, errors } = parseStatement(
      ["Date,Description,Amount", "not-a-date,BROKEN,-1.00", "2026-06-15,FINE,-2.00"].join("\n"),
      "csv"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe("FINE");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/row 2/i);
  });

  it("refuses a file with no amount column rather than importing nothing silently", () => {
    const { rows, errors } = parseStatement(["Date,Description", "2026-06-15,NOTHING"].join("\n"), "csv");
    expect(rows).toHaveLength(0);
    expect(errors[0]).toMatch(/no amount column/i);
  });
});

describe("OFX / QFX parsing", () => {
  const OFX = `
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260615120000<TRNAMT>-125.00<FITID>ABC123<NAME>HOME DEPOT</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260616<TRNAMT>8400.00<FITID>DEF456<NAME>DEPOSIT<CHECKNUM>1021</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

  it("reads amounts, dates and the bank's own id", () => {
    const { rows, errors } = parseStatement(OFX, "ofx");
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ amountCents: -125_00, fitId: "ABC123", description: "HOME DEPOT" });
    expect(rows[1]).toMatchObject({ amountCents: 8_400_00, fitId: "DEF456", checkNumber: "1021" });
    expect(rows[0].postedAt.toISOString().slice(0, 10)).toBe("2026-06-15");
  });

  it("detects the format from content or filename", () => {
    expect(detectFormat("export.txt", OFX)).toBe("ofx");
    expect(detectFormat("statement.qfx", "")).toBe("ofx");
    expect(detectFormat("statement.csv", "Date,Description,Amount")).toBe("csv");
  });
});

describe("transaction identity", () => {
  const csv = (rows: string[]) => parseStatement(["Date,Description,Amount", ...rows].join("\n"), "csv").rows;

  it("uses the bank's FITID when the file has one", () => {
    const { rows } = parseStatement(
      "<STMTTRN><DTPOSTED>20260615<TRNAMT>-10.00<FITID>XYZ789<NAME>SHOP</STMTTRN>",
      "ofx"
    );
    const [t] = toProviderTransactions(ACCOUNT, rows);
    expect(t.providerTransactionId).toBe("ofx:XYZ789");
  });

  it("KEEPS two genuinely identical transactions from one file", () => {
    const rows = csv(["2026-06-15,COFFEE SHOP,-4.50", "2026-06-15,COFFEE SHOP,-4.50"]);
    const ids = toProviderTransactions(ACCOUNT, rows).map((t) => t.providerTransactionId);

    /**
     * Two £4.50 coffees at the same shop on the same day hash identically.
     * Without the occurrence counter the second is dropped as a duplicate and
     * real money goes quietly missing from the books.
     */
    expect(ids[0]).not.toBe(ids[1]);
    expect(new Set(ids).size).toBe(2);
  });

  it("produces the SAME ids when the same file is imported twice", () => {
    const rows = csv([
      "2026-06-15,COFFEE SHOP,-4.50",
      "2026-06-15,COFFEE SHOP,-4.50",
      "2026-06-16,SUPPLIER,-200.00",
    ]);
    const first = toProviderTransactions(ACCOUNT, rows).map((t) => t.providerTransactionId);
    const second = toProviderTransactions(ACCOUNT, rows).map((t) => t.providerTransactionId);

    // Deterministic in file order, which is what makes a re-import collapse
    // onto the rows already present instead of doubling the statement.
    expect(second).toEqual(first);
  });

  it("gives different accounts different ids for the same-looking row", () => {
    const rows = csv(["2026-06-15,TRANSFER,-100.00"]);
    const a = toProviderTransactions("account-a", rows)[0].providerTransactionId;
    const b = toProviderTransactions("account-b", rows)[0].providerTransactionId;
    expect(a).not.toBe(b);
  });

  it("marks everything imported as settled", () => {
    const rows = csv(["2026-06-15,ANYTHING,-1.00"]);
    // A statement only contains transactions that have already posted, so
    // nothing imported is ever pending — and pending rows cannot post.
    expect(toProviderTransactions(ACCOUNT, rows)[0].pending).toBe(false);
  });
});
