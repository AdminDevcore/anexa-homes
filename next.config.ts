import type { NextConfig } from "next";

// Baseline security headers applied to every response. CSP is intentionally
// omitted here (Next inlines styles/scripts that need a nonce-based policy);
// add a nonce CSP via middleware when ready to tighten further.
const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
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
  serverExternalPackages: ["@aws-sdk/client-s3", "sharp"],
  experimental: {
    // Uploads (photos, training files, videos) go through Server Actions; raise
    // the 1MB default well above it. Photos compress server-side after arriving;
    // training videos can be large, so this caps the biggest expected upload.
    serverActions: { bodySizeLimit: "250mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
