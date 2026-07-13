import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCashBidByToken } from "@/server/modules/cashbid/queries";
import { formatMoney } from "@/server/modules/cashbid/money";
import { CashBidSignature } from "@/components/cashbid/cash-bid-signature";
import { CashBidPrintSignature } from "@/components/cashbid/cash-bid-print-signature";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const bid = await getCashBidByToken(token);
  return { title: bid ? `Proposal — ${bid.company.name}` : "Proposal", robots: { index: false } };
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-sm text-neutral-600">{label}</span>
      <span className="font-semibold text-neutral-900">{value}</span>
    </div>
  );
}

export default async function CashBidPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const bid = await getCashBidByToken(token);
  if (!bid) notFound();

  const c = bid.company;
  const isInsurance = bid.kind === "insurance";
  const money = (cents: number) => formatMoney(cents, c.currencyCode, c.locale);
  const date = new Date(bid.createdAt).toLocaleDateString(c.locale || "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-8 print:bg-white print:p-0">
      <div className="mx-auto max-w-2xl rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm print:rounded-none print:border-0 print:shadow-none sm:p-12">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-neutral-200 pb-6">
          {c.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.logoUrl} alt={c.name} className="h-9 w-auto" />
          ) : (
            <span className="font-display text-xl font-bold text-neutral-900">{c.name}</span>
          )}
          <div className="text-right">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-400">
              {isInsurance ? "Repair Agreement" : "Proposal & Agreement"}
            </div>
            <div className="text-sm text-neutral-500">{date}</div>
          </div>
        </div>

        {/* Prepared for */}
        <div className="mt-6 text-sm">
          <div className="text-neutral-500">Prepared for</div>
          <div className="mt-0.5 font-semibold text-neutral-900">{bid.homeownerName}</div>
          {bid.propertyAddress ? <div className="text-neutral-600">{bid.propertyAddress}</div> : null}
        </div>

        {/* Scope of work */}
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-neutral-400">Scope of work</h2>
          <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-neutral-800">{bid.workDescription}</p>
        </section>

        {isInsurance ? (
          <>
            {/* Insurance claim reference */}
            {bid.carrier || bid.claimNumber ? (
              <section className="mt-8">
                <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-neutral-400">Insurance claim</h2>
                <div className="mt-3 divide-y divide-neutral-200 overflow-hidden rounded-xl border border-neutral-200">
                  {bid.carrier ? <Row label="Carrier" value={bid.carrier} /> : null}
                  {bid.claimNumber ? <Row label="Claim #" value={bid.claimNumber} /> : null}
                </div>
              </section>
            ) : null}

            {/* Payment — deductible only */}
            <section className="mt-6">
              <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-neutral-400">Payment</h2>
              <div className="mt-3 divide-y divide-neutral-200 overflow-hidden rounded-xl border border-neutral-200">
                <Row label="Insurance-approved amount" value="Paid by carrier" />
                <Row label="Your responsibility (deductible)" value={money(bid.deductibleCents)} />
              </div>
              <p className="mt-3 text-xs leading-relaxed text-neutral-500">
                This is an insurance repair. {c.name} will perform the approved scope of work for the amount approved by
                your insurance carrier. You are responsible only for your deductible of {money(bid.deductibleCents)}; the
                remaining approved amount is billed to and paid by your insurance company.
              </p>
            </section>
          </>
        ) : (
          <>
            {/* Total */}
            <section className="mt-8 rounded-xl border border-neutral-200 bg-neutral-50 p-5">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium text-neutral-500">Total investment</span>
                <span className="font-display text-3xl font-bold text-neutral-900">{money(bid.totalCents)}</span>
              </div>
            </section>

            {/* Payment schedule */}
            <section className="mt-6">
              <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-neutral-400">Payment schedule</h2>
              <div className="mt-3 divide-y divide-neutral-200 overflow-hidden rounded-xl border border-neutral-200">
                <Row label={`Due upon signing (${bid.depositPercent}%)`} value={money(bid.depositCents)} />
                <Row label={`Due upon completion (${100 - bid.depositPercent}%)`} value={money(bid.balanceCents)} />
              </div>
              <p className="mt-3 text-xs leading-relaxed text-neutral-500">
                A {bid.depositPercent}% deposit is due upon signing; the remaining balance is due upon completion of the
                work described above. This is a cash agreement — no insurance claim or inspection is required.
              </p>
            </section>
          </>
        )}

        {/* Warranty */}
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-neutral-400">Warranty</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-neutral-200 p-4">
              <div className="font-display text-2xl font-bold text-neutral-900">{bid.warrantyWorkmanshipYears}-Year</div>
              <div className="mt-0.5 text-sm font-medium text-neutral-700">Workmanship warranty</div>
              <p className="mt-1.5 text-xs leading-relaxed text-neutral-500">
                {c.name} warrants all labor and installation for {bid.warrantyWorkmanshipYears} years from completion.
                Any defect in our workmanship will be corrected at no cost to you.
              </p>
            </div>
            <div className="rounded-xl border border-neutral-200 p-4">
              <div className="font-display text-2xl font-bold text-neutral-900">{bid.warrantyManufacturerYears}-Year</div>
              <div className="mt-0.5 text-sm font-medium text-neutral-700">Manufacturer warranty</div>
              <p className="mt-1.5 text-xs leading-relaxed text-neutral-500">
                Roofing materials carry the manufacturer&apos;s limited warranty of up to {bid.warrantyManufacturerYears}{" "}
                years against material defects, subject to the manufacturer&apos;s terms.
              </p>
            </div>
          </div>
        </section>

        {/* Terms & Agreement */}
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-neutral-400">Terms &amp; Agreement</h2>
          <p className="mt-2 text-sm text-neutral-700">
            Once signed by the homeowner below, this document is a binding agreement between {c.name} and the homeowner
            for the work stated above, on the following terms:
          </p>
          {isInsurance ? (
            <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-neutral-600">
              <li>
                • Payment: The homeowner is responsible for the insurance deductible of {money(bid.deductibleCents)}. The
                balance of the insurance-approved scope is billed to and paid by the insurance carrier.
              </li>
              <li>
                • {c.name} will perform the work approved by the homeowner&apos;s insurance carrier, including any approved
                supplements, per manufacturer specifications and applicable local building codes.
              </li>
              <li>
                • The homeowner authorizes their insurance proceeds — including recoverable depreciation and approved
                supplements — to be applied to this work.
              </li>
              <li>
                • Warranty: {bid.warrantyWorkmanshipYears}-year workmanship and up to {bid.warrantyManufacturerYears}-year
                manufacturer warranty as described above (manufacturer warranty subject to the manufacturer&apos;s terms).
              </li>
              <li>• Any change to the approved scope will be handled as an insurance supplement or written change order.</li>
              <li>• The homeowner may cancel this agreement within three (3) business days of signing.</li>
              <li>• This document represents the entire agreement between the parties.</li>
            </ul>
          ) : (
            <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-neutral-600">
              <li>• Payment: {bid.depositPercent}% due upon signing; the remaining balance due upon completion.</li>
              <li>• Work will be performed per manufacturer specifications and applicable local building codes.</li>
              <li>
                • Warranty: {bid.warrantyWorkmanshipYears}-year workmanship and up to {bid.warrantyManufacturerYears}-year
                manufacturer warranty as described above (manufacturer warranty subject to the manufacturer&apos;s terms).
              </li>
              <li>• Any change to the scope or price will be documented in a written change order agreed to by both parties.</li>
              <li>• This is a cash agreement; no insurance claim or inspection is required.</li>
              <li>• The homeowner may cancel this agreement within three (3) business days of signing.</li>
              <li>• This document represents the entire agreement between the parties.</li>
            </ul>
          )}
        </section>

        {/* Signature — digital e-sign, or a printable pen-and-paper line for in-person signing.
            If already signed digitally, always show the accepted state. */}
        {bid.signatureMode === "physical" && bid.status !== "signed" ? (
          <CashBidPrintSignature bid={bid} />
        ) : (
          <CashBidSignature bid={bid} />
        )}

        {/* Footer */}
        <div className="mt-10 border-t border-neutral-200 pt-4 text-center text-xs text-neutral-400">
          {c.name}
          {c.supportPhone ? ` · ${c.supportPhone}` : ""}
          {c.supportEmail ? ` · ${c.supportEmail}` : ""}
        </div>
      </div>
    </main>
  );
}
