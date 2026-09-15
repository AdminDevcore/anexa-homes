/**
 * One-off: give every already-quoted SOLAR deal the value it was quoted at.
 *
 * `Lead.value` is roofing's typed-in contract total, and nothing on a solar
 * deal ever wrote to it — the price is derived from the design, the lender's
 * fee and the adders. So every solar deal in the database reads $0 on the
 * pipeline board, on the dashboard and in the funnel report, including the ones
 * a homeowner has already signed.
 *
 * Generation stamps the column from now on (see proposal-generate.ts). This
 * walks the deals that were quoted BEFORE it did.
 *
 * THE SNAPSHOT IS THE SOURCE, not the design and not the finance row: the
 * reported proposal's own frozen figures are what that customer was actually
 * quoted, and they are the same ones generation stamps today.
 *
 * RE-RUNNABLE, AND IT MOVES NUMBERS AGAIN (2026-09-10). Two rules changed under
 * it and this is what brings the column back in step with the deal page:
 *   1. The value is the HOUSEHOLD'S NET — the price after the federal credits
 *      the document claims — falling back to the contract only where the
 *      document works no ladder out. Expect roughly half off a deal claiming
 *      all three credits.
 *   2. The version read is the APPROVED one where a deal has one, and the
 *      newest otherwise, matching `resolveReportedSystem`.
 *
 * ONLY DEALS WITH A PROPOSAL. A deal that is priced but never proposed keeps
 * its $0: nobody has been quoted anything, and putting a working figure into
 * the column every revenue report sums would book a sale that has not happened.
 * The deal page shows those a live price, labelled as one.
 *
 * A LEASE AND A PPA GET ZERO, deliberately. They have no system price — the
 * customer buys electricity — so there is no contract total to add into a
 * pipeline. The deal page shows their monthly or their rate instead.
 *
 *   npx tsx scripts/backfill-solar-deal-value.ts            # report only, writes nothing
 *   npx tsx scripts/backfill-solar-deal-value.ts --apply    # write the values
 *
 * DATABASE_URL must point at the environment you mean.
 */
import { PrismaClient } from "@prisma/client";
import {
  solarContractRevenueCents,
  solarLeadValueCents,
  type SolarPriceSource,
} from "../src/lib/solar-deal-value";
import { REPORTED_PROPOSAL_ORDER } from "../src/lib/solar-system-of-record";

/**
 * A PLAIN client, not `@/server/db/client`.
 *
 * The extended one enforces the vertical scope from async-local storage, which
 * a script has none of — and the whole point here is to sweep every solar deal
 * in the database rather than the ones one workspace can see.
 */
const prisma = new PrismaClient();

const apply = process.argv.includes("--apply");

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/**
 * The financing block off a frozen snapshot.
 *
 * Read defensively rather than cast: these documents were written by four
 * schema versions over the life of the product, and a script that assumed the
 * newest shape would throw on the first proposal generated before the payment
 * menu existed instead of reading the one field it came for.
 */
function financingOf(snapshot: unknown): SolarPriceSource | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const financing = (snapshot as Record<string, unknown>).financing;
  if (!financing || typeof financing !== "object") return null;
  const f = financing as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  // The ladder sits a level down and is the field a reader forgets — it is the
  // whole reason `snapshotPriceSource` exists in the app. Read the same way
  // here rather than imported, because this script must keep parsing documents
  // written by every schema version rather than trusting the newest shape.
  const ladder = f.creditLadder;
  const netCostCents =
    ladder && typeof ladder === "object"
      ? num((ladder as Record<string, unknown>).netCostCents)
      : null;
  return {
    product: (typeof f.product === "string" ? f.product : null) as SolarPriceSource["product"],
    contractPriceCents: num(f.contractPriceCents),
    netAfterCreditsCents: netCostCents,
    monthlyPaymentCents: num(f.monthlyPaymentCents),
    rateMillsPerKwh: num(f.rateMillsPerKwh),
  };
}

async function main() {
  const leads = await prisma.lead.findMany({
    where: { vertical: "solar" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      value: true,
      // The job, where production has started. Its contract is the SECOND
      // denormalised total and it holds the gross, not the net.
      project: { select: { id: true, contractValue: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  let quoted = 0;
  let changed = 0;
  let skipped = 0;

  for (const lead of leads) {
    // THE APPROVED VERSION, then the newest — the same ordering the deal page
    // reports at. `nulls: "last"` is load-bearing: Postgres sorts NULLs FIRST
    // on a DESC order, so without it this asks for the approved version and
    // reliably stamps the newest draft instead.
    const proposal = await prisma.solarProposal.findFirst({
      where: { leadId: lead.id },
      orderBy: REPORTED_PROPOSAL_ORDER,
      select: { version: true, snapshot: true },
    });
    if (!proposal) {
      skipped++;
      continue;
    }
    quoted++;

    const price = financingOf(proposal.snapshot);
    const value = solarLeadValueCents(price);
    /**
     * THE CONTRACT, for the job. A different figure from `value` above and
     * deliberately so: `Lead.value` is the household's net after the federal
     * credits, and `Project.contractValue` is what the contract is written
     * for. Stamping the net onto the job is what booked a $56,000 solar
     * contract as $39,200 of revenue on every Project-based report.
     */
    const contract = solarContractRevenueCents(price);
    const name = `${lead.firstName} ${lead.lastName}`.trim() || lead.id;

    const valueMoved = value !== lead.value;
    const contractMoved =
      !!lead.project && contract > 0 && contract !== lead.project.contractValue;
    if (!valueMoved && !contractMoved) continue;

    changed++;
    if (valueMoved) {
      console.log(
        `${apply ? "SET " : "WOULD SET"}  ${name.padEnd(28)} v${proposal.version}  ` +
          `value ${usd(lead.value)} → ${usd(value)}`
      );
    }
    if (contractMoved) {
      console.log(
        `${apply ? "SET " : "WOULD SET"}  ${name.padEnd(28)} v${proposal.version}  ` +
          `contract ${usd(lead.project!.contractValue)} → ${usd(contract)}`
      );
    }
    if (apply) {
      if (valueMoved) await prisma.lead.update({ where: { id: lead.id }, data: { value } });
      if (contractMoved) {
        await prisma.project.update({
          where: { id: lead.project!.id },
          data: { contractValue: contract },
        });
      }
    }
  }

  console.log(
    `\n${leads.length} solar deals · ${quoted} with a proposal · ${skipped} never quoted (left alone) · ` +
      `${changed} ${apply ? "updated" : "would change"}`
  );
  if (!apply && changed > 0) console.log("Re-run with --apply to write them.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
