import fs from "node:fs";
import type { Browser } from "puppeteer-core";
import { mintPrintSignature } from "./print-signature";

/**
 * The approved proposal, rendered to paper.
 *
 * WHY A BROWSER AND NOT A PDF LIBRARY. The thing being filed is "the copy of
 * what was sold", and the only definition of that which stays true is *the
 * document itself*. A hand-drawn PDF is a second document: it agrees with the
 * proposal on the day it is written and diverges from it on the day either one
 * is edited, silently, in a file nobody re-opens until a dispute. Rendering the
 * real page means the filed copy cannot disagree with what the customer saw,
 * because it IS what the customer saw.
 *
 * It also means no new print CSS. `globals.css` already carries the page box,
 * the zero margin and the `print-color-adjust` rules, all of them debugged
 * against this exact document and covered by e2e/solar-proposal-print.spec.ts.
 */

/** Letter portrait, matching the `@page` rule the document already sets. */
const NAV_TIMEOUT_MS = 45_000;

/**
 * Where the render should point its browser.
 *
 * The server is fetching its own page, so this has to be an absolute URL that
 * resolves from inside the runtime. `NEXT_PUBLIC_APP_URL` is the one the send
 * action already relies on for customer links; VERCEL_URL is the per-deployment
 * fallback for a preview build that has no custom domain configured.
 */
function baseUrl(): string {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  if (configured) return configured;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://127.0.0.1:3000";
}

/** Are we inside a serverless runtime with no Chrome of its own? */
function isServerless(): boolean {
  return !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/**
 * Where to find a browser binary.
 *
 * TWO ENVIRONMENTS, and they need different answers. A serverless function has
 * no Chrome installed, so `@sparticuz/chromium` ships one built for it. A
 * developer's machine has a perfectly good Chrome already and downloading a
 * second, Lambda-flavoured one that will not execute on macOS helps nobody.
 */
async function launch(): Promise<Browser> {
  const puppeteer = (await import("puppeteer-core")).default;

  if (isServerless()) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1280, height: 1696 },
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

  const executablePath = localChrome();
  if (!executablePath) {
    throw new Error(
      "No local Chrome found. Set PUPPETEER_EXECUTABLE_PATH to a Chrome or Chromium binary."
    );
  }
  return puppeteer.launch({
    executablePath,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    defaultViewport: { width: 1280, height: 1696 },
    headless: true,
  });
}

function localChrome(): string | null {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (fromEnv) return fromEnv;

  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

/**
 * Render one proposal to PDF bytes.
 *
 * Throws on any failure, and the caller is expected to treat that as "the copy
 * was not filed" rather than "the approval failed" — see
 * setProposalApprovalAction.
 */
export async function renderProposalPdf(proposalId: string): Promise<Buffer> {
  const url = `${baseUrl()}/proposal/print/${mintPrintSignature(proposalId)}`;

  let browser: Browser | null = null;
  try {
    browser = await launch();
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

    const response = await page.goto(url, { waitUntil: "networkidle0" });
    if (!response || !response.ok()) {
      // A 404 here means the signature did not resolve — an expired mint, or a
      // deployment whose AUTH_SECRET differs from the one that signed it.
      throw new Error(`The print page returned ${response?.status() ?? "no response"}.`);
    }

    // The document's own web fonts, not the fallback stack. Without this the
    // first render can beat the font load and file a proposal set in Times.
    await page.evaluate(() => document.fonts.ready);

    await page.emulateMediaType("print");

    const pdf = await page.pdf({
      // preferCSSPageSize, NOT `format: "Letter"`. Passing a format OVERRIDES
      // the document's `@page` box — which is where the zero margin lives, and
      // the zero margin is the only thing stopping Chrome printing the date and
      // the full URL along the edge of a customer's proposal. A `format` here
      // renders something that looks fine in isolation and is not the document.
      preferCSSPageSize: true,
      // Chrome's "Background graphics" is off by default, and every dark
      // chapter in this document is white type on a dark ground. Without this
      // the money chapter files as a blank page.
      printBackground: true,
      // No header, no footer. The document supplies its own inset.
      displayHeaderFooter: false,
    });

    return Buffer.from(pdf);
  } finally {
    await browser?.close().catch(() => {});
  }
}
