import type { Vertical } from "@prisma/client";
import type { RenderableReport } from "@/server/modules/reports/builders";
import type { Period, StatementBasis } from "./reports";
import {
  balanceSheetStatement,
  generalLedgerStatement,
  profitAndLossStatement,
  trialBalanceStatement,
  type ComparisonMode,
  type StatementSlug,
} from "./statements";

/**
 * ONE READING OF THE QUERY STRING, SHARED BY THE SCREEN, THE CSV AND THE PDF.
 *
 * The reports in `/portal/reports` each parse their own parameters three times
 * — once in `page.tsx`, once in `export/route.ts`, once in `pdf/route.ts`. With
 * a single `scope` parameter that is harmless duplication. A statement carries
 * five (basis, comparison, department, period, account), and three hand-kept
 * copies of that logic is a guarantee that one day the CSV says something the
 * screen does not. Downloading a P&L that disagrees with the P&L you were
 * looking at is the specific failure worth designing out.
 *
 * So the request is resolved ONCE, here, and `buildStatement` is the only way
 * to turn it into a report. The export is the same report by construction
 * rather than by care.
 *
 * ── TWO TYPES ARE CALLED `Period`, AND THEY ARE NOT THE SAME ────────────────
 * `reports/period.ts` has `{ from: Date; to: Date; label; preset }`, shared by
 * every sales report. The books use `{ startMs: number | null; endMs: number |
 * null }`, where null genuinely means "no bound" — a balance sheet has no lower
 * bound, and a fabricated one would quietly turn a snapshot into a window. This
 * file therefore resolves its own period rather than importing `resolvePeriod`,
 * which cannot express the open bound.
 */

export type StatementRequest = {
  slug: StatementSlug;
  basis: StatementBasis;
  comparison: ComparisonMode;
  vertical: Vertical | null;
  /** For the P&L and the register: a window. */
  period: Period;
  /** For the trial balance and balance sheet: a moment. */
  asOf: Date;
  /** The general ledger is always about one account. */
  accountId: string | null;
  /** Echoed back so the controls can render what was asked for. */
  preset: string;
  from: string;
  to: string;
  periodLabel: string;
};

export const STATEMENT_SLUGS: StatementSlug[] = [
  "trial-balance",
  "profit-and-loss",
  "balance-sheet",
  "general-ledger",
];

export function isStatementSlug(s: string): s is StatementSlug {
  return (STATEMENT_SLUGS as string[]).includes(s);
}

