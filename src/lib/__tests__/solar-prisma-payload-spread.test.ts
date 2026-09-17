import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * A SPREAD INTO A PRISMA PAYLOAD IS A HOLE THE COMPILER CANNOT SEE.
 *
 * TypeScript checks an object literal's OWN properties for excess keys. A
 * spread member is exempt — always, even when the target is typed — so
 *
 *     prisma.solarDealAdder.create({ data: { leadId, ...line } })
 *
 * type-checks perfectly while `line` carries a key the model does not have.
 * Prisma addresses FIELDS, not columns, so at runtime that either throws
 * `Unknown argument` or, where a cast widened it first, writes nothing and
 * reports success. Two of Stage 2's three defects arrived exactly this way, and
 * the retired-name guard next door could not see either of them: it matches
 * names written as literal keys, and these were never written as keys at all.
 *
 * So this is a RATCHET, not a ban. Every spread that exists today is listed
 * below; anything new fails until somebody adds it deliberately, which is the
 * moment to ask whether the payload should be MAPPED instead — the rule
 * `deal-money.ts` already states as "ONE VOCABULARY AT THE EXIT".
 *
 * Removing a spread means removing its entry: a stale line fails too, so the
 * list cannot quietly grow a fiction.
 *
 * WHY THESE MODELS. The ones carrying money or a price rule, which is where a
 * renamed field is expensive rather than merely wrong.
 */
const MONEY_MODELS = [
  "solarFinance", "solarLender", "solarLenderProduct", "solarDealAdder",
  "solarDesign", "solarSettings", "solarDealComp", "solarEquipment", "solarProposal",
];

/**
 * Known spreads, as `path :: model.operation`.
 *
 * Three of these are named in the Stage 4 brief and are closed by other means
 * rather than by rewriting the call:
 *
 *   - `modules/solar/lender-product-actions.ts` spreads a FRESH OBJECT LITERAL,
 *     which is now annotated with the Prisma input type. Excess-property
 *     checking applies to a literal's own keys, so all sixteen are checked.
 *   - `modules/solar/actions.ts` spreads two ZOD PARSES, where no annotation
 *     can restore that check. The second test below proves their keys against
 *     the model instead — at the schema, where the mistake would be made.
 */
const KNOWN_SPREADS = new Set([
  "server/modules/payroll/__tests__/estimate-matches-payroll.itest.ts :: solarLender.update",
  "server/modules/solar/__tests__/battery-autosize.itest.ts :: solarDesign.create",
  "server/modules/solar/__tests__/lender-product-lifecycle.itest.ts :: solarLenderProduct.create",
  "server/modules/solar/__tests__/pricing-golden.itest.ts :: solarDealAdder.create",
  "server/modules/solar/__tests__/pricing-golden.itest.ts :: solarDesign.create",
  "server/modules/solar/__tests__/pricing-golden.itest.ts :: solarEquipment.create",
  "server/modules/solar/__tests__/pricing-golden.itest.ts :: solarFinance.create",
  "server/modules/solar/__tests__/pricing-golden.itest.ts :: solarLender.create",
  "server/modules/solar/__tests__/pricing-golden.itest.ts :: solarLenderProduct.create",
  "server/modules/solar/__tests__/pricing-stage1.itest.ts :: solarDesign.create",
  "server/modules/solar/__tests__/pricing-stage1.itest.ts :: solarEquipment.create",
  "server/modules/solar/__tests__/pricing-stage1.itest.ts :: solarFinance.create",
  "server/modules/solar/__tests__/pricing-stage1.itest.ts :: solarProposal.create",
  "server/modules/solar/__tests__/pricing-stage1.itest.ts :: solarProposal.update",
  "server/modules/solar/__tests__/proposal-approval.itest.ts :: solarProposal.create",
  "server/modules/solar/__tests__/storage-readiness.itest.ts :: solarDesign.create",
  "server/modules/solar/actions.ts :: solarDesign.update",
  "server/modules/solar/actions.ts :: solarDesign.upsert",
  "server/modules/solar/actions.ts :: solarEquipment.create",
  "server/modules/solar/actions.ts :: solarEquipment.update",
  "server/modules/solar/actions.ts :: solarFinance.upsert",
  "server/modules/solar/actions.ts :: solarLender.create",
  "server/modules/solar/actions.ts :: solarSettings.upsert",
  "server/modules/solar/adder-actions.ts :: solarDealAdder.create",
  "server/modules/solar/adder-actions.ts :: solarDealAdder.update",
  "server/modules/solar/adder-actions.ts :: solarDesign.update",
  "server/modules/solar/adders.ts :: solarDealAdder.create",
  "server/modules/solar/commission-pricing.ts :: solarDealComp.update",
  "server/modules/solar/energy-actions.ts :: solarDesign.upsert",
  "server/modules/solar/equipment-actions.ts :: solarDesign.upsert",
  "server/modules/solar/layout-actions.ts :: solarDesign.upsert",
  "server/modules/solar/lender-product-actions.ts :: solarLenderProduct.create",
  "server/modules/solar/proposal-generate.ts :: solarProposal.create",
  "server/modules/solar/proposal-generate.ts :: solarProposal.update",
  "server/modules/solar/proposal-inperson-action.ts :: solarProposal.update",
  "server/modules/solar/proposal-reprice-actions.ts :: solarDealAdder.create",
  "server/modules/solar/recompute.ts :: solarDesign.update",
]);

