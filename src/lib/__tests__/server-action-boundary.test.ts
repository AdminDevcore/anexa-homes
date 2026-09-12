import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep, dirname } from "node:path";

/**
 * CI guard for the server-action boundary.
 *
 * EVERY export of a `"use server"` module is a public RPC endpoint. Next.js
 * registers one action id per exported function whether or not any client
 * component imports it, so an "internal helper" that happens to live in such a
 * file is reachable from outside the app.
 *
 * That makes one parameter shape uniquely dangerous: a function that takes the
 * TENANT (`companyId`) as an ARGUMENT. Inside a `"use server"` file the caller
 * supplies it, so the tenant boundary becomes whatever the caller typed — and no
 * amount of downstream scoping can recover from that. On 2026-09-05
 * `solar/storage.ts` shipped five such exports, one of them a write
 * (`syncDealRebateQuantities`), and they were only ever called from server code
 * that had already resolved the id from the session — so nothing needed them to
 * be actions at all.
 *
 * The fix, and the rule this guard enforces: a server action resolves its
 * company from `requireUser()` and never accepts one. Reads that take a
 * `companyId` live in a plain module beside it — `readiness.ts`, `adders.ts`,
 * `layout-asset.ts` and `esign/final-docs.ts` are all that split, and each says
 * so in its header.
 *
 * To add a legitimate exception: add the `file#export` to ALLOWED below with a
 * comment explaining why a caller-supplied id cannot cross a tenant boundary
 * there.
 *
 * WHAT THIS MISSED UNTIL 2026-09-11, AND WHY IT MATTERED. The rule was right
 * and the detector was too narrow: it tested the PARAMETER LIST AS TEXT, so it
 * saw `companyId: string` and `{ companyId }: { companyId: string }` and
 * nothing else. Almost no action in this codebase is written that way. They
 * take `input: z.infer<typeof someSchema>` — and a `companyId` inside that
 * schema is just as caller-supplied, while the parameter list says only
 * `input: z.infer<typeof someSchema>`. The guard would have passed, with the
 * same confidence, over the exact bug it was written for.
 *
 * So a parameter type is now RESOLVED before it is judged: `z.infer`/`z.input`
 * of a local zod schema, a local `type` alias, a local `interface`, and one hop
 * through a relative import. It also reads `export const x = async () => {}`,
 * which the old regex could not see at all.
 *
 * The limit worth knowing: resolution is textual and local. A type that cannot
 * be resolved is REPORTED rather than assumed safe — see the third test — so
 * the failure mode is a build that asks you a question, never one that quietly
 * says yes.
 */

const REPO_ROOT = join(__dirname, "..", "..", "..");
const SCAN_DIRS = ["src"];
const SCAN_EXT = [".ts", ".tsx"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".next-e2e", "dist", "build"]);

/**
 * The parameter name that carries the TENANT boundary.
 *
 * Deliberately only `companyId`. A `leadId` / `projectId` parameter is normal
 * and unavoidable — the browser has to say which row it is acting on, and the
 * action then proves ownership with `requireUser()` plus a `companyId`-scoped
 * read or `listScope()`. `companyId` is different in kind: it is the tenant key
 * itself, so accepting one lets the caller DECLARE which tenant they are, and
 * no amount of downstream scoping can recover from that.
 */
const SCOPE_PARAM = /\bcompanyId\b/;

/**
 * Reviewed exceptions, keyed by `repo/relative/path.ts#exportName`.
 * Every entry must state why a caller-supplied id is safe there.
 */
const ALLOWED: Record<string, string> = {
  // No entries. Every current server action resolves its company from the
  // session. Keep it that way.
};

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SCAN_EXT.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

/** A module is a server-action module only when the DIRECTIVE is its first statement. */
function isUseServerModule(src: string): boolean {
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    // Skip a leading licence//doc block before the directive.
    if (line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) continue;
    return line === '"use server";' || line === "'use server';";
  }
  return false;
}

/**
 * Exported async functions and their parameter list, read from the source text.
 * Deliberately textual rather than a real parse: this has to run in the unit
 * suite with no build step, and the shape it looks for is unambiguous.
 */
