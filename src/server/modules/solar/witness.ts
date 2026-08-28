import crypto from "node:crypto";

/**
 * Proof that a signature was taken on a rep's device, in front of them.
 *
 * A homeowner signing at the kitchen table and a homeowner signing at midnight
 * from their own phone are both the customer's signature, and both are valid —
 * but they are different claims, and a certificate that cannot tell them apart
 * is a certificate making the weaker one silently. So an in-person session
 * carries a token, and only a session that arrived with a valid one is recorded
 * as in person.
 *
 * WHY A SIGNED TOKEN AND NOT A FLAG. The accept endpoint is public: the share
 * token is its only authorization, and anything the browser can simply assert
 * there can be asserted by anyone holding the link. A boolean in the request
 * body would let the customer's own phone claim a rep was standing next to
 * them. This is minted server-side by an authenticated rep, names both the
 * proposal and the rep, and cannot be produced anywhere else.
 *
 * Shaped like `print-signature.ts` and deliberately NOT shared with it. Both
 * are HMACs over a payload with an expiry and there the resemblance stops: that
 * one authorises our own renderer to READ one document, this one attributes a
 * WRITE to a named user. Folding them into one helper would mean a signature
 * minted for a render could be replayed as a witness, which is exactly the
 * confusion the separate secret domain below prevents.
 */

/** How long a witness token stays good. One appointment, generously. */
const TTL_MS = 4 * 60 * 60 * 1000;

/**
 * Domain separation. Concatenated into the MAC input so a token minted for any
 * other purpose in this application — a print signature, a share link — cannot
 * be presented here and verify.
 */
const PURPOSE = "solar-proposal-witness.v1";

function secret(): string {
  const s = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!s) {
    throw new Error("AUTH_SECRET is not set, so an in-person signing token cannot be signed.");
  }
  return s;
}

function mac(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(`${PURPOSE}.${payload}`).digest("base64url");
}

/** A witness token naming this proposal and the rep hosting the session. */
export function mintWitness(proposalId: string, userId: string, now = Date.now()): string {
  const payload = `${proposalId}.${userId}.${now + TTL_MS}`;
  return Buffer.from(`${payload}.${mac(payload)}`, "utf8").toString("base64url");
}

/**
 * The rep a witness token names, or null.
 *
 * Takes the proposal id it is being presented FOR and checks it matches, so a
 * token minted for one deal cannot mark another deal's signature as witnessed.
 *
 * Null for every failure — malformed, expired, wrong proposal, forged — because
 * the caller's job is to fall back to recording an ordinary remote signature,
 * not to reject the signature. A homeowner who has just signed must never be
 * told "no" because a token expired; they signed, and the record should say so
 * in the weaker, provable form.
 */
export function readWitness(
  token: string | null | undefined,
  proposalId: string,
  now = Date.now()
): string | null {
  if (!token) return null;

  let decoded: string;
  try {
    decoded = Buffer.from(token, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const parts = decoded.split(".");
  if (parts.length !== 4) return null;
  const [id, userId, expiryRaw, given] = parts;
  if (!id || !userId || !expiryRaw || !given) return null;
  if (id !== proposalId) return null;

  const expiry = Number(expiryRaw);
  if (!Number.isFinite(expiry) || expiry <= now) return null;

  let expected: string;
  try {
    expected = mac(`${id}.${userId}.${expiry}`);
  } catch {
    return null;
  }

  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  return userId;
}
