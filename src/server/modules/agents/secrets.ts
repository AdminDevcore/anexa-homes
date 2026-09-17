import { prisma } from "@/server/db/client";
import { decryptField } from "@/server/lib/crypto";
import { parseSecretRef, readEnvRef } from "./config-guard";

/**
 * Resolve a secret reference for one run: the only two kinds that exist until
 * the spec's Open question 1 (portal credential storage) is decided.
 *
 * Returns the value or null, never throws: a handler decides what a missing
 * credential means for its run. SolarLender is NOT vertical-scoped (it is
 * absent from server/vertical/models.ts, so the isolation extension leaves it
 * alone) — a company's lender reference resolves the same from either
 * workspace. What scopes it here is the explicit `companyId` on the query
 * below, not the active vertical.
 */
export async function resolveSecretRef(companyId: string, ref: string): Promise<string | null> {
  const parsed = parseSecretRef(ref);
  if (!parsed) return null;
  if (parsed.kind === "env") return readEnvRef(parsed.name, process.env);

  try {
    const lender = await prisma.solarLender.findFirst({
      where: { id: parsed.lenderId, companyId },
      select: { apiKeyEncrypted: true },
    });
    return decryptField(lender?.apiKeyEncrypted ?? null, "lender api key");
  } catch {
    return null;
  }
}
