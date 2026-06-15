import { redirect, notFound } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { listScope } from "@/server/rbac/policies";

// Projects merged into the deal. Redirect old project links to the deal (lead).
export const metadata = { title: "Project" };

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  // Scope to what this user may actually see (not just their company) so a rep
  // can't probe another rep's project id and learn its leadId via the redirect.
  const project = await prisma.project.findFirst({
    where: { AND: [{ id }, listScope(user, "Project") as Prisma.ProjectWhereInput] },
    select: { leadId: true },
  });
  if (!project) notFound();
  redirect(`/portal/leads/${project.leadId}`);
}
