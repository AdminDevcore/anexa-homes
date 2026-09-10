/**
 * The contractor-invoice drop box.
 *
 * Every other folder on a deal is a two-way cupboard: whoever can open the job
 * can put paperwork in and take it back out. This one is a letter slot. The
 * installing contractor drops his bill into the job he worked, and from that
 * moment the deal is only the ADDRESS on the envelope — the file cannot be
 * listed, opened or downloaded from the folder by anyone, the uploader
 * included. It is read in exactly one place: the Contractor Pay tab on
 * Commissions, which only super_admin and accounting can reach.
 *
 * Why a letter slot rather than a normally-permissioned folder: a deal is the
 * most widely-shared object in the product. The rep who sold the job, their
 * manager, every admin and (on roofing) the standing crew can all open it, and
 * `src/app/portal/files/[id]/route.ts` authorises a deal-attached file purely
 * by "can you open the deal" — see the payroll-PDF incident recorded in
 * company-exports.ts. What a subcontractor charges is the company's cost of
 * goods; putting it behind the deal's own permissions would publish it to the
 * commissioned salesperson whose payout it helps determine.
 *
 * The category key is the load-bearing part. `FileAsset.category` already
 * stores it verbatim for every invoice ever uploaded into that folder, so this
 * needed no column and no backfill — the same key that filed them is the key
 * that now hides them. It lives in this module rather than in
 * `deal-folders.ts` so the file-serving route can ask the question without
 * pulling the icon set in with it.
 */

/** `FileAsset.category` for a contractor's invoice. Do not rename — see above. */
export const CONTRACTOR_INVOICE_CATEGORY = "contractor_invoice";

/** Is this file one of the invoices only Contractor Pay may open? */
export function isContractorInvoice(category: string | null | undefined): boolean {
  return category === CONTRACTOR_INVOICE_CATEGORY;
}
