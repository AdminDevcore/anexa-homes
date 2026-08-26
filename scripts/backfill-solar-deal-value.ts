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
 * newest proposal's frozen `financing.contractPriceCents` is what that customer
 * was actually quoted, and it is the same figure generation stamps today, so
 * running this changes nothing on a deal quoted since.
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
import { solarLeadValueCents, type SolarPriceSource } from "../src/lib/solar-deal-value";

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
  return {
    product: (typeof f.product === "string" ? f.product : null) as SolarPriceSource["product"],
    contractPriceCents: num(f.contractPriceCents),
    monthlyPaymentCents: num(f.monthlyPaymentCents),
    rateMillsPerKwh: num(f.rateMillsPerKwh),
  };
}

async function main() {
  const leads = await prisma.lead.findMany({
    where: { vertical: "solar" },
    select: { id: true, firstName: true, lastName: true, value: true },
    orderBy: { createdAt: "asc" },
  });

  let quoted = 0;
  let changed = 0;
  let skipped = 0;

  for (const lead of leads) {
    // The NEWEST version, which is the one the deal page reports and the one
    // generation would have stamped. A superseded version is a record of what
    // was offered, not what the deal is worth now.
    const proposal = await prisma.solarProposal.findFirst({
      where: { leadId: lead.id },
      orderBy: { version: "desc" },
      select: { version: true, snapshot: true },
    });
    if (!proposal) {
      skipped++;
      continue;
    }
    quoted++;

    const value = solarLeadValueCents(financingOf(proposal.snapshot));
    const name = `${lead.firstName} ${lead.lastName}`.trim() || lead.id;
    if (value === lead.value) continue;

    changed++;
    console.log(
      `${apply ? "SET " : "WOULD SET"}  ${name.padEnd(28)} v${proposal.version}  ` +
        `${usd(lead.value)} → ${usd(value)}`
    );
    if (apply) {
      await prisma.lead.update({ where: { id: lead.id }, data: { value } });
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
