/**
 * One-off: freeze the commission measure on every solar deal signed before the
 * measure was frozen at signing.
 *
 * `SolarDealComp` has always frozen a rep's RATES at signing. The watts, base
 * price and battery count those rates multiply were read live by payroll until
 * the pricing rework (Stage 1). Deals signed from then on freeze both; this
 * walks the rows signed before.
 *
 * NO COMMISSION MOVES WHEN IT RUNS. Payroll reads the live deal on these rows
 * today, and this freezes that same live figure. What it stops is the figure
 * moving afterwards.
 *
 * EVERY ROW IS CHECKED AGAINST ITS LATEST SIGNED PROPOSAL. A deal whose live
 * price no longer matches what the customer signed is listed and written with
 * `pricingMatchesSignedDocument = false`. Read that list before --apply: on
 * those deals the live figure may not be the one to freeze.
 *
 *   npx tsx scripts/backfill-deal-comp-pricing.ts            # report only, writes nothing
 *   npx tsx scripts/backfill-deal-comp-pricing.ts --apply    # write the columns
 *
 * DATABASE_URL must point at the environment you mean.
 */
import { PrismaClient } from "@prisma/client";
import type { Db } from "../src/server/db/types";
import { backfillCommissionMeasure } from "../src/server/modules/solar/commission-pricing";

/**
 * A PLAIN client, not `@/server/db/client`: this sweeps every company's solar
 * deals, and the extended client scopes to a workspace a script does not have.
 */
const prisma = new PrismaClient();

const apply = process.argv.includes("--apply");

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

async function main() {
  const rows = await backfillCommissionMeasure(prisma as unknown as Db, { apply, now: new Date() });

  let frozen = 0;
  let mismatched = 0;
  let skipped = 0;
  for (const r of rows) {
    const lead = r.leadId.slice(0, 8);
    const o = r.outcome;
    if (o.status === "skipped") {
      skipped += 1;
      console.log(`${lead}  ${r.basis.padEnd(15)}  SKIPPED  ${o.reason}`);
      continue;
    }
    frozen += 1;
    if (o.matches === false) mismatched += 1;
    const check =
      o.matches === null
        ? "no signed document to check"
        : o.matches
          ? `matches signed v${o.proposalVersion}`
          : `DOES NOT MATCH signed v${o.proposalVersion}: ${o.differences.join("; ")}`;
    console.log(
      `${lead}  ${r.basis.padEnd(15)}  ${o.measure.systemWatts} W  base ${usd(o.measure.basePriceCents)}  ` +
        `${o.measure.batteryQty} batt  final ${usd(o.finalPriceCents)}  ${check}`
    );
  }

  console.log(
    `\n${rows.length} deal(s) without a frozen measure: ${frozen} ${apply ? "frozen" : "would be frozen"}, ` +
      `${mismatched} not matching their signed document, ${skipped} skipped.`
  );
  if (!apply) console.log("Report only. Nothing was written. Re-run with --apply to write.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
