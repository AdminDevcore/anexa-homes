import { prisma } from "@/server/db/client";
import { objectExists } from "@/server/storage";

/**
 * Is this layout actually renderable, right now?
 *
 * Three things have to be true, and they fail independently:
 *   1. the design points at a file id at all;
 *   2. a FileAsset row with that id still exists on THIS deal (a rep can delete
 *      an upload from Documents without knowing the proposal points at it);
 *   3. the bytes are still in storage (a bucket lifecycle rule, a database
 *      restored without its objects, a wiped local tree).
 *
 * Returns null on any of them. Callers omit the whole panel-layout section
 * rather than emitting an <img> that resolves to a broken-image icon in front
 * of a homeowner — which is what checking only (2) would have given us.
 *
 * Read-only. It never deletes the FileAsset and never clears the design's
 * reference: the file may be coming back (a restore in progress), and silently
 * unlinking a rep's upload because storage hiccuped would destroy work nobody
 * asked us to touch. Clearing it is the rep's call, through Remove.
 *
 * Deliberately NOT in actions.ts or proposal-actions.ts: every export of a
 * "use server" module is a callable endpoint, and this takes `companyId` and
 * returns a storage key. Exported from there it would let anyone probe any
 * company's files. Callers pass the id they already resolved from the session.
 */
export async function resolveLayoutAsset(
  companyId: string,
  leadId: string,
  fileId: string | null | undefined
): Promise<{ id: string; storageKey: string } | null> {
  if (!fileId) return null;
  const file = await prisma.fileAsset.findFirst({
    where: { id: fileId, companyId, leadId, kind: "photo" },
    select: { id: true, storageKey: true },
  });
  if (!file) return null;
  return (await objectExists(file.storageKey)) ? file : null;
}
