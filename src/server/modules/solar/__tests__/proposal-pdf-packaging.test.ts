import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../../../../next.config";

/**
 * The browser has to actually be inside the deployed function.
 *
 * Rendering the approved proposal is the only thing in the app that boots
 * Chrome, and a serverless runtime has none installed — `@sparticuz/chromium`
 * carries its own, as ~68MB of brotli payloads sitting in the package's `bin`
 * folder. Next's file tracer follows `import` and `require` and nothing else,
 * so those payloads are invisible to it. The JavaScript shipped, the browser
 * did not, and the first approval in production came back "Copy not filed"
 * with `The input directory ".../@sparticuz/chromium/bin" does not exist`.
 *
 * `outputFileTracingIncludes` is what carries them, and it is two strings in a
 * config file: nothing type-checks a glob, and no page renders one. It can rot
 * silently through a chromium upgrade, a package-manager change or a route
 * rename, and the next thing to notice would be a customer waiting on a
 * proposal. These assertions notice instead.
 */

const projectRoot = path.resolve(__dirname, "../../../../..");
const req = createRequire(path.join(projectRoot, "next.config.ts"));

type Picomatch = (pattern: string, opts: object) => (input: string) => boolean;
type GlobCb = (
  pattern: string,
  opts: object,
  cb: (err: Error | null, files: string[]) => void,
) => void;

// Next's own matcher and globber, not lookalikes from npm. The point of the
// test is that Next resolves these strings the way we think it does.
const picomatch = req("next/dist/compiled/picomatch") as Picomatch;
const glob = req("next/dist/compiled/glob") as GlobCb;

/** The route whose function needs the browser. */
const ROUTE = "/api/solar/proposals/[id]/file-copy";

/** Exactly the options collect-build-traces.ts passes. */
const matchRoute = (key: string) => picomatch(key, { dot: true, contains: true })(ROUTE);
const expand = (pattern: string) =>
  new Promise<string[]>((resolve, reject) =>
    glob(pattern, { cwd: projectRoot, nodir: true, dot: true }, (err, files) =>
      err ? reject(err) : resolve(files),
    ),
  );

const includes = nextConfig.outputFileTracingIncludes ?? {};

describe("the render route carries a browser", () => {
  it("aims its includes at the route that boots one, and at nothing else", () => {
    const keys = Object.keys(includes);
    expect(keys.length).toBeGreaterThan(0);

    const aimed = keys.filter(matchRoute);
    expect(aimed).toHaveLength(1);

    // A literal `[id]` here would be a picomatch character class matching a
    // single "i" or "d", not the dynamic segment. Whatever key is used must
    // survive that, and must not rope in the neighbouring routes — each match
    // is another function paying 68MB for a browser it never launches.
    const bystanders = ["/api/solar/lender-logo", "/api/solar/equipment-photo", "/portal/leads/[id]"];
    for (const other of bystanders) {
      expect(picomatch(aimed[0]!, { dot: true, contains: true })(other)).toBe(false);
    }
  });

  it("resolves to the brotli payloads chromium inflates", async () => {
    const aimed = Object.keys(includes).filter(matchRoute);
    const patterns = includes[aimed[0]!] as string[];
    const files = (await Promise.all(patterns.map(expand))).flat();

    // executablePath() inflates the first three unconditionally and al2023 on
    // an Amazon Linux 2023 runtime, which is what Vercel runs.
    for (const payload of ["chromium.br", "fonts.tar.br", "swiftshader.tar.br", "al2023.tar.br"]) {
      expect(files.some((f) => f.endsWith(`/${payload}`))).toBe(true);
    }
  });

  it("puts them where the package looks at runtime, not beside a symlink", async () => {
    const aimed = Object.keys(includes).filter(matchRoute);
    const patterns = includes[aimed[0]!] as string[];
    const files = (await Promise.all(patterns.map(expand))).flat();

    // Chromium finds its own `bin` from `import.meta.url`, which Node has
    // already resolved through symlinks. Under pnpm that is the store path
    // (node_modules/.pnpm/@sparticuz+chromium@<version>/…), NOT the pretty
    // node_modules/@sparticuz/chromium one — the production error named the
    // store path. Filing the payloads under the pretty path would deploy a
    // browser to a directory nothing ever reads.
    const runtimeBin = path.join(
      path.dirname(realpathSync(req.resolve("@sparticuz/chromium"))),
      "..",
      "bin",
    );
    expect(existsSync(runtimeBin)).toBe(true);

    for (const file of files) {
      expect(path.dirname(path.resolve(projectRoot, file))).toBe(path.resolve(runtimeBin));
    }
  });
});
