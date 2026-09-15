import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { NextConfig } from "next";

/**
 * Where the Lambda-flavoured browser keeps its brotli payloads, as a path
 * relative to the project root.
 *
 * WHY THIS EXISTS AT ALL. `serverExternalPackages` below stops the bundler
 * relocating `@sparticuz/chromium`, and that much works — but Next's file
 * tracer follows `import` and `require` and nothing else, and the ~68MB of
 * compressed browser in the package's `bin` folder is reached by a path the
 * package builds from `import.meta.url` at runtime. No import points at it, so
 * the tracer never saw it, so Vercel never uploaded it, and every approval in
 * production came back "Copy not filed" with `The input directory
 * ".../@sparticuz/chromium/bin" does not exist`. The JavaScript had shipped
 * without the browser it drives.
 *
 * WHY IT IS RESOLVED AND NOT TYPED OUT. `require.resolve` returns the path
 * Node itself resolved, symlinks and all — under pnpm the store entry,
 * `node_modules/.pnpm/@sparticuz+chromium@<version>/…`, which is exactly the
 * directory the error named and exactly where the package will look again.
 * The tidier-looking `node_modules/@sparticuz/chromium/bin` is a symlink into
 * that store; filing 68MB of browser against it would deploy the payloads to a
 * directory nothing ever reads, and fail in precisely the same way.
 */
function chromiumPayloadDir(): string {
  const resolveFrom = createRequire(path.join(process.cwd(), "next.config.ts"));
  const bin = path.join(path.dirname(resolveFrom.resolve("@sparticuz/chromium")), "..", "bin");
  if (!existsSync(bin)) {
    // Loud here, because the alternative is quiet in production. A build that
    // cannot find the browser produces a proposal route that cannot render.
    throw new Error(
      `@sparticuz/chromium has no bin directory at ${bin}. The proposal PDF route ` +
        "cannot render without it — reinstall dependencies before building.",
    );
  }
  return path.relative(process.cwd(), bin).split(path.sep).join("/");
}

// Baseline security headers applied to every response. CSP is intentionally
// omitted here (Next inlines styles/scripts that need a nonce-based policy);
// add a nonce CSP via middleware when ready to tighten further.
const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  // microphone=(self): Nova's push-to-talk records on our own origin only.
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(self)" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Move the dev indicator off the bottom-left so it doesn't overlap the portal
  // sidebar's support pill (dev-only badge).
  devIndicators: { position: "bottom-right" },
  // Allow the E2E server to use a separate build dir so it never clashes with the
  // dev server's `.next` (set NEXT_DIST_DIR=.next-e2e for the test webServer).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Keep the AWS SDK out of the bundle/trace; it's loaded on demand server-side.
  // Kept out of the bundle/trace; all three are loaded on demand server-side.
  // Chromium in particular ships a ~50MB brotli-packed browser that Next must
  // not try to walk into — and puppeteer-core resolves its own binaries at
  // runtime, which a bundler cannot follow.
  serverExternalPackages: [
    "@aws-sdk/client-s3",
    "sharp",
    "puppeteer-core",
    "@sparticuz/chromium",
  ],
  // The browser, carried into exactly one function.
  //
  // Keyed with `*` rather than the literal `[id]`: Next matches these keys with
  // picomatch, where `[id]` is a character class matching a single "i" or "d",
  // not a dynamic segment. Every route this key matches pays the 68MB, so it is
  // deliberately narrow — file-copy is the only route that boots a browser.
  outputFileTracingIncludes: {
    "/api/solar/proposals/*/file-copy": [`${chromiumPayloadDir()}/*.br`],
  },
  experimental: {
    // Uploads (photos, training files, videos) go through Server Actions; raise
    // the 1MB default well above it. Photos compress server-side after arriving;
    // training videos can be large, so this caps the biggest expected upload.
    serverActions: { bodySizeLimit: "250mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    return [
      // Retired service pages. These URLs were live and indexed, so send their
      // traffic to the closest current page instead of 404-ing.
      { source: "/storm-restoration", destination: "/roofing", permanent: true },
      { source: "/insurance-claims", destination: "/roofing", permanent: true },
    ];
  },
};

export default nextConfig;
