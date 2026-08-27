/**
 * One-off: clear out the panel-layout drawings every solar deal has piled up.
 *
 * The layout designer re-renders its picture of the array and files it as a new
 * FileAsset on EVERY save, then points `SolarDesign.layoutImageFileId` at it.
 * Nothing ever pointed at the copy before, so a roof drawn eight times left
 * eight near-identical aerials attached to the deal — and since `solar_layout`
 * was not a folder key until now, all eight sat in "Other" together.
 *
 * `uploadPanelLayoutAction` prunes as it saves from now on. This walks the
 * deals that were drawn before it did.
 *
 * WHAT IT TOUCHES: file rows named `panel-layout.jpg` under category
 * `solar_layout` — the designer's own output, and only that.
 *
 * WHAT IT DOES NOT TOUCH:
 *   - the drawing the design points at now;
 *   - any drawing frozen into a proposal's snapshot, sent or not. The public
 *     layout-image route reads the file row by that id, so dropping the row
 *     takes the picture off a link a homeowner may already hold;
 *   - a layout a rep exported from another tool and uploaded by hand. It
 *     arrives under the same category but its own filename, and replacing it
 *     was never permission to delete it;
 *   - `storageKey`. Rows only — the bytes stay in the bucket, exactly like
 *     `removeFiledCopies` and `deleteFileAction`.
 *
 *   npx tsx scripts/prune-solar-layouts.ts            # report only, writes nothing
 *   npx tsx scripts/prune-solar-layouts.ts --apply    # delete the superseded rows
 *
 * DATABASE_URL must point at the environment you mean.
 */
import { PrismaClient } from "@prisma/client";
import { DESIGNER_LAYOUT_FILENAME } from "../src/lib/solar-layout";

/**
 * A PLAIN client, not `@/server/db/client`.
 *
 * The extended one enforces the vertical scope from async-local storage, which
 * a script has none of — and this has to see every company's solar deals.
 */
const prisma = new PrismaClient();

const apply = process.argv.includes("--apply");
const LAYOUT_CATEGORY = "solar_layout";

async function main() {
  const drawings = await prisma.fileAsset.findMany({
    where: { category: LAYOUT_CATEGORY, name: DESIGNER_LAYOUT_FILENAME, kind: "photo" },
    select: { id: true, companyId: true, leadId: true, createdAt: true, size: true },
    orderBy: { createdAt: "asc" },
  });

  const byLead = new Map<string, typeof drawings>();
  for (const d of drawings) {
    if (!d.leadId) continue;
    const bucket = byLead.get(d.leadId);
    if (bucket) bucket.push(d);
    else byLead.set(d.leadId, [d]);
  }

  console.log(
    `${drawings.length} designer drawing(s) across ${byLead.size} deal(s).${apply ? "" : "  DRY RUN — nothing will be written."}`,
  );

  let deleted = 0;
  let bytes = 0;

  for (const [leadId, files] of byLead) {
    const design = await prisma.solarDesign.findUnique({
      where: { leadId },
      select: { layoutImageFileId: true },
    });
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { firstName: true, lastName: true, address: true },
    });

    const keep = new Set<string>();
    if (design?.layoutImageFileId) keep.add(design.layoutImageFileId);

    // Anything a proposal points at, whatever its status. One narrow count per
    // candidate beats loading snapshots that run to hundreds of kilobytes each.
    for (const f of files) {
      if (keep.has(f.id)) continue;
      const frozen = await prisma.solarProposal.count({
        where: { leadId, snapshot: { path: ["layout", "fileId"], equals: f.id } },
      });
      if (frozen > 0) keep.add(f.id);
    }

    // Nothing points at the newest one — a deal whose design row was cleared,
    // or a drawing saved after the last generate. Keeping it means the folder
    // still shows the array; deleting every copy would empty it.
    if (keep.size === 0) keep.add(files[files.length - 1].id);

    const doomed = files.filter((f) => !keep.has(f.id));
    if (doomed.length === 0) continue;

    const who = [lead?.firstName, lead?.lastName].filter(Boolean).join(" ") || leadId;
    console.log(
      `  ${who}${lead?.address ? ` — ${lead.address}` : ""}: ${files.length} drawing(s), keeping ${keep.size}, dropping ${doomed.length}`,
    );

    deleted += doomed.length;
    bytes += doomed.reduce((sum, f) => sum + (f.size ?? 0), 0);

    if (apply) {
      await prisma.fileAsset.deleteMany({ where: { id: { in: doomed.map((f) => f.id) } } });
    }
  }

  console.log(
    apply
      ? `Done. ${deleted} row(s) deleted (${(bytes / 1024 / 1024).toFixed(1)}MB of objects left in the bucket).`
      : `Would delete ${deleted} row(s) (${(bytes / 1024 / 1024).toFixed(1)}MB). Re-run with --apply.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
