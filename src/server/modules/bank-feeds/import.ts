import { createHash } from "node:crypto";
import { prisma } from "@/server/db/client";
import type { ProviderTransaction } from "./types";

/**
 * FILE IMPORT: the same queue, reached without a bank connection.
 *
 * Not every institution is on Plaid, not every owner wants to connect one, and
 * a year of history often arrives as a download. Imported rows land in exactly
 * the same review queue as fed ones and post through exactly the same door, so
 * there is no second, weaker path into the books.
 *
 * ── THE DEDUPE PROBLEM, STATED HONESTLY ─────────────────────────────────────
 * A feed row carries the provider's own transaction id, which makes dedupe
 * exact. A file usually does not.
 *
 *   • OFX/QFX carry `FITID`, the bank's own id. Used verbatim when present, and
 *     dedupe is then as exact as a live feed.
 *   • CSV carries nothing. The id is DERIVED — a hash of account, date, amount
 *     and description, plus an occurrence counter for rows identical within the
 *     same file.
 *
 * The counter matters: two genuine £4.50 coffees at the same shop on the same
 * day hash identically, and without it the second would be silently dropped as
 * a duplicate — real money quietly missing from the books. With it, they import
 * as two rows, and re-importing the same file still collapses correctly because
 * the counter is deterministic in file order.
 *
 * What this cannot survive is the same transactions arriving in a DIFFERENT
 * file with a different row order or description spelling. Those import as
 * duplicates and a person has to exclude them. That is the honest limit of
 * importing a file with no ids in it, and it is why a connected feed is
 * preferred where one exists.
 */

export type ImportFormat = "csv" | "ofx";

export type ImportResult = {
  parsed: number;
  imported: number;
  /** Already present — the ordinary result of re-importing an overlapping file. */
  duplicates: number;
  errors: string[];
};

/** A parsed row before it is given an identity. */
type ParsedRow = {
  postedAt: Date;
  amountCents: number;
  description: string;
  fitId: string | null;
  checkNumber: string | null;
};

// ── Parsing ────────────────────────────────────────────────────────────────

/** Split one CSV line, honouring quotes and doubled quotes inside them. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(field);
      field = "";
    } else field += ch;
  }
  out.push(field);
  return out.map((f) => f.trim());
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** Money as banks write it: "1,234.56", "(45.00)" for negative, "$12.00", "-3". */
function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[$\s,]/g, "");
  if (!cleaned) return null;
  const negated = /^\(.*\)$/.test(cleaned);
  const body = negated ? cleaned.slice(1, -1) : cleaned;
  const value = Number.parseFloat(body);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) * (negated ? -1 : 1);
}

/**
 * Dates as banks write them. Ambiguous DD/MM vs MM/DD is resolved as US format,
 * because that is where this company operates — stated here rather than assumed
 * silently, since it is wrong for most of the world.
 */
function parseDate(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3], 12));

  const ofx = /^(\d{4})(\d{2})(\d{2})/.exec(s);
  if (ofx && s.length >= 8 && !s.includes("/")) {
    return new Date(Date.UTC(+ofx[1], +ofx[2] - 1, +ofx[3], 12));
  }

  const slash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(s);
  if (slash) {
    const year = +slash[3] < 100 ? 2000 + +slash[3] : +slash[3];
    return new Date(Date.UTC(year, +slash[1] - 1, +slash[2], 12));
  }

  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseCsv(text: string): { rows: ParsedRow[]; errors: string[] } {
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { rows: [], errors: ["The file has no data rows."] };

  const header = splitCsvLine(lines[0]).map(norm);
  const find = (...names: string[]) => header.findIndex((h) => names.includes(h));

  const dateAt = find("date", "transactiondate", "posteddate", "postingdate");
  const descAt = find("description", "name", "memo", "payee", "details");
  const amountAt = find("amount", "transactionamount");
  const debitAt = find("debit", "withdrawal", "withdrawals", "moneyout");
  const creditAt = find("credit", "deposit", "deposits", "moneyin");
  const checkAt = find("checknumber", "checkno", "check");

  if (dateAt < 0) return { rows: [], errors: ["No date column found."] };
  if (descAt < 0) return { rows: [], errors: ["No description column found."] };
  if (amountAt < 0 && debitAt < 0 && creditAt < 0) {
    return { rows: [], errors: ["No amount column found."] };
  }

  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]);
    const postedAt = parseDate(cells[dateAt] ?? "");
    if (!postedAt) {
      errors.push(`Row ${i + 1}: could not read the date.`);
      continue;
    }

    /**
     * Separate debit and credit columns are the other common shape. A debit is
     * money OUT, so it is negated to match our sign convention — the same rule
     * the Plaid adapter applies, and the same one that inverts a whole P&L if
     * it is reversed.
     */
    let amountCents: number | null = null;
    if (amountAt >= 0) {
      amountCents = parseAmount(cells[amountAt] ?? "");
    } else {
      const debit = debitAt >= 0 ? parseAmount(cells[debitAt] ?? "") : null;
      const credit = creditAt >= 0 ? parseAmount(cells[creditAt] ?? "") : null;
      if (debit) amountCents = -Math.abs(debit);
      else if (credit) amountCents = Math.abs(credit);
    }
    if (amountCents === null) {
      errors.push(`Row ${i + 1}: could not read the amount.`);
      continue;
    }
    if (amountCents === 0) continue;

    rows.push({
      postedAt,
      amountCents,
      description: (cells[descAt] ?? "").trim() || "(no description)",
      fitId: null,
      checkNumber: checkAt >= 0 ? (cells[checkAt] || null) : null,
    });
  }

  return { rows, errors };
}

