"use client";

import { Printer } from "lucide-react";
import type { PublicCashBid } from "@/server/modules/cashbid/queries";

/**
 * Physical (pen & paper) signature block — printed and signed in person.
 *
 * `printOnly` renders the block only on the printed page (hidden on screen) so a
 * digital-signature bid can still be printed with a physical signature area.
 *
 * The `.cashbid-sig` class keeps the whole block on one page when printing (see
 * globals.css) so the signature lines never split awkwardly across two pages.
 */
export function CashBidPrintSignature({ bid, printOnly = false }: { bid: PublicCashBid; printOnly?: boolean }) {
  return (
    <section
      className={`cashbid-sig mt-8 rounded-xl border border-neutral-200 p-5 print:border-neutral-300 ${
        printOnly ? "hidden print:block" : ""
      }`}
    >
      <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-neutral-400">Signature</h2>
      <p className="mt-3 text-sm text-neutral-700">
        By signing below, I accept this agreement and authorize {bid.company.name} to perform the work described above
        under the terms, warranty, and payment schedule shown.
      </p>

      {/* Print name → Signature → Date */}
      <div className="mt-8 space-y-8">
        <div>
          <div className="h-8 border-b border-neutral-400" />
          <div className="mt-1 text-xs text-neutral-500">Print name</div>
        </div>
        <div>
          <div className="h-8 border-b border-neutral-400" />
          <div className="mt-1 text-xs text-neutral-500">Homeowner signature</div>
        </div>
        <div className="sm:max-w-xs">
          <div className="h-8 border-b border-neutral-400" />
          <div className="mt-1 text-xs text-neutral-500">Date</div>
        </div>
      </div>

      {!printOnly ? (
        <button
          type="button"
          onClick={() => window.print()}
          className="mt-6 inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 print:hidden"
        >
          <Printer className="size-4" /> Print
        </button>
      ) : null}
    </section>
  );
}
