import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * THE STAGE 2 RENAMES, GUARDED WHERE THEY CAN ACTUALLY BREAK.
 *
 * Ten columns and one enum were renamed in `schema.prisma` behind `@map`, so
 * the database still spells them the old way and no migration was produced.
 * That is the safe half. The dangerous half is that Prisma's client addresses
 * FIELDS, not columns: a `select`, `where` or `data` still carrying an old
 * spelling is wrong at runtime, and the compiler will only say so while the
 * argument keeps its type. Widen it — `as never`, `as any`,
 * `Record<string, unknown>` — and `tsc` goes quiet while the query throws or,
 * worse, writes nothing. One such cast was already in this repo.
 *
 * So this guard is POSITIONAL rather than a blanket ban on the words. Most of
 * these spellings are still perfectly correct elsewhere: `maxFinalPpwCents` and
 * `finalPpwMode` are what `solar-money.ts` calls its own inputs, and
 * `contractPriceCents` is a figure on `PurchaseBreakdown`. They are only wrong
 * INSIDE a Prisma call, which is exactly where this looks.
 *
 * Two spellings have no legitimate use left anywhere and are banned outright.
 */

/** Old Prisma field name → what the schema calls it now. */
const RETIRED_FIELDS: Record<string, string> = {
  maxFinalPpwCents: "priceRulePpwCents",
  finalPpwMode: "priceRuleMode",
  maxFinalPricePerBatteryCents: "priceRulePerBatteryCents",
  finalBatteryPriceMode: "priceRuleBatteryMode",
  targetNetPpwCents: "targetBasePpwCents",
  monthlyPaymentCents: "leasePaymentCents",
  basePriceCents: "baseKeptCents",
  financedOnTop: "outsidePriceRule",
  contractPriceCents: "finalPriceCents",
  // Inside a Prisma call this is always wrong: the field is `baseFinalPpwCents`
  // behind @map("grossPpwCents"). Elsewhere it is still FinanceRow's STICKER,
  // which is why it is positional here rather than banned outright. A merge
  // brought in a Prisma call spelling it the old way and only tsc objected.
  grossPpwCents: "baseFinalPpwCents",
};

/** Spellings with no remaining meaning in `src/` at all. */
const RETIRED_EVERYWHERE: Record<string, string> = {
  defaultGrossPpwCents: "companyDefaultBasePpwCents",
  SolarFinalPpwMode: "SolarPriceRuleMode",
};

const OPS = [
  "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow", "findMany",
  "create", "createMany", "createManyAndReturn", "update", "updateMany", "upsert",
  "delete", "deleteMany", "count", "aggregate", "groupBy",
].join("|");
const CALL = new RegExp(`\\.\\s*([a-z][A-Za-z0-9_]*)\\s*\\.\\s*(${OPS})\\s*\\(`, "g");

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

/** The text between a call's parentheses, brace- and paren-balanced. */
function callArguments(text: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return text.slice(openParen + 1, i);
    }
  }
  return text.slice(openParen + 1);
}

