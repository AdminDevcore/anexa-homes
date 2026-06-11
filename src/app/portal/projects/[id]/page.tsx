import { redirect, notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db/client";

// Projects merged into the deal. Redirect old project links to the deal (lead).
export const metadata = { title: "Project" };

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const project = await prisma.project.findFirst({
    where: { id, companyId: user.companyId },
    select: { leadId: true },
  });
  if (!project) notFound();
  redirect(`/portal/leads/${project.leadId}`);
}
