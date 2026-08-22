import { prisma } from "@/server/db/client";
import { photoExampleUrl } from "@/lib/photo-example";

export type PhotoSlot = {
  itemId: string;
  label: string;
  required: boolean;
  position: number;
  /** The admin's reference shot for this slot, when one has been uploaded. */
  exampleUrl: string | null;
  photos: { id: string; name: string }[];
};

export type PhotoChecklist = {
  templateId: string;
  name: string;
  kind: "site" | "install";
  items: PhotoSlot[];
  filledItems: number;
  totalItems: number;
  requiredTotal: number;
  requiredDone: number;
};

/**
 * Photo checklists (Site + Install) for a project, with photos grouped by slot.
 *
 * `projectId` is optional because a deal has these checklists before it has a
 * project. Nothing has been shot yet at that point — the slots come back empty
 * — but the labels and their example photos are exactly what a rep standing at
 * a house before production starts needs to see.
 */
export async function getProjectPhotoChecklists(
  companyId: string,
  projectId?: string | null
): Promise<PhotoChecklist[]> {
  const [templates, photos] = await Promise.all([
    prisma.photoTemplate.findMany({
      where: { companyId },
      orderBy: [{ kind: "asc" }, { position: "asc" }],
      include: { items: { orderBy: { position: "asc" } } },
    }),
    projectId
      ? prisma.fileAsset.findMany({
          where: { companyId, projectId, kind: "photo", photoTemplateItemId: { not: null } },
          select: { id: true, name: true, photoTemplateItemId: true },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const byItem = new Map<string, { id: string; name: string }[]>();
  for (const p of photos) {
    const key = p.photoTemplateItemId!;
    if (!byItem.has(key)) byItem.set(key, []);
    byItem.get(key)!.push({ id: p.id, name: p.name });
  }

  return templates.map((t) => {
    const items: PhotoSlot[] = t.items.map((it) => ({
      itemId: it.id,
      label: it.label,
      required: it.required,
      position: it.position,
      exampleUrl: photoExampleUrl(it.id, it.exampleUpdatedAt),
      photos: byItem.get(it.id) ?? [],
    }));
    const required = items.filter((i) => i.required);
    return {
      templateId: t.id,
      name: t.name,
      kind: t.kind as "site" | "install",
      items,
      filledItems: items.filter((i) => i.photos.length > 0).length,
      totalItems: items.length,
      requiredTotal: required.length,
      requiredDone: required.filter((i) => i.photos.length > 0).length,
    };
  });
}

/** All photo templates with their items (for the Settings manager). */
export async function getPhotoTemplates(companyId: string) {
  return prisma.photoTemplate.findMany({
    where: { companyId },
    orderBy: [{ kind: "asc" }, { position: "asc" }],
    include: { items: { orderBy: { position: "asc" } } },
  });
}
