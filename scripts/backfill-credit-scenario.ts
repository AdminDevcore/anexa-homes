/**
 * One-off: give proposals already issued the tax-credit switch.
 *
 * The switch reads TWO frozen horizons per payment option — the document as
 * quoted, and the same deal with the household's federal credits already
 * applied to the loan. New proposals get both at generation. Every proposal
 * generated before that carries only the first, so the control does not appear
 * on it at all, and a rep with a live link in a customer's inbox would have to
 * reissue the document to get a button.
 *
 * ADDS, NEVER REWRITES. It writes one new key — `creditsApplied` — onto each
 * option that earns credits and has no such key yet. Not one existing figure is
 * touched: the price, the payment, the ladder, the reconciliation and the
 * quoted horizon come out byte-identical, which is the only basis on which it
 * is acceptable to write into a document a customer may already have signed.
 *
 * The new horizon is built from the snapshot's OWN frozen inputs — its
 * production, its usage, its rate, its assumptions, its after-credit payment —
 * through the same `savingsModel` generation uses. Nothing is re-priced and no
 * catalogue, rate sheet or company setting is read, so a proposal backfilled
 * today gets the same second model it would have been generated with.
 *
 * A SIGNED PROPOSAL IS LEFT ALONE unless you say otherwise. The write is
 * additive and the figures come out identical, so there is a good argument that
 * it would be harmless — but "harmless" is a judgement about a document with
 * somebody's signature on it, and that judgement is not a script's to make. Ask
 * for `--include-signed` when a person has decided.
 *
 * SKIPPED, and counted rather than silently passed over: storage documents,
 * options with no credit ladder, options already carrying the key, and any
 * option whose snapshot does not hold enough to model a year.
 *
 *   npx tsx scripts/backfill-credit-scenario.ts                    # report only
 *   npx tsx scripts/backfill-credit-scenario.ts --apply            # write
 *   npx tsx scripts/backfill-credit-scenario.ts --apply --include-signed
 *
 * DATABASE_URL must point at the environment you mean.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { savingsModel, type SolarProposalSnapshot } from "../src/lib/solar-proposal";

/**
 * A PLAIN client, not `@/server/db/client`.
 *
 * The extended one enforces the vertical scope from async-local storage, which
 * a script has none of — and the point here is to sweep every solar proposal in
 * the database rather than the ones one workspace can see.
 */
const prisma = new PrismaClient();

const apply = process.argv.includes("--apply");
const includeSigned = process.argv.includes("--include-signed");

type Snapshot = SolarProposalSnapshot;
type Option = NonNullable<Snapshot["options"]>[number];

/**
 * The credits-applied horizon for one option, or null when there is none to
 * build.
 *
 * Mirrors `priceOption`'s own second scenario exactly: the lower payment from
 * the first month on a loan, and the relief as a year-one lump on cash — never
 * both, which would credit the household the same money twice.
 */
function creditsAppliedFor(s: Snapshot, o: Option): Option["creditsApplied"] | null {
  const f = o.financing;
  const ladder = f.creditLadder;
  if (!ladder) return null;
  if (f.product !== "loan" && f.product !== "cash") return null;

  // The horizon the quoted model was built over. Read off the frozen rows
  // rather than recomputed from the term: the two agree today, and if a future
  // rule ever moves the horizon this document keeps the one it was issued with.
  const years = o.savings.years.length;
  if (years === 0) return null;

  const monthlyCents = f.product === "loan" ? (f.netMonthlyPaymentCents ?? o.monthlyCents) : null;
  const reliefCents =
    f.product === "loan" && f.netMonthlyPaymentCents != null ? 0 : ladder.reliefCents;

  const savings = savingsModel({
    product: f.product,
    year1ProductionKwh: s.system.year1ProductionKwh,
    annualUsageKwh: s.energy.annualUsageKwh,
    currentRateMillsPerKwh: s.assumptions.currentRateMillsPerKwh,
    assumptions: s.assumptions,
    years,
    vppCredits: s.vpp ?? [],
    purchasePriceCents: f.contractPriceCents,
    creditReliefCents: reliefCents,
    loan:
      f.product === "loan"
        ? {
            monthlyPaymentCents: monthlyCents,
            termMonths: f.loanTermMonths ?? null,
            downPaymentCents: 0,
            // Flat from month one — that IS the scenario.
            afterCreditMonthlyCents: null,
            creditAppliedAfterMonths: 0,
          }
        : null,
  });

  return { savings, monthlyCents };
}

async function main() {
  const rows = await prisma.solarProposal.findMany({
    select: { id: true, leadId: true, version: true, signedAt: true, snapshot: true },
    orderBy: [{ leadId: "asc" }, { version: "asc" }],
  });

  let written = 0;
  let already = 0;
  let noLadder = 0;
  let skipped = 0;
  let signed = 0;

  for (const row of rows) {
    if (row.signedAt && !includeSigned) {
      signed++;
      continue;
    }
    const s = row.snapshot as unknown as Snapshot | null;
    if (!s || !Array.isArray(s.options) || s.options.length === 0) {
      skipped++;
      continue;
    }
    if (s.systemType === "storage") {
      skipped++;
      continue;
    }

    let touched = false;
    const options = s.options.map((o) => {
      if (o.creditsApplied) {
        already++;
        return o;
      }
      if (!o.financing.creditLadder) {
        noLadder++;
        return o;
      }
      const creditsApplied = creditsAppliedFor(s, o);
      if (!creditsApplied) {
        skipped++;
        return o;
      }
      touched = true;
      return { ...o, creditsApplied };
    });

    if (!touched) continue;
    written++;
    console.log(
      `  v${row.version} ${row.leadId} — ${options.filter((o) => o.creditsApplied).length} option(s)`
    );
    if (!apply) continue;

    await prisma.solarProposal.update({
      where: { id: row.id },
      data: { snapshot: { ...s, options } as unknown as Prisma.InputJsonValue },
    });
  }

  console.log(
    `\n${apply ? "Wrote" : "Would write"} ${written} proposal(s). ` +
      `${already} option(s) already had one, ${noLadder} earn no credits, ${skipped} skipped.`
  );
  if (signed > 0) {
    console.log(
      `${signed} signed proposal(s) left untouched. Pass --include-signed to write into them.`
    );
  }
  if (!apply) console.log("Dry run — pass --apply to write.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
