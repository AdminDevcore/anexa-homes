import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { StormIntelligenceShell } from "@/components/portal/storm/storm-intelligence-shell";

export const metadata = { title: "Storm Intelligence" };

export default async function StormIntelligencePage() {
  const user = await requireUser("/portal/storm-intelligence");
  if (!can(user, "read", "StormIntelligence")) redirect("/portal/dashboard");
  return <StormIntelligenceShell />;
}
