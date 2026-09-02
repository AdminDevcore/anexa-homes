import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { can } from "@/server/rbac/guards";
import { SettingsScreenHeader } from "@/components/portal/settings-kit/screen-header";
import { getSolarSettings } from "@/server/modules/solar/settings";
import { SolarSettingsForm } from "@/components/portal/solar-settings-form";
import { StageModelManager } from "@/components/portal/stage-model-manager";
import { prisma } from "@/server/db/client";

export const dynamic = "force-dynamic";

export default async function SolarSettingsPage({
  searchParams,
}: {
  /** Which tab is open. Read on the SERVER so the first paint is the right one. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  const user = await requireUser("/portal/settings/solar");
  if (!can(user, "read", "Settings")) redirect("/portal/dashboard");

  // Solar-only configuration: reachable only from the Solar workspace, so a
  // roofing user cannot land here and edit assumptions that do not apply.
  const vertical = await getActiveVertical(user);
  if (vertical !== "solar") redirect("/portal/settings");

  const [settings, pipeline] = await Promise.all([
    getSolarSettings(user.companyId),
    prisma.pipeline.findFirst({
      where: { companyId: user.companyId },
      orderBy: { isDefault: "desc" },
      include: { stages: { orderBy: { position: "asc" } } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <SettingsScreenHeader
        section="solar_settings"
        description="Assumptions every quote is built from, the guard rails a rep cannot quote outside of, and who owns each pipeline stage."
      />

      <SolarSettingsForm
        settings={settings}
        initialTab={one(params.tab)}
        stageModel={
          pipeline ? (
            <StageModelManager
              canEdit={can(user, "update", "Settings")}
              stages={pipeline.stages.map((s) => ({
                id: s.id,
                name: s.name,
                color: s.color,
                isWon: s.isWon,
                isLost: s.isLost,
                stageType: s.stageType,
                ownerRole: s.ownerRole,
                targetDays: s.targetDays,
                escalationDays: s.escalationDays,
                followUpDays: s.followUpDays,
                isActionRequired: s.isActionRequired,
                defaultBlocker: s.defaultBlocker,
                notificationRecipient: s.notificationRecipient,
                sendInApp: s.sendInApp,
                sendEmail: s.sendEmail,
                markOverdue: s.markOverdue,
              }))}
            />
          ) : null
        }
      />
    </div>
  );
}