function exportedFunctions(src: string): { name: string; params: string }[] {
  const out: { name: string; params: string }[] = [];
  // `export function f(` / `export async function f(` and the arrow form
  // `export const f = async (`, which the original regex could not see.
  const forms = [
    /^export\s+(?:async\s+)?function\s+(\w+)\s*\(/gm,
    /^export\s+const\s+(\w+)\s*(?::[^=\n]+)?=\s*(?:async\s*)?\(/gm,
  ];
  for (const re of forms) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const open = src.indexOf("(", m.index + m[0].length - 1);
      let depth = 0;
      let i = open;
      for (; i < src.length; i++) {
        if (src[i] === "(") depth++;
        else if (src[i] === ")") {
          depth--;
          if (depth === 0) break;
        }
      }
      out.push({ name: m[1], params: src.slice(open + 1, i) });
    }
  }
  return out;
}

/** Everything from `open` to its matching close, inclusive. */
function balanced(src: string, open: number, o: string, c: string): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === o) depth++;
    else if (src[i] === c) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return src.length - 1;
}

/**
 * The text of a locally-declared schema, type alias or interface.
 *
 * Bounded exactly rather than by taking a window of following characters: a
 * loose window sweeps up unrelated code below the declaration and reports
 * companyId that is not in the type at all, which is worse than missing one —
 * it teaches people the guard cries wolf.
 */
function declarationText(src: string, name: string): string {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const zod = new RegExp(`\\bconst\\s+${esc}\\s*=\\s*z\\s*\\.`).exec(src);
  if (zod) {
    // Walk the whole chained expression (.object().extend().refine()) to the
    // semicolon that closes it at depth zero.
    let depth = 0;
    let i = zod.index + zod[0].length;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === "(" || ch === "{" || ch === "[") depth++;
      else if (ch === ")" || ch === "}" || ch === "]") depth--;
      else if (ch === ";" && depth <= 0) break;
    }
    return src.slice(zod.index, i);
  }

  // `const X = Y.extend({ ... })` / `Y.partial()`: the fields X adds are here,
  // but the ones it inherits are in Y, so the base name is handed back to the
  // caller to resolve too. A derived schema was one of the five shapes this
  // guard could not read on 2026-09-11.
  const derived = new RegExp(`\\bconst\\s+${esc}\\s*=\\s*(\\w+)\\s*\\.`).exec(src);
  if (derived && derived[1] !== "z") {
    let depth = 0;
    let i = derived.index + derived[0].length;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === "(" || ch === "{" || ch === "[") depth++;
      else if (ch === ")" || ch === "}" || ch === "]") depth--;
      else if (ch === ";" && depth <= 0) break;
    }
    return src.slice(derived.index, i) + "\n" + declarationText(src, derived[1]);
  }

  const alias = new RegExp(`\\btype\\s+${esc}\\s*=`).exec(src);
  if (alias) {
    const brace = src.indexOf("{", alias.index + alias[0].length);
    const between = src.slice(alias.index + alias[0].length, brace === -1 ? undefined : brace);
    if (brace !== -1 && /^[\s|&]*$/.test(between)) {
      return src.slice(alias.index, balanced(src, brace, "{", "}") + 1);
    }
    const semi = src.indexOf(";", alias.index);
    return src.slice(alias.index, semi === -1 ? src.length : semi);
  }

  const iface = new RegExp(`\\binterface\\s+${esc}\\b`).exec(src);
  if (iface) {
    const brace = src.indexOf("{", iface.index);
    if (brace !== -1) return src.slice(iface.index, balanced(src, brace, "{", "}") + 1);
  }

  return "";
}

/** Type names a parameter list depends on: `z.infer<typeof X>` and `: X`. */
function referencedTypes(params: string): string[] {
  const names = new Set<string>();
  for (const m of params.matchAll(/typeof\s+(\w+)/g)) names.add(m[1]);
  for (const m of params.matchAll(/:\s*([A-Z]\w+)/g)) names.add(m[1]);
  return [...names];
}

