"use server";

import { lookup } from "dns/promises";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { putObject } from "@/server/storage";
import { pickLogoCandidates, parseHttpUrl, isBlockedAddress, type LogoCandidate } from "@/lib/logo-source";

const fail = (error: string) => ({ ok: false as const, error });

/** Logos are small. Anything larger is a photograph somebody picked by mistake. */
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);
/** SVG is refused on purpose — the same XSS reasoning as the company logo. */

/** How far a fetch is allowed to go before we stop waiting on someone's server. */
const FETCH_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = MAX_BYTES;

/**
 * Normalise whatever we were given into the one shape everything renders.
 *
 * `fit: "inside"` never crops: a wordmark that gets centre-cropped to a square
 * loses the word, and half a lender's name in a proposal is worse than no logo
 * at all. PNG keeps transparency, so a mark drops onto a card or a printed page
 * without a white box around it.
 */
async function normalise(raw: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(raw)
      .rotate()
      .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

/** Store the bytes and point the lender at them. */
async function store(companyId: string, lenderId: string, png: Buffer) {
  const key = `companies/${companyId}/solar/lenders/${nanoid()}.png`;
  await putObject(key, png);
  await prisma.solarLender.update({
    where: { id: lenderId },
    data: { logoKey: key, logoUpdatedAt: new Date() },
  });
  revalidatePath("/portal/settings/solar-lenders");
}

/** The lender, scoped to the caller's company. Null means "not yours". */
async function ownedLender(companyId: string, id: string) {
  return prisma.solarLender.findFirst({
    where: { companyId, id },
    select: { id: true, name: true, portalUrl: true, applyUrl: true, logoKey: true },
  });
}

/**
 * Upload a logo for one lender.
 *
 * Deliberately not a FileAsset row like the company logo is: `files` has no
 * lender column, so tying one to a partner would mean smuggling the id into the
 * category string, and the logo would then show up in Documents as a mystery
 * image. The bytes still go through the storage driver either way.
 */
export async function uploadSolarLenderLogoAction(
  lenderId: string,
  formData: FormData
): Promise<{ ok: true; logoUpdatedAt: number } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");

  const lender = await ownedLender(user.companyId, lenderId);
  if (!lender) return fail("Not found.");

  const file = formData.get("file");
  if (!(file instanceof File)) return fail("No file provided.");
  if (file.size > MAX_BYTES) return fail("Logo too large (max 5MB).");
  if (!ALLOWED.has(file.type)) return fail("Use a PNG, JPG, or WebP image.");

  const png = await normalise(Buffer.from(await file.arrayBuffer()));
  if (!png) return fail("Could not read that image.");

  await store(user.companyId, lenderId, png);
  return { ok: true, logoUpdatedAt: Date.now() };
}

/** Forget the logo. The row keeps working; it just goes back to a monogram. */
export async function removeSolarLenderLogoAction(
  lenderId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");

  const lender = await ownedLender(user.companyId, lenderId);
  if (!lender) return fail("Not found.");

  // The object itself is left in storage rather than deleted: a proposal issued
  // last month may still be pointing at it, and an image 404 inside a document a
  // customer already has is a worse outcome than an orphaned file.
  await prisma.solarLender.update({
    where: { id: lenderId },
    data: { logoKey: null, logoUpdatedAt: null },
  });
  revalidatePath("/portal/settings/solar-lenders");
  return { ok: true };
}

/**
 * Fetch one URL, with the guards that make fetching a supplied URL reasonable.
 *
 * The host is resolved first and the resulting address checked, so a hostname
 * that points at localhost or at a cloud metadata endpoint is refused before a
 * connection is opened. Redirects are followed manually for the same reason: a
 * public URL that 302s to 169.254.169.254 would otherwise walk straight past
 * the check we just did.
 */
async function safeFetch(url: URL, accept: string, maxBytes: number, hops = 3): Promise<
  { ok: true; body: Buffer; contentType: string; url: URL } | { ok: false; error: string }
