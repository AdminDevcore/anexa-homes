import type { prisma } from "./client";

/**
 * Anything you can run a model query against: the app's extended Prisma client,
 * or the transaction client handed to `prisma.$transaction(async (tx) => …)`.
 *
 * Both carry the vertical-isolation extension — the transaction client inherits
 * it — so a helper typed `Db` is scoped identically whether it is called inside
 * or outside a transaction. (Proven by the $transaction cases in
 * src/server/vertical/__tests__/isolation.itest.ts.)
 *
 * The transaction client is the full client minus the operations that cannot be
 * nested inside a transaction, which is what the Omit below expresses.
 */
export type Db =
  | typeof prisma
  | Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;