/** Built-ins and framework types that are never a tenant carrier. */
const NOT_A_CARRIER = new Set([
  "FormData", "File", "Blob", "Date", "Promise", "Array", "Record", "Partial",
  "String", "Number", "Boolean", "Buffer", "URL", "Map", "Set", "ReadonlyArray",
]);

/**
 * Resolve a parameter list to the text that decides whether it carries a tenant
 * id: the list itself, plus every local declaration it names, plus one hop
 * through a relative import. Returns the text and anything it could not resolve.
 */
function resolveParams(
  file: string,
  src: string,
  params: string
): { text: string; unresolved: string[] } {
  let text = params;
  const unresolved: string[] = [];

  for (const name of referencedTypes(params)) {
    if (NOT_A_CARRIER.has(name)) continue;

    const local = declarationText(src, name);
    if (local) {
      text += "\n" + local;
      continue;
    }

    // One hop through an import: a relative path, the `@/` alias, or the
    // generated Prisma client. Prisma is resolved rather than exempted on
    // purpose — its ENUMS are string unions and harmless, but its MODEL types
    // (`Lead`, `Project`) really do carry a companyId field, so an action
    // taking one would be exactly the bug this guard is for.
    const imp = new RegExp(
      `import[^;]*\\b${name}\\b[^;]*from\\s*["']([^"']+)["']`,
      "s"
    ).exec(src);

    // `@prisma/client` is answered from prisma/schema.prisma rather than from
    // the generated client: the schema is the source of truth, lives at a fixed
    // path, and does not move when the package manager or Prisma version does.
    // The distinction is the point — an `enum` is a union of strings and cannot
    // carry a tenant, while a `model` (Lead, Project) has a companyId FIELD, so
    // an action typed on one would be precisely the bug this guard exists for.
    if (imp && imp[1] === "@prisma/client") {
      const schema = readFileSync(join(REPO_ROOT, "prisma", "schema.prisma"), "utf8");
      const decl = new RegExp(`^\\s*(model|enum)\\s+${name}\\s*\\{`, "m").exec(schema);
      if (decl) {
        text += "\n" + schema.slice(decl.index, balanced(schema, schema.indexOf("{", decl.index), "{", "}") + 1);
        continue;
      }
    }
    if (imp) {
      const spec = imp[1];
      const bases = spec.startsWith(".")
        ? [join(dirname(file), spec)]
        : spec.startsWith("@/")
          ? [join(REPO_ROOT, "src", spec.slice(2))]
          : [];
      const candidate = bases
        .flatMap((b) => [".ts", ".tsx", ".d.ts", "/index.ts", "/index.tsx"].map((e) => b + e))
        .find((p) => existsSync(p));
      if (candidate) {
        const hop = declarationText(readFileSync(candidate, "utf8"), name);
        if (hop) {
          text += "\n" + hop;
          continue;
        }
      }
    }

    unresolved.push(name);
  }

  return { text, unresolved };
}

