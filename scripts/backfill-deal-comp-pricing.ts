/**
 * One-off: freeze the commission measure on every solar deal signed before the
 * measure was frozen at signing.
 *
 * `SolarDealComp` has always frozen a rep's RATES at signing. The watts, base
 * price and battery count those rates multiply were read live by payroll until
 * the pricing rework (Stage 1). Deals signed from then on freeze both; this
 * walks the rows signed before.
 *
 * THE MEASURE COMES FROM THE SIGNED PROPOSAL, as it now does at every signature.
 * On an old row the document and the deal can disagree by thousands of dollars:
 * a deal re-priced after it was signed has drifted ever since, and nobody has
 * been paid on the document.
 *
 * SO IT WILL NOT MOVE AN EXISTING COMMISSION BY ITSELF. A row whose document
 * pays differently from the live deal is printed with both figures and HELD —
 * --apply writes every other row and leaves that one alone. Writing it is a
 * decision made with the dollar figure in front of you, so it needs
 * --allow-moves as well. (An earlier version of this header promised that no
 * commission could move when the script ran. That stopped being true when the
 * measure moved to the signed document, which is why the flag exists.)
 *
 *   npx tsx scripts/backfill-deal-comp-pricing.ts                        # report only, writes nothing
 *   npx tsx scripts/backfill-deal-comp-pricing.ts --apply                # write every row that pays the same
 *   npx tsx scripts/backfill-deal-comp-pricing.ts --apply --allow-moves  # write the rest too
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
/** Write the rows whose frozen measure would pay differently from the deal. */
const allowMoves = process.argv.includes("--allow-moves");

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

async function main() {
  const rows = await backfillCommissionMeasure(prisma as unknown as Db, {
    apply,
    allowMoves,
    now: new Date(),
  });

  let frozen = 0;
  let mismatched = 0;
  let skipped = 0;
  let held = 0;
  let moves = 0;
  for (const r of rows) {
    const lead = r.leadId.slice(0, 8);
    const o = r.outcome;
    if (o.status === "skipped") {
      skipped += 1;
      console.log(`${lead}  ${r.basis.padEnd(15)}  SKIPPED  ${o.reason}`);
      continue;
    }
    if (r.movesPay) moves += 1;
    if (r.held) {
      held += 1;
      console.log(
        `${lead}  ${r.basis.padEnd(15)}  HELD — WOULD MOVE PAY  ` +
          `${o.live.systemWatts} W → ${o.measure.systemWatts} W, ` +
          `base ${usd(o.live.basePriceCents)} → ${usd(o.measure.basePriceCents)}, ` +
          `${o.live.batteryQty} → ${o.measure.batteryQty} batt  (signed v${o.proposalVersion})`
      );
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
      `${mismatched} not matching their signed document, ${moves} that pay differently from the deal, ` +
      `${held} held, ${skipped} skipped.`
  );
  if (moves > 0 && !allowMoves) {
    console.log(
      `${moves} row(s) would MOVE an existing commission. Read the figures above, then re-run with ` +
        "--apply --allow-moves to write them."
    );
  }
  if (!apply) console.log("Report only. Nothing was written. Re-run with --apply to write.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
