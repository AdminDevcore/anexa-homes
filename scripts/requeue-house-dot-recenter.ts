/**
 * One-off: re-queue stored house dots for re-centring.
 *
 * The recenter-house-dots cron snaps each dot to its OSM rooftop and stamps
 * `recenteredAt` either way, so a dot is only ever processed once. Until the
 * shoelace fix, the "rooftop" it snapped to was computed with raw lat/lng in the
 * centroid sums — five orders of floating-point cancellation, a median 11 m of
 * error, and for two thirds of buildings a centroid so far off the roof that the
 * code fell back to the nearest outline vertex: the pin landed on a CORNER.
 *
 * Every dot already stamped therefore carries a coordinate computed the wrong
 * way and will never be retried. Clearing the stamp puts them back in the cron's
 * queue, which drains at 20 per half-hour (~960/day) with the corrected maths.
 *
 * Only `not_knocked` dots are touched — the same set the cron owns. A pin a rep
 * knocked, converted, or dragged by hand is a human's answer about where the
 * door is, and is left exactly where it is.
 *
 *   npx tsx scripts/requeue-house-dot-recenter.ts            # report only
 *   npx tsx scripts/requeue-house-dot-recenter.ts --apply    # clear the stamps
 *
 * DATABASE_URL must point at the environment you mean.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

async function main() {
  const where = {
    disposition: "not_knocked" as const,
    address: { not: null },
    recenteredAt: { not: null },
  };

  const total = await prisma.knock.count({ where });
  console.log(`${total} house dot(s) were centred with the old maths.`);
  if (total === 0) return;

  const runs = Math.ceil(total / 20);
  console.log(
    `The cron processes 20 per run every 30 min — about ${runs} run(s), ~${(runs / 2).toFixed(1)} hour(s) to drain.`
  );

  if (!apply) {
    console.log("\nReport only. Re-run with --apply to clear the stamps.");
    return;
  }

  const { count } = await prisma.knock.updateMany({ where, data: { recenteredAt: null } });
  console.log(`\nRe-queued ${count} dot(s). The cron will re-centre them onto their rooftops.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
