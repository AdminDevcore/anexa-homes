import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { PageHeader } from "@/components/portal/ui";
import { currentFormatters } from "@/lib/format-server";
import { get1099Report } from "@/server/modules/bookkeeping/tax1099";
import { Tax1099Controls } from "@/components/portal/tax-1099-controls";

export const metadata = { title: "1099-NEC" };
export const dynamic = "force-dynamic";

export default async function Tax1099Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (!can(user, "read", "Bookkeeping")) redirect("/portal/dashboard");

  const fmt = await currentFormatters();
  const sp = await searchParams;
  const now = new Date().getFullYear();
  const yearRaw = Number(Array.isArray(sp.year) ? sp.year[0] : sp.year);
  const year = Number.isFinite(yearRaw) && yearRaw > 2000 ? yearRaw : now;
  const years = [now, now - 1, now - 2, now - 3];

  const report = await get1099Report(user.companyId, year);
  const canEdit = can(user, "update", "Bookkeeping");

  return (
    <div className="space-y-6">
      <Link href="/portal/bookkeeping" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to Bookkeeping
      </Link>
      <PageHeader title="1099-NEC" description="Year-end nonemployee compensation for contractors flagged 1099. Totals are booked money-out matched by vendor." />

      <Tax1099Controls year={year} years={years} payerEin={report.payer.einTaxId} canEdit={canEdit} />

      {!report.payer.einTaxId && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="size-4 shrink-0" /> Set your company EIN above — it's the payer TIN required on every 1099.
        </div>
      )}

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card label="Reportable contractors" value={String(report.reportableCount)} hint="paid ≥ $600" />
        <Card label="Total 1099 compensation" value={fmt.money(report.totalCents)} hint={`${year} · all 1099 vendors`} />
        <Card label="Need info before filing" value={String(report.rows.filter((r) => r.reportable && r.missing.length > 0).length)} hint="missing EIN/address" tone={report.rows.some((r) => r.reportable && r.missing.length > 0) ? "warn" : undefined} />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Contractor</th>
              <th className="px-4 py-3 text-left font-medium">EIN / TIN</th>
              <th className="px-4 py-3 text-left font-medium">Address</th>
              <th className="px-4 py-3 text-right font-medium">Box 1 ({year})</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {report.rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No payments to 1099 vendors in {year}. (Flag a vendor as 1099 in Bookkeeping → Manage.)</td></tr>
            )}
            {report.rows.map((r) => (
              <tr key={r.vendorId} className={r.reportable ? "" : "opacity-60"}>
                <td className="px-4 py-3 font-medium">{r.legalName || r.name}{r.legalName && r.legalName !== r.name ? <span className="block text-xs font-normal text-muted-foreground">{r.name}</span> : null}</td>
                <td className="px-4 py-3 tabular-nums">{r.einTaxId ?? <span className="text-red-600">missing</span>}</td>
                <td className="px-4 py-3 text-muted-foreground">{r.address || <span className="text-red-600">missing</span>}</td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">{fmt.money(r.totalCents)}</td>
                <td className="px-4 py-3">
                  {!r.reportable ? (
                    <span className="text-xs text-muted-foreground">under $600</span>
                  ) : r.missing.length > 0 ? (
                    <span className="text-xs font-medium text-amber-700">needs: {r.missing.join(", ")}</span>
                  ) : (
                    <span className="text-xs font-medium text-emerald-600">ready</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Totals are booked (approved) money-out matched to each vendor by name. Flag a contractor as 1099 and fill their EIN/address in Bookkeeping → Manage → Vendors. Card/processor payments belong on the processor&rsquo;s 1099-K, not here.
      </p>
    </div>
  );
}

function Card({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "warn" }) {
  return (
    <div className={`rounded-xl border bg-card p-5 ${tone === "warn" ? "border-amber-300" : "border-border"}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{hint}</span>
      </div>
      <div className={`mt-2 font-display text-2xl font-semibold tracking-tight ${tone === "warn" ? "text-amber-700" : ""}`}>{value}</div>
    </div>
  );
}