describe("server-action boundary", () => {
  const files = SCAN_DIRS.flatMap((d) => walk(join(REPO_ROOT, d)));
  const serverModules = files.filter((f) => isUseServerModule(readFileSync(f, "utf8")));

  it("finds the server-action modules", () => {
    // If the detector broke, the guard below would pass vacuously.
    expect(serverModules.length).toBeGreaterThan(30);
  });

  it("no server action takes a caller-supplied companyId, in any shape", () => {
    const offenders: string[] = [];

    for (const file of serverModules) {
      const rel = relative(REPO_ROOT, file).split(sep).join("/");
      const src = readFileSync(file, "utf8");
      for (const fn of exportedFunctions(src)) {
        if (`${rel}#${fn.name}` in ALLOWED) continue;
        const bare = SCOPE_PARAM.test(fn.params);
        const { text } = resolveParams(file, src, fn.params);
        if (!bare && !SCOPE_PARAM.test(text)) continue;
        offenders.push(
          `${rel}#${fn.name}(${fn.params.replace(/\s+/g, " ").trim()})` +
            (bare ? "" : "  ← via its parameter type, not its parameter list")
        );
      }
    }

    expect(
      offenders,
      `Every export of a "use server" module is a public endpoint, so a tenant id reachable\n` +
        `from its parameter list is caller-controlled — including one declared inside a zod\n` +
        `schema or a named type, which reads as innocent at the call site. Resolve the company\n` +
        `from requireUser() instead, or move the helper into a plain module beside the actions\n` +
        `(see solar/adders.ts).\n\n` +
        `${offenders.join("\n")}\n`
    ).toEqual([]);
  });

  it("resolves parameter types, so the rule above is not passing blind", () => {
    // The whole point of this revision is that almost every action is written
    // `input: z.infer<typeof schema>`. If resolution silently returned nothing,
    // the rule above would be exactly as blind as the version it replaced and
    // just as green. So: it must actually reach schema bodies, and a companyId
    // planted in one must be caught.
    let resolvedSchemas = 0;
    let sample: { file: string; src: string; params: string } | null = null;

    for (const file of serverModules) {
      const src = readFileSync(file, "utf8");
      for (const fn of exportedFunctions(src)) {
        if (!/z\.(infer|input)</.test(fn.params)) continue;
        const { text } = resolveParams(file, src, fn.params);
        if (text.length > fn.params.length + 20) {
          resolvedSchemas++;
          if (!sample) sample = { file, src, params: fn.params };
        }
      }
    }

    expect(resolvedSchemas, "no z.infer parameter type resolved to its schema body").toBeGreaterThan(
      20
    );

    // Positive control on a real one: plant a companyId in the resolved text
    // and confirm the predicate the rule uses would fire.
    expect(sample, "expected at least one z.infer action to sample").not.toBeNull();
    const { text } = resolveParams(sample!.file, sample!.src, sample!.params);
    expect(SCOPE_PARAM.test(text), "the real schema must not already contain companyId").toBe(false);
    expect(SCOPE_PARAM.test(text + "\n  companyId: z.string(),")).toBe(true);
  });

  it("reports any parameter type it could not resolve, rather than assuming it is safe", () => {
    // A type this guard cannot read is not a type it can clear. Resolution is
    // textual and local (plus one relative-import hop), so a type pulled from a
    // package or re-exported through a barrel lands here — and the build asks
    // rather than quietly passing.
    const unknown: string[] = [];
    for (const file of serverModules) {
      const rel = relative(REPO_ROOT, file).split(sep).join("/");
      const src = readFileSync(file, "utf8");
      for (const fn of exportedFunctions(src)) {
        if (`${rel}#${fn.name}` in ALLOWED) continue;
        const { unresolved } = resolveParams(file, src, fn.params);
        for (const u of unresolved) unknown.push(`${rel}#${fn.name} ← ${u}`);
      }
    }

    expect(
      unknown,
      `These parameter types could not be resolved, so this guard cannot say whether they\n` +
        `carry a companyId. Move the type next to the action, add it to NOT_A_CARRIER if it is\n` +
        `a built-in, or allowlist the export with a reason.\n\n${unknown.join("\n")}\n`
    ).toEqual([]);
  });

  it("the module that caused this guard is gone entirely", () => {
    // `solar/storage.ts` and its `storage-queries.ts` split were both deleted
    // when backup went whole-home: the company's list of named load profiles
    // was the only thing either file edited, and a runtime is now derived from
    // the home's own usage instead. The guard above still enforces the rule
    // they taught; this only records that its original offenders are gone
    // rather than merely moved, so nothing reintroduces the file by name.
    for (const rel of [
      "src/server/modules/solar/storage.ts",
      "src/server/modules/solar/storage-queries.ts",
    ]) {
      expect(existsSync(join(REPO_ROOT, rel)), `${rel} was deleted; do not recreate it`).toBe(
        false
      );
    }
  });

  it("every allowlist entry still names a real export", () => {
    for (const key of Object.keys(ALLOWED)) {
      const [rel, name] = key.split("#");
      const src = readFileSync(join(REPO_ROOT, rel), "utf8");
      expect(
        exportedFunctions(src).map((f) => f.name),
        `stale allowlist entry: ${key}`
      ).toContain(name);
    }
  });
});
