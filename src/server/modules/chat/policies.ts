import type { Role } from "@prisma/client";
import { isStaff } from "@/server/rbac/matrix";

/**
 * Chat participation rules:
 *  - Staff only (customers are never part of internal chat).
 *  - The single blocked DIRECT pairing is sales_rep <-> sales_rep.
 *  - Channels may contain multiple reps (the rep<->rep block is a DM rule),
 *    so this only governs 1:1 DMs.
 */
export function canDmPair(a: Role, b: Role): boolean {
  if (!isStaff(a) || !isStaff(b)) return false;
  if (a === "sales_rep" && b === "sales_rep") return false;
  return true;
}

/** Deterministic key so a DM between two users is unique regardless of order. */
export function dmKeyFor(userA: string, userB: string): string {
  return [userA, userB].sort().join(":");
}
