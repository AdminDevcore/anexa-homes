import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { EmptyState } from "@/components/portal/ui";
import { SettingsScreenHeader } from "@/components/portal/settings-kit/screen-header";
import { PipelineStagesManager } from "@/components/portal/pipeline-stages-manager";
import { KanbanSquare } from "lucide-react";

export const metadata = { title: "Pipeline Stages" };

export default async function PipelineSettingsPage({
  searchParams,
}: {
  /** Which stage is open. Read on the SERVER so the first paint is the right one. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  const user = await requireUser();
  if (!can(user, "update", "Settings")) redirect("/portal/settings");

  const pipeline = await prisma.pipeline.findFirst({
    where: { companyId: user.companyId },
    orderBy: { isDefault: "desc" },
    include: { stages: { orderBy: { position: "asc" } } },
  });

  return (
    <div className="space-y-6">
      <SettingsScreenHeader
        section="pipeline" title="Pipeline Stages" description="Customize the stages appointments move through, their order, and colors." />
      {pipeline ? (
        <PipelineStagesManager
          pipelineId={pipeline.id}
          initialStageId={one(params.stage)}
          stages={pipeline.stages.map((s) => ({
            id: s.id, name: s.name, color: s.color, isWon: s.isWon, isLost: s.isLost,
            targetDays: s.targetDays, escalationDays: s.escalationDays, notificationRecipient: s.notificationRecipient,
            sendInApp: s.sendInApp, sendEmail: s.sendEmail, markOverdue: s.markOverdue,
            stageType: s.stageType, ownerRole: s.ownerRole, followUpDays: s.followUpDays,
            isActionRequired: s.isActionRequired, defaultBlocker: s.defaultBlocker,
          }))}
        />
      ) : (
        <EmptyState icon={KanbanSquare} title="No pipeline found" />
      )}
    </div>
  );
}
