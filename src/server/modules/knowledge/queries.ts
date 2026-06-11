import type { Industry } from "@prisma/client";
import { prisma } from "@/server/db/client";
import type { AccessUser } from "@/server/rbac/guards";
import { categoryScope } from "./policies";

/** Categories (with items) visible to `user` in the active `industry` workspace. */
export async function listKnowledge(user: AccessUser, industry: Industry) {
  return prisma.knowledgeCategory.findMany({
    where: categoryScope(user, industry),
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: {
      items: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
    },
  });
}

/**
 * Returns the FileAsset for a knowledge item IF the item's category is visible to
 * `user` — the authorization check behind the file-serve route. Null when the item
 * doesn't exist, isn't a file, or the user can't see its category.
 */
export async function knowledgeFileForUser(
  user: AccessUser,
  industry: Industry,
  itemId: string
) {
  const item = await prisma.knowledgeItem.findFirst({
    where: {
      id: itemId,
      companyId: user.companyId,
      type: { in: ["file", "video"] },
      fileId: { not: null },
      category: categoryScope(user, industry),
    },
    select: { fileId: true },
  });
  if (!item?.fileId) return null;
  return prisma.fileAsset.findFirst({
    where: { id: item.fileId, companyId: user.companyId },
    select: { id: true, name: true, storageKey: true, mimeType: true },
  });
}