> {
  let target = url;
  for (let hop = 0; hop <= hops; hop++) {
    let addresses;
    try {
      addresses = await lookup(target.hostname, { all: true });
    } catch {
      return { ok: false, error: `Could not resolve ${target.hostname}.` };
    }
    if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a.address))) {
      return { ok: false, error: "That address is not reachable from here." };
    }

    let res: Response;
    try {
      res = await fetch(target, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          accept,
          // Some sites serve a stripped page to an unidentified client. Being
          // honest about who is asking gets the real markup back.
          "user-agent": "Mozilla/5.0 (compatible; AnexaCRM-LogoFetch/1.0)",
        },
      });
    } catch {
      return { ok: false, error: "That site did not respond." };
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      const next = location ? parseHttpUrl(new URL(location, target).toString()) : null;
      if (!next) return { ok: false, error: "That site redirected somewhere we cannot follow." };
      target = next;
      continue;
    }
    if (!res.ok) return { ok: false, error: `That site answered ${res.status}.` };

    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) return { ok: false, error: "That file is too large." };
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > maxBytes) return { ok: false, error: "That file is too large." };

    return { ok: true, body, contentType: res.headers.get("content-type") ?? "", url: target };
  }
  return { ok: false, error: "That site redirected too many times." };
}

/**
 * Pull a lender's logo off the lender's own website.
 *
 * Most of these partners are already publishing a perfectly good mark — in the
 * tab icon, in the icon a phone uses for a home-screen shortcut, in the card
 * that appears when the URL is pasted into a chat. This reads those, tries them
 * best-first, and keeps the first one that is actually an image. An admin
 * hunting down a PNG for eight banks is the alternative.
 *
 * The URL defaults to the links already on the lender — the customer
 * application first, since that is the partner's own consumer-facing site.
 */
export async function fetchSolarLenderLogoAction(
  lenderId: string,
  urlOverride?: string | null
): Promise<{ ok: true; source: string; from: string; logoUpdatedAt: number } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");

  const lender = await ownedLender(user.companyId, lenderId);
  if (!lender) return fail("Not found.");

  const raw = urlOverride?.trim() || lender.applyUrl || lender.portalUrl;
  if (!raw) {
    return fail(
      "No website to look at. Add the lender's application or portal link first, or type a website above."
    );
  }
  const site = parseHttpUrl(raw);
  if (!site) return fail("That does not look like a website address.");

  const page = await safeFetch(site, "text/html,application/xhtml+xml", MAX_HTML_BYTES);
  if (!page.ok) return fail(page.error);

  const candidates = pickLogoCandidates(page.body.toString("utf8"), page.url.toString());

  const tried: string[] = [];
  for (const candidate of candidates.slice(0, 6)) {
    const url = parseHttpUrl(candidate.url);
    if (!url) continue;
    tried.push(candidate.source);
    const img = await safeFetch(url, "image/*", MAX_IMAGE_BYTES);
    if (!img.ok) continue;
    // An HTML error page served with a 200 is a common answer to an icon
    // request; sharp would fail on it anyway, but skipping early is cheaper.
    if (img.contentType.includes("text/html")) continue;
    const png = await normalise(img.body);
    if (!png) continue;

    await store(user.companyId, lenderId, png);
    return {
      ok: true,
      source: describe(candidate),
      from: url.hostname,
      logoUpdatedAt: Date.now(),
    };
  }

  return fail(
    tried.length === 0
      ? `${site.hostname} does not publish a logo we can read. Upload one instead.`
      : `Found ${tried.length} image${tried.length === 1 ? "" : "s"} on ${site.hostname} but none could be read. Upload one instead.`
  );
}

/** What the admin is told we took, in words rather than in markup names. */
function describe(c: LogoCandidate): string {
  switch (c.source) {
    case "apple-touch-icon":
      return "their home-screen icon";
    case "icon":
    case "favicon.ico":
      return "their site icon";
    case "og:image":
    case "twitter:image":
      return "their link-preview image";
  }
}
