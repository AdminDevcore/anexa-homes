import { prisma } from "@/server/db/client";
import { objectExists } from "@/server/storage";
import { DESIGNER_LAYOUT_FILENAME } from "@/lib/solar-layout";

/** The folder key a panel layout is filed under. See lib/deal-folders.ts. */
export const LAYOUT_CATEGORY = "solar_layout";

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

/**
 * Drop the drawings this deal has outgrown.
 *
 * The designer re-renders its picture of the array on every save and files it
 * as a new FileAsset, then points the design at it. Nothing ever pointed at the
 * one before, so a roof drawn eight times left eight near-identical aerials
 * sitting on the deal — the second half of the bug that also put them all in
 * "Other".
 *
 * THREE THINGS ARE NEVER SWEPT:
 *
 *  1. `keepFileId` — the drawing the design points at now.
 *  2. Anything a proposal froze into its snapshot. `serveLayoutImage` reads the
 *     file row by the id in `snapshot.layout.fileId`, so deleting the row takes
 *     the picture off a link a homeowner may already be looking at. Drafts are
 *     protected too: an unsent version can still be sent.
 *  3. Anything not named `DESIGNER_LAYOUT_FILENAME` — that is a rep's own
 *     upload from Aurora or the like, and replacing it is not permission to
 *     throw it away.
 *
 * Row-only, matching `removeFiledCopies` and `deleteFileAction`: the stored
 * object stays. A prune we get wrong should cost a database row, never bytes.
 *
 * Returns how many rows went, and never throws — a failed cleanup must not
 * cost the rep the save that triggered it.
 */
export async function pruneSupersededLayouts(
  companyId: string,
  leadId: string,
  keepFileId: string,
): Promise<number> {
  try {
    const candidates = await prisma.fileAsset.findMany({
      where: {
        companyId,
        leadId,
        kind: "photo",
        category: LAYOUT_CATEGORY,
        name: DESIGNER_LAYOUT_FILENAME,
        id: { not: keepFileId },
      },
      select: { id: true },
    });
    if (candidates.length === 0) return 0;

    // One count per candidate rather than one query loading every snapshot:
    // a snapshot is several hundred kilobytes and there are usually one or two
    // candidates. Asking the database the narrow question is far cheaper than
    // pulling the documents across to answer it here.
    const doomed: string[] = [];
    for (const { id } of candidates) {
      const frozen = await prisma.solarProposal.count({
        where: { companyId, leadId, snapshot: { path: ["layout", "fileId"], equals: id } },
      });
      if (frozen === 0) doomed.push(id);
    }
    if (doomed.length === 0) return 0;

    const { count } = await prisma.fileAsset.deleteMany({
      where: { companyId, leadId, id: { in: doomed } },
    });
    return count;
  } catch {
    return 0;
  }
}
