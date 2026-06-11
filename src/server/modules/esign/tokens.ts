import crypto from "crypto";

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/** Generates a raw signing token (sent in the link) and its hash (stored in DB). */
export function generateSignerToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("base64url");
  return { raw, hash: sha256(raw) };
}
