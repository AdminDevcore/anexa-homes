"use client";

import { Printer } from "lucide-react";
import type { PublicCashBid } from "@/server/modules/cashbid/queries";

/** Physical (pen & paper) signature block — printed and signed in person. */
export function CashBidPrintSignature({ bid }: { bid: PublicCashBid }) {
  return (
    <section className="mt-8 rounded-xl border border-neutral-200 p-5 print:border-neutral-300">
      <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-neutral-400">Signature</h2>
      <p className="mt-3 text-sm text-neutral-700">
        By signing below, I accept this agreement and authorize {bid.company.name} to perform the work described above
        under the terms, warranty, and payment schedule shown.
      </p>

      <div className="mt-8 grid gap-8 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <div className="h-8 border-b border-neutral-400" />
          <div className="mt-1 text-xs text-neutral-500">Homeowner signature</div>
        </div>
        <div className="sm:w-40">
          <div className="h-8 border-b border-neutral-400" />
          <div className="mt-1 text-xs text-neutral-500">Date</div>
        </div>
      </div>

      <div className="mt-6">
        <div className="h-8 border-b border-neutral-400" />
        <div className="mt-1 text-xs text-neutral-500">Print name</div>
      </div>

      <button
        type="button"
        onClick={() => window.print()}
        className="mt-6 inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 print:hidden"
      >
        <Printer className="size-4" /> Print
      </button>
    </section>
  );
}