/** Presets a bookkeeper actually asks for. Fiscal year is Jan–Dec per books-build.md. */
export const PERIOD_PRESETS = [
  { value: "this_month", label: "This month" },
  { value: "this_quarter", label: "This quarter" },
  { value: "ytd", label: "Year to date" },
  { value: "last_year", label: "Last year" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom…" },
] as const;

const day = (value: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
};

const endOfDayUtc = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function resolveBooksPeriod(
  preset: string,
  from: string,
  to: string,
  now: Date
): { period: Period; label: string } {
  const y = now.getUTCFullYear();
  const endNow = endOfDayUtc(now).getTime();

  if (preset === "custom") {
    const f = day(from);
    const t = day(to);
    if (f && t) {
      return {
        period: { startMs: f.getTime(), endMs: endOfDayUtc(t).getTime() },
        label: `${from} → ${to}`,
      };
    }
    // Fall through to the default rather than reporting a window nobody asked
    // for: a half-filled custom range is a form in progress, not a request.
  }

  switch (preset) {
    case "all":
      // Both bounds open. This is the case `resolvePeriod` cannot express.
      return { period: { startMs: null, endMs: null }, label: "All time" };
    case "this_month":
      return {
        period: { startMs: Date.UTC(y, now.getUTCMonth(), 1), endMs: endNow },
        label: "This month",
      };
    case "this_quarter": {
      const q = Math.floor(now.getUTCMonth() / 3);
      return { period: { startMs: Date.UTC(y, q * 3, 1), endMs: endNow }, label: "This quarter" };
    }
    case "last_year":
      return {
        period: { startMs: Date.UTC(y - 1, 0, 1), endMs: Date.UTC(y - 1, 11, 31, 23, 59, 59, 999) },
        label: `${y - 1}`,
      };
    case "ytd":
    default:
      return { period: { startMs: Date.UTC(y, 0, 1), endMs: endNow }, label: "Year to date" };
  }
}

type Params = { get(name: string): string | null };

/** Accepts URLSearchParams (routes) or a plain searchParams object (pages). */
export function paramsFrom(sp: Record<string, string | string[] | undefined>): Params {
  return {
    get(name) {
      const v = sp[name];
      const s = Array.isArray(v) ? v[0] : v;
      return s == null ? null : s;
    },
  };
}

/**
 * An absent parameter and an empty one mean the same thing, and the resolver —
 * not the caller — is where that is decided.
 *
 * The two entry points disagree by default: a page's `searchParams` omits the
 * key entirely, while `URLSearchParams.get` returns "" for `?period=`. Left to
 * the callers, the same URL resolved to `preset: "ytd"` on the page and
 * `preset: ""` in the export route — which then went into `requestQuery`, so
 * the download link stopped describing the screen. Normalising here means
 * neither caller can get it wrong, which is the entire point of one resolver.
 */
function normalized(p: Params): Params {
  return {
    get(name) {
      const v = p.get(name);
      return v == null || v.trim() === "" ? null : v;
    },
  };
}

export function resolveStatementRequest(
  slug: StatementSlug,
  raw: Params,
  now: Date = new Date()
): StatementRequest {
  const p = normalized(raw);
  const basis: StatementBasis = p.get("basis") === "cash" ? "cash" : "accrual";

  const rawComparison = p.get("compare");
  const comparison: ComparisonMode =
    rawComparison === "prior_period" || rawComparison === "prior_year" ? rawComparison : "none";

  const rawVertical = p.get("vertical");
  const vertical: Vertical | null =
    rawVertical === "roofing" || rawVertical === "solar" || rawVertical === "others"
      ? rawVertical
      : null;

  const preset = p.get("period") ?? "ytd";
  const from = p.get("from") ?? "";
  const to = p.get("to") ?? "";
  const { period, label } = resolveBooksPeriod(preset, from, to, now);

  // A snapshot is taken at the END of the window, so "year to date" and a
  // balance sheet agree about what "now" means.
  const asOf = period.endMs != null ? new Date(period.endMs) : endOfDayUtc(now);

  return {
    slug,
    basis,
    comparison,
    vertical,
    period,
    asOf,
    accountId: p.get("account"),
    preset,
    from: from || (period.startMs != null ? iso(period.startMs) : ""),
    to: to || (period.endMs != null ? iso(period.endMs) : ""),
    periodLabel: label,
  };
}

/**
 * The one place a request becomes a report.
 *
 * `accountLabel` is passed in rather than looked up here so the caller can use
 * the list it already loaded for the picker instead of issuing a second query.
 */
export async function buildStatement(
  companyId: string,
  req: StatementRequest,
  accountLabel?: string
): Promise<RenderableReport> {
  switch (req.slug) {
    case "trial-balance":
      return trialBalanceStatement({ companyId, asOf: req.asOf });

    case "balance-sheet":
      return balanceSheetStatement({ companyId, asOf: req.asOf, vertical: req.vertical });

    case "general-ledger":
      if (!req.accountId) {
        return {
          title: "General Ledger",
          periodLabel: req.periodLabel,
          scopeLabel: "No account chosen",
          metrics: [],
          tables: [{ title: "Pick an account", columns: ["Account"], rows: [] }],
        };
      }
      return generalLedgerStatement({
        companyId,
        accountId: req.accountId,
        accountLabel: accountLabel ?? "Account",
        period: req.period,
      });

    case "profit-and-loss":
    default:
      return profitAndLossStatement({
        companyId,
        period: req.period,
        vertical: req.vertical,
        basis: req.basis,
        comparison: req.comparison,
      });
  }
}

/** Query string that reproduces this request, for the CSV/PDF links. */
export function requestQuery(req: StatementRequest): string {
  const q = new URLSearchParams();
  q.set("period", req.preset);
  if (req.preset === "custom") {
    q.set("from", req.from);
    q.set("to", req.to);
  }
  q.set("basis", req.basis);
  q.set("compare", req.comparison);
  if (req.vertical) q.set("vertical", req.vertical);
  if (req.accountId) q.set("account", req.accountId);
  return q.toString();
}