describe("the Stage 2 renames cannot come back through a Prisma call", () => {
  it("no Prisma argument carries a retired field spelling", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(ROOT)) {
      if (file === __filename) continue;
      const text = readFileSync(file, "utf8");
      CALL.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CALL.exec(text))) {
        const args = callArguments(text, m.index + m[0].length - 1);
        for (const [retired, now] of Object.entries(RETIRED_FIELDS)) {
          // As a KEY only: `x.basePriceCents` on the right of a colon is a read
          // of some other object and is none of this guard's business.
          if (!new RegExp(`(^|[{,\\s])${retired}\\s*:`).test(args)) continue;
          // An explicit, reasoned escape for a genuine stored-JSON literal.
          if (/prisma-retired-ok/.test(args)) continue;
          offenders.push(
            `${relative(ROOT, file)} — prisma.${m[1]}.${m[2]}() names \`${retired}\`; the field is now \`${now}\``
          );
        }
      }
    }
    expect(
      [...new Set(offenders)],
      "Prisma addresses FIELDS, not columns. These calls name a column that the schema now reaches under a different field name, so they fail (or silently write nothing) at runtime — and a widening cast means tsc will not tell you."
    ).toEqual([]);
  });

  it("the two fully retired spellings appear nowhere in src/", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(ROOT)) {
      if (file === __filename) continue;
      const text = readFileSync(file, "utf8");
      for (const [retired, now] of Object.entries(RETIRED_EVERYWHERE)) {
        if (text.includes(retired)) {
          offenders.push(`${relative(ROOT, file)} — \`${retired}\` is now \`${now}\``);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * THE KEY LISTS PRISMA CANNOT CHECK.
 *
 * Three constants in this codebase are string lists that become Prisma keys:
 * `DERIVED_KEYS` (read key, comparison key AND write key on one row),
 * `FROZEN_MEASURE_SELECT` and `LENDER_TERMS_SELECT`. Because they are strings
 * widened on the way into a query, neither the compiler nor the positional
 * guard above can tell when one of them names a column the schema no longer
 * reaches under that name.
 *
 * `DERIVED_KEYS` has already been wrong once, in exactly this way: it read
 * `undefined` off the stored row — which makes every key look changed — and
 * then wrote a column Prisma does not have. So the lists are checked against
 * the schema's own field names instead of against somebody's attention.
 */
function modelFields(model: string): Set<string> {
  const schema = readFileSync(join(ROOT, "..", "prisma", "schema.prisma"), "utf8");
  const body = new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`).exec(schema);
  if (!body) throw new Error(`model ${model} not found in schema.prisma`);
  return new Set(
    [...body[1].matchAll(/^\s{2}([a-zA-Z][A-Za-z0-9_]*)\s/gm)].map((m) => m[1])
  );
}

const quoted = (src: string, name: string) => {
  const block = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\] as const`).exec(src);
  return block ? [...block[1].matchAll(/"([A-Za-z0-9_]+)"/g)].map((m) => m[1]) : [];
};

const selectKeys = (src: string, name: string) => {
  const block = new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n\\} as const`).exec(src);
  if (!block) return { own: [] as string[], nested: {} as Record<string, string[]> };
  const text = block[1];
  const nested: Record<string, string[]> = {};
  for (const m of text.matchAll(/(\w+):\s*\{\s*select:\s*\{([^}]*)\}/g)) {
    nested[m[1]] = [...m[2].matchAll(/(\w+):\s*true/g)].map((x) => x[1]);
  }
  const own = [...text.replace(/(\w+):\s*\{[\s\S]*?\}\s*\}/g, "").matchAll(/(\w+):\s*true/g)]
    .map((m) => m[1]);
  return { own, nested };
};

describe("string key lists still name fields the schema actually has", () => {
  it("DERIVED_KEYS are all fields on SolarFinance", () => {
    const src = readFileSync(join(ROOT, "server/modules/solar/deal-money.ts"), "utf8");
    const fields = modelFields("SolarFinance");
    const keys = quoted(src, "DERIVED_KEYS");
    expect(keys.length).toBeGreaterThan(0);
    expect(
      keys.filter((k) => !fields.has(k)),
      "DERIVED_KEYS is the read key, the comparison key and the write key at once. A name the model does not have reads undefined off the stored row and then writes a column Prisma cannot find."
    ).toEqual([]);
  });

  it("FROZEN_MEASURE_SELECT are all fields on SolarDealComp", () => {
    const src = readFileSync(join(ROOT, "server/modules/solar/commission-pricing.ts"), "utf8");
    const fields = modelFields("SolarDealComp");
    const { own } = selectKeys(src, "FROZEN_MEASURE_SELECT");
    expect(own.length).toBeGreaterThan(0);
    expect(own.filter((k) => !fields.has(k))).toEqual([]);
  });

  it("LENDER_TERMS_SELECT names fields on SolarLenderProduct, and its nested lender on SolarLender", () => {
    const src = readFileSync(join(ROOT, "server/modules/solar/lender-terms.ts"), "utf8");
    const { own, nested } = selectKeys(src, "LENDER_TERMS_SELECT");
    const product = modelFields("SolarLenderProduct");
    expect(own.length).toBeGreaterThan(0);
    expect(own.filter((k) => !product.has(k))).toEqual([]);
    const lender = modelFields("SolarLender");
    expect(nested.lender ?? []).not.toEqual([]);
    expect((nested.lender ?? []).filter((k) => !lender.has(k))).toEqual([]);
  });
});