const tagOf = (block: string, tag: string): string | null => {
  const m = new RegExp(`<${tag}>([^<\r\n]*)`, "i").exec(block);
  return m ? m[1].trim() : null;
};

/**
 * OFX and QFX are the same SGML-ish format; QFX is Quicken's variant with extra
 * proprietary tags we ignore. Parsed with regex rather than a full SGML reader:
 * the transaction block is flat and well-defined, and a dependency that parses
 * the entire header for four fields is a poor trade.
 */
function parseOfx(text: string): { rows: ParsedRow[]; errors: string[] } {
  const errors: string[] = [];
  const blocks = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? [];
  if (blocks.length === 0) return { rows: [], errors: ["No transactions found in the file."] };

  const rows: ParsedRow[] = [];
  for (const [index, block] of blocks.entries()) {
    const postedAt = parseDate(tagOf(block, "DTPOSTED") ?? "");
    const amountCents = parseAmount(tagOf(block, "TRNAMT") ?? "");
    if (!postedAt || amountCents === null) {
      errors.push(`Transaction ${index + 1}: missing a date or an amount.`);
      continue;
    }
    if (amountCents === 0) continue;

    rows.push({
      postedAt,
      amountCents,
      description: tagOf(block, "NAME") ?? tagOf(block, "MEMO") ?? "(no description)",
      // The bank's own id. Where this exists, dedupe is as exact as a live feed.
      fitId: tagOf(block, "FITID"),
      checkNumber: tagOf(block, "CHECKNUM"),
    });
  }
  return { rows, errors };
}

// ── Identity ───────────────────────────────────────────────────────────────

/**
 * A stable id for a row that has none.
 *
 * `occurrence` distinguishes rows identical in every field within one file. It
 * is deterministic in file order, so re-importing the same file produces the
 * same ids and collapses to the same rows.
 */
function derivedId(bankAccountId: string, row: ParsedRow, occurrence: number): string {
  const material = [
    bankAccountId,
    row.postedAt.toISOString().slice(0, 10),
    String(row.amountCents),
    row.description.toLowerCase().replace(/\s+/g, " ").trim(),
    String(occurrence),
  ].join("|");
  return `import:${createHash("sha256").update(material).digest("hex").slice(0, 32)}`;
}

// ── Import ─────────────────────────────────────────────────────────────────

export function parseStatement(
  text: string,
  format: ImportFormat
): { rows: ParsedRow[]; errors: string[] } {
  return format === "ofx" ? parseOfx(text) : parseCsv(text);
}

/** Guess the format so the caller does not have to ask the user. */
export function detectFormat(filename: string, text: string): ImportFormat {
  if (/<STMTTRN>/i.test(text) || /\.(ofx|qfx)$/i.test(filename)) return "ofx";
  return "csv";
}

export function toProviderTransactions(
  bankAccountId: string,
  rows: ParsedRow[]
): ProviderTransaction[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    let id = row.fitId ? `ofx:${row.fitId}` : null;
    if (!id) {
      const base = derivedId(bankAccountId, row, 0);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      id = count === 0 ? base : derivedId(bankAccountId, row, count);
    }
    return {
      providerTransactionId: id,
      providerAccountId: `file:${bankAccountId}`,
      postedAt: row.postedAt,
      amountCents: row.amountCents,
      description: row.description,
      merchantName: null,
      // An imported row is on a statement, so it has already settled. Nothing
      // imported is ever pending.
      pending: false,
      category: [],
      checkNumber: row.checkNumber,
      currency: "USD",
    };
  });
}

/**
 * Import a statement into one bank account's review queue.
 *
 * ADD-ONLY. Unlike a feed sync there is no cursor and no notion of a revision:
 * a row that already exists is counted as a duplicate and left exactly as it
 * is. That deliberately protects a row already posted — its description and
 * amount are the evidence for the entry made from it.
 */
export async function importStatement(args: {
  companyId: string;
  bankAccountId: string;
  filename: string;
  content: string;
}): Promise<ImportResult> {
  const account = await prisma.bankAccount.findFirst({
    where: { id: args.bankAccountId, companyId: args.companyId },
    select: { id: true },
  });
  if (!account) {
    return { parsed: 0, imported: 0, duplicates: 0, errors: ["No such bank account."] };
  }

  const format = detectFormat(args.filename, args.content);
  const { rows, errors } = parseStatement(args.content, format);
  const transactions = toProviderTransactions(args.bankAccountId, rows);

  let imported = 0;
  let duplicates = 0;

  for (const t of transactions) {
    const existing = await prisma.bankFeedTransaction.findUnique({
      where: {
        companyId_providerTransactionId: {
          companyId: args.companyId,
          providerTransactionId: t.providerTransactionId,
        },
      },
      select: { id: true },
    });
    if (existing) {
      duplicates += 1;
      continue;
    }

    await prisma.bankFeedTransaction.create({
      data: {
        companyId: args.companyId,
        bankAccountId: args.bankAccountId,
        providerTransactionId: t.providerTransactionId,
        providerAccountId: t.providerAccountId,
        postedAt: t.postedAt,
        amountCents: t.amountCents,
        description: t.description,
        merchantName: t.merchantName,
        pending: false,
        category: [],
        checkNumber: t.checkNumber,
        currency: t.currency,
      },
    });
    imported += 1;
  }

  return { parsed: transactions.length, imported, duplicates, errors };
}
