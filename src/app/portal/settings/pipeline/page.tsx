import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { PageHeader, EmptyState } from "@/components/portal/ui";
import { PipelineStagesManager } from "@/components/portal/pipeline-stages-manager";
import { KanbanSquare } from "lucide-react";

export const metadata = { title: "Pipeline Stages" };

export default async function PipelineSettingsPage() {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) redirect("/portal/settings");

  const pipeline = await prisma.pipeline.findFirst({
    where: { companyId: user.companyId },
    orderBy: { isDefault: "desc" },
    include: { stages: { orderBy: { position: "asc" } } },
  });

  return (
    <div className="space-y-6">
      <Link href="/portal/settings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to settings
      </Link>
      <PageHeader title="Pipeline Stages" description="Customize the stages appointments move through, their order, and colors." />
      {pipeline ? (
        <PipelineStagesManager
          pipelineId={pipeline.id}
          stages={pipeline.stages.map((s) => ({
            id: s.id, name: s.name, color: s.color, isWon: s.isWon, isLost: s.isLost,
            targetDays: s.targetDays, escalationDays: s.escalationDays, notificationRecipient: s.notificationRecipient,
            sendInApp: s.sendInApp, sendEmail: s.sendEmail, markOverdue: s.markOverdue,
          }))}
        />
      ) : (
        <EmptyState icon={KanbanSquare} title="No pipeline found" />
      )}
    </div>
  );
}
