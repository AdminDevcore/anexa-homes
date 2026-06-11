import type { DocumentEventType, Prisma, PrismaClient } from "@prisma/client";
import { sha256 } from "./tokens";

type Db = PrismaClient | Prisma.TransactionClient;

type AppendArgs = {
  companyId: string;
  packageId: string;
  type: DocumentEventType;
  signerId?: string | null;
  actor?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  data?: Record<string, unknown>;
};

/**
 * Appends an immutable, hash-chained audit event. Each event's hash is
 * sha256(prevHash + canonical(event)), so altering any past event breaks the chain.
 * Audit events are never updated or deleted.
 */
export async function appendDocumentEvent(db: Db, args: AppendArgs) {
  const last = await db.documentEvent.findFirst({
    where: { packageId: args.packageId },
    orderBy: { createdAt: "desc" },
    select: { metadata: true },
  });

  const prevHash =
    (last?.metadata as { hash?: string } | null)?.hash ?? "GENESIS";

  const canonical = JSON.stringify({
    prevHash,
    type: args.type,
    signerId: args.signerId ?? null,
    actor: args.actor ?? null,
    ip: args.ip ?? null,
    userAgent: args.userAgent ?? null,
    data: args.data ?? {},
  });
  const hash = sha256(canonical);

  return db.documentEvent.create({
    data: {
      companyId: args.companyId,
      packageId: args.packageId,
      signerId: args.signerId ?? null,
      type: args.type,
      actor: args.actor ?? null,
      ip: args.ip ?? null,
      userAgent: args.userAgent ?? null,
      metadata: { ...(args.data ?? {}), prevHash, hash },
    },
  });
}

/** Recomputes the chain and reports whether the stored hashes are intact. */
export function verifyChain(
  events: { type: string; signerId: string | null; actor: string | null; ip: string | null; userAgent: string | null; metadata: unknown }[]
): boolean {
  let prevHash = "GENESIS";
  for (const e of events) {
    const meta = (e.metadata as { hash?: string; prevHash?: string; [k: string]: unknown }) ?? {};
    const { hash: storedHash, prevHash: _p, ...data } = meta;
    const canonical = JSON.stringify({
      prevHash,
      type: e.type,
      signerId: e.signerId ?? null,
      actor: e.actor ?? null,
      ip: e.ip ?? null,
      userAgent: e.userAgent ?? null,
      data,
    });
    if (sha256(canonical) !== storedHash) return false;
    prevHash = storedHash;
  }
  return true;
}
