/**
 * One-off: put every photo already taken against a checklist slot into the
 * folder it belongs in, under the slot's own label.
 *
 * Until now the uploaders sent `category = the slot's LABEL` — "Front of the
 * house — full view of property" — which is not a folder key in either
 * vertical. `folderKeyFor` does not recognise it, so every one of these photos
 * fell into "Other" while the Survey Photos and Installation Photos folders sat
 * at 0 with the checklist beside them full. The checklist taken from the JOB
 * also sent no `leadId` at all, so those photos were in no folder whatsoever:
 * the deal's folder grid lists the DEAL's files.
 *
 * `uploadFileAction` gets all three right from now on. This walks the photos
 * taken before it did.
 *
 * WHAT IT TOUCHES: only files carrying a `photoTemplateItemId`. A photo without
 * one was never shot against a slot — it was dropped into a folder by hand, and
 * whatever folder and name it was given is the answer, not something to
 * overwrite.
 *
 * WHAT IT DOES NOT TOUCH: `storageKey`. The bytes stay exactly where they are;
 * only the row's name, category and leadId change. Nothing reads a file by the
 * name inside its key.
 *
 * NAMES are numbered per slot in upload order, matching what the action now
 * writes for a slot holding several shots: "Full roof - each slope",
 * "Full roof - each slope (2)", and so on.
 *
 *   npx tsx scripts/refile-checklist-photos.ts            # report only, writes nothing
 *   npx tsx scripts/refile-checklist-photos.ts --apply    # refile them
 *
 * DATABASE_URL must point at the environment you mean.
 */
import { PrismaClient } from "@prisma/client";
import { photoGroupFor } from "../src/lib/photo-groups";

/**
 * A PLAIN client, not `@/server/db/client`.
 *
 * The extended one enforces the vertical scope from async-local storage, which
 * a script has none of — and this has to sweep BOTH workspaces' photos, not the
 * ones one of them can see.
 */
const prisma = new PrismaClient();

const apply = process.argv.includes("--apply");

/** Same rule as the upload action: the mime we stored decides the extension. */
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

function extensionFor(mimeType: string | null, originalName: string): string {
  return (
    (mimeType ? EXT_BY_MIME[mimeType] : undefined) ??
    /\.([a-z0-9]{1,5})$/i.exec(originalName)?.[1].toLowerCase() ??
    "jpg"
  );
}

async function main() {
  const photos = await prisma.fileAsset.findMany({
    where: { photoTemplateItemId: { not: null } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      category: true,
      mimeType: true,
      leadId: true,
      projectId: true,
      photoTemplateItemId: true,
      lead: { select: { vertical: true } },
      project: { select: { leadId: true, vertical: true } },
      photoTemplateItem: { select: { label: true, template: { select: { kind: true } } } },
    },
  });

  console.log(`${photos.length} checklist photo(s) in the database.\n`);

  // How many shots a slot already holds on this deal/job, so the second one is
  // "(2)". Keyed the same way the action counts: by job when there is one.
  const seen = new Map<string, number>();
  let changed = 0;
  const orphans: string[] = [];

  for (const p of photos) {
    const slot = p.photoTemplateItem;
    if (!slot) {
      // The slot was deleted out of the template since (FileAsset.
      // photoTemplateItemId is ON DELETE SET NULL, so this should not happen —
      // but a row that somehow points at nothing has no label to file under).
      orphans.push(p.id);
      continue;
    }

    const leadId = p.leadId ?? p.project?.leadId ?? null;
    const vertical = p.lead?.vertical ?? p.project?.vertical ?? null;
    const category = photoGroupFor(vertical, slot.template.kind as "site" | "install");

    const bucket = `${p.projectId ?? leadId ?? "none"}:${p.photoTemplateItemId}`;
    const index = (seen.get(bucket) ?? 0) + 1;
    seen.set(bucket, index);
    const name = `${slot.label}${index > 1 ? ` (${index})` : ""}.${extensionFor(p.mimeType, p.name)}`;

    if (p.category === category && p.name === name && p.leadId === leadId) continue;
    changed += 1;

    const moves: string[] = [];
    if (p.category !== category) moves.push(`folder ${p.category ?? "—"} → ${category}`);
    if (p.name !== name) moves.push(`name ${p.name} → ${name}`);
    if (p.leadId !== leadId) moves.push(`deal ${p.leadId ?? "—"} → ${leadId ?? "—"}`);
    console.log(`  ${p.id}  ${moves.join("  |  ")}`);

    if (apply) {
      await prisma.fileAsset.update({
        where: { id: p.id },
        data: { category, name, ...(leadId ? { leadId } : {}) },
      });
    }
  }

  if (orphans.length) {
    console.log(`\n${orphans.length} photo(s) point at a slot that no longer exists — left alone.`);
  }
  console.log(
    `\n${changed} photo(s) ${apply ? "refiled" : "would be refiled"}.` +
      (apply ? "" : "  Re-run with --apply to write."),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
