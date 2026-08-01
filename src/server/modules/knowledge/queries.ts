import type { Vertical } from "@prisma/client";
import { prisma } from "@/server/db/client";
import type { AccessUser } from "@/server/rbac/guards";
import { categoryScope } from "./policies";

/** Categories (with items) visible to `user` in the active `vertical` workspace. */
export async function listKnowledge(user: AccessUser, vertical: Vertical) {
  const categories = await prisma.knowledgeCategory.findMany({
    where: categoryScope(user, vertical),
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: {
      items: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
    },
  });

  // fileId is a plain column (no relation), so resolve MIME types in one batch.
  const fileIds = categories.flatMap((c) =>
    c.items.map((i) => i.fileId).filter((id): id is string => !!id)
  );
  const files = fileIds.length
    ? await prisma.fileAsset.findMany({
        where: { id: { in: fileIds }, companyId: user.companyId },
        select: { id: true, mimeType: true },
      })
    : [];
  const mimeById = new Map(files.map((f) => [f.id, f.mimeType] as const));

  return categories.map((c) => ({
    ...c,
    items: c.items.map((i) => ({
      ...i,
      fileMime: i.fileId ? mimeById.get(i.fileId) ?? null : null,
    })),
  }));
}

/**
 * Returns the FileAsset for a knowledge item IF the item's category is visible to
 * `user` — the authorization check behind the file-serve route. Null when the item
 * doesn't exist, isn't a file, or the user can't see its category.
 */
export async function knowledgeFileForUser(
  user: AccessUser,
  vertical: Vertical,
  itemId: string
) {
  const item = await prisma.knowledgeItem.findFirst({
    where: {
      id: itemId,
      companyId: user.companyId,
      type: { in: ["file", "video"] },
      fileId: { not: null },
      category: categoryScope(user, vertical),
    },
    select: { fileId: true },
  });
  if (!item?.fileId) return null;
  return prisma.fileAsset.findFirst({
    where: { id: item.fileId, companyId: user.companyId },
    select: { id: true, name: true, storageKey: true, mimeType: true },
  });
}
