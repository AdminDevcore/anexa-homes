import crypto from "node:crypto";

/**
 * A short-lived signature that lets our OWN headless browser read one proposal.
 *
 * The proposal document already has two doors and the PDF renderer can walk
 * through neither of them. The portal preview needs a session cookie, and a
 * server rendering its own page has none to offer. `/proposal/[token]` needs
 * the share token, which is minted on SEND — and the whole point of approving a
 * version is to record which one was sold, which routinely happens before, or
 * without, a send. An approved-but-unsent proposal has no token at all.
 *
 * So: a third door, shaped exactly like the second. A signature stands where
 * the share token stands, and carries the same contract — it names ONE proposal
 * and unlocks nothing but that proposal's own frozen snapshot.
 *
 * What it is deliberately NOT:
 *
 *  - Not a session. It authorises reading one document, not acting as anybody.
 *    Nothing behind it can write.
 *  - Not a file id, a lead id or a coordinate. Every one of those would turn a
 *    valid signature into a general-purpose proxy for somebody else's photos or
 *    for satellite imagery billed to this company. The routes take the id out
 *    of the signature and read the rest from the row.
 *  - Not long-lived. Five minutes is far more than a render needs and far less
 *    than a leaked URL in a log is worth.
 */

/** How long a minted signature stays valid. A render takes seconds. */
const TTL_MS = 5 * 60 * 1000;

function secret(): string {
  const s = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!s) {
    // Refusing beats falling back to a constant. A predictable key here is a
    // publicly guessable URL to every proposal in the database.
    throw new Error("AUTH_SECRET is not set, so a print signature cannot be signed.");
  }
  return s;
}

function mac(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

/**
 * A signature for `proposalId`, valid for the next five minutes.
 *
 * One path segment, so the print routes have the same shape as the token ones
 * and `siteImageBase` can be handed a prefix exactly as it is on the public
 * page.
 */
export function mintPrintSignature(proposalId: string, now = Date.now()): string {
  const expiry = now + TTL_MS;
  const payload = `${proposalId}.${expiry}`;
  return Buffer.from(`${payload}.${mac(payload)}`, "utf8").toString("base64url");
}

/**
 * The proposal id a signature names, or null.
 *
 * Null for every failure — malformed, expired, tampered with, signed by a
 * different secret — because the caller's job is to 404, and telling the
 * difference between "expired" and "forged" only helps whoever is probing.
 *
 * The MAC is compared with `timingSafeEqual`. A byte-at-a-time comparison here
 * leaks the signature one character per request, which is the whole attack
 * against a scheme like this.
 */
export function readPrintSignature(sig: string, now = Date.now()): string | null {
  if (!sig) return null;

  let decoded: string;
  try {
    decoded = Buffer.from(sig, "base64url").toString("utf8");
  } catch {
    return null;
  }

  // Exactly three parts. An id containing a dot would split into more, and
  // rather than tolerate that we simply never mint one — ids are uuids.
  const parts = decoded.split(".");
  if (parts.length !== 3) return null;
  const [proposalId, expiryRaw, given] = parts;
  if (!proposalId || !expiryRaw || !given) return null;

  const expiry = Number(expiryRaw);
  if (!Number.isFinite(expiry) || expiry <= now) return null;

  let expected: string;
  try {
    expected = mac(`${proposalId}.${expiry}`);
  } catch {
    return null;
  }

  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  return proposalId;
}