const WRITE_OPS = [
  "create", "createMany", "createManyAndReturn", "update", "updateMany", "upsert",
].join("|");
const CALL = new RegExp(
  `\\.\\s*(${MONEY_MODELS.join("|")})\\s*\\.\\s*(${WRITE_OPS})\\s*\\(`, "g"
);

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

/** The text between a call's parentheses, paren-balanced. */
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

function foundSpreads(): Set<string> {
  const found = new Set<string>();
  for (const file of sourceFiles(ROOT)) {
    if (file === __filename) continue;
    const text = readFileSync(file, "utf8");
    CALL.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CALL.exec(text))) {
      const a = callArguments(text, m.index + m[0].length - 1);
      if (!/(data|create|update)\s*:\s*\{[^}]*\.\.\./.test(a)) continue;
      found.add(`${relative(ROOT, file)} :: ${m[1]}.${m[2]}`);
    }
  }
  return found;
}

describe("a spread into a Prisma payload is ratcheted, never added silently", () => {
  it("introduces no new one", () => {
    const added = [...foundSpreads()].filter((k) => !KNOWN_SPREADS.has(k)).sort();
    expect(
      added,
      "A spread member is exempt from excess-property checking, so a key the model does not have reaches Prisma unchecked and fails at runtime. MAP the payload field by field instead — see `deal-money.ts`'s ONE VOCABULARY AT THE EXIT. If the spread is genuinely safe, add it here with the reason."
    ).toEqual([]);
  });

  it("keeps no stale entry, so removing a spread removes its line", () => {
    const found = foundSpreads();
    const stale = [...KNOWN_SPREADS].filter((k) => !found.has(k)).sort();
    expect(stale, "These spreads are gone. Delete them from KNOWN_SPREADS.").toEqual([]);
  });
});

/**
 * THE ZOD SCHEMAS THAT ARE SPREAD STRAIGHT INTO A WRITE.
 *
 * `actions.ts` parses a form and spreads the result into `create`. The parse is
 * not a fresh literal at the call site, so nothing checks its keys against the
 * model — a schema field renamed on one side and not the other is silent until
 * a save fails in production. Checked here, at the schema, which is where the
 * two halves are supposed to agree.
 */
const SPREAD_SCHEMAS: { file: string; schema: string; model: string; notOnModel?: string[] }[] = [
  { file: "server/modules/solar/actions.ts", schema: "equipmentSchema", model: "SolarEquipment" },
  {
    file: "server/modules/solar/actions.ts",
    schema: "lenderSchema",
    model: "SolarLender",
    // Destructured out before the spread — it writes SolarLenderProduct rows.
    notOnModel: ["programmeBases"],
  },
];

function modelFields(model: string): Set<string> {
  const schema = readFileSync(join(ROOT, "..", "prisma", "schema.prisma"), "utf8");
  const body = new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`).exec(schema);
  if (!body) throw new Error(`model ${model} not found`);
  return new Set([...body[1].matchAll(/^\s{2}([a-zA-Z][A-Za-z0-9_]*)\s/gm)].map((m) => m[1]));
}

/**
 * Comments and string literals blanked, so a scan for keys cannot read prose.
 *
 * Written because the first version of this test did exactly that: it reported
 * `only`, `MW`, `URL` and `javascript` as schema keys, harvested out of
 * "// Loans only.", "Capped at 1 MW" and a note about `javascript:` links. A
 * guard that hallucinates findings is worse than no guard — it gets muted.
 */
function blankNoise(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === "//") {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? src.length : end;
      out += " ".repeat(stop - i);
      i = stop;
    } else if (two === "/*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (src[i] === '"' || src[i] === "'" || src[i] === "`") {
      const quote = src[i];
      let j = i + 1;
      while (j < src.length && src[j] !== quote) j += src[j] === "\\" ? 2 : 1;
      out += " ".repeat(Math.min(j + 1, src.length) - i);
      i = j + 1;
    } else {
      out += src[i];
      i++;
    }
  }
  return out;
}

/** Top-level keys of `const <name> = z.object({ ... })`, by brace depth. */
function zodKeys(raw: string, name: string): string[] {
  const src = blankNoise(raw);
  const start = new RegExp(`const ${name} = z\\.object\\(\\{`).exec(src);
  if (!start) throw new Error(`${name} not found`);
  let depth = 1;
  const keys: string[] = [];
  for (let i = start.index + start[0].length; i < src.length && depth > 0; i++) {
    const c = src[i];
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth--;
    else if (depth === 1) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(src.slice(i));
      // A key starts a property: only newline, comma or the opening brace
      // may precede it, or `product` inside `d.product === "loan"` counts.
      if (m && /[\n,{]\s*$/.test(src.slice(0, i).slice(-40))) {
        keys.push(m[1]);
        i += m[0].length - 1;
      }
    }
  }
  return keys;
}

describe("a zod schema spread into a write names only fields the model has", () => {
  it.each(SPREAD_SCHEMAS)("$schema -> $model", ({ file, schema, model, notOnModel }) => {
    const src = readFileSync(join(ROOT, file), "utf8");
    const fields = modelFields(model);
    const keys = zodKeys(src, schema).filter((k) => !(notOnModel ?? []).includes(k));
    expect(keys.length).toBeGreaterThan(5);
    expect(
      keys.filter((k) => !fields.has(k)),
      `${schema} is spread into a Prisma write. These keys are not fields on ${model}, so the write fails at runtime while tsc stays silent.`
    ).toEqual([]);
  });
});
