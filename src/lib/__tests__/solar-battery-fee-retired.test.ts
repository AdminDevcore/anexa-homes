import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * THE BATTERY DEALER-FEE SWITCH IS RETIRED.
 *
 * "The dealer fee is on top of all the system cost, over the gross cost
 * including base price, adders and any other; the final price is the gross
 * price + dealer fee all together." (2026-09-15)
 *
 * So there is no per-lender answer to "is the fee taken on the battery" — it
 * always is. The column `SolarLender.batteryInsideFee` stays in the database
 * (and in schema.prisma, marked RETIRED) only until the release that stopped
 * reading it is live; a follow-up migration drops it.
 *
 * Until then this fails if anything in src/ starts reading or writing it again,
 * which is how a retired switch quietly comes back to life: a select copied
 * from an old file, and one screen prices the battery outside the fee.
 */

const RETIRED = ["battery", "InsideFee"].join("");
const ROOT = join(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("SolarLender.batteryInsideFee is retired", () => {
  it("no file in src/ references it", () => {
    const offenders = sourceFiles(ROOT)
      // This file names the column in its own prose and is not a caller.
      .filter((f) => f !== __filename)
      .filter((f) => readFileSync(f, "utf8").includes(RETIRED))
      .map((f) => relative(ROOT, f));
    expect(
      offenders,
      `These files reference the retired ${RETIRED} switch. The dealer fee always applies to the whole gross, battery included — price through priceUnits/pricePurchase and pass no switch.`,
    ).toEqual([]);
  });
});
