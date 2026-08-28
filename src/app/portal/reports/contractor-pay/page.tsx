import { redirect } from "next/navigation";

/**
 * Contractor Pay left the Reports hub for its own sidebar item, where it sits
 * next to the invoices the crews submit. This is the old address, kept alive
 * because the report has been bookmarked and its PDFs mailed for months.
 *
 * The query string travels with it: period and scope mean the same thing on
 * the other side, so a saved link to "this quarter, whole company" still lands
 * on that report rather than resetting to the default month.
 */
export default async function LegacyContractorPayReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    const v = Array.isArray(value) ? value[0] : value;
    if (v) params.set(key, v);
  }
  const qs = params.toString();
  redirect(`/portal/contractor-pay/payouts${qs ? `?${qs}` : ""}`);
}
