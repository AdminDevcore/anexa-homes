import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { CanvassingShell } from "@/components/portal/canvassing-shell";

export const metadata = { title: "Canvassing" };

export default async function CanvassingPage() {
  const user = await requireUser("/portal/canvassing");
  if (!can(user, "read", "Canvassing")) redirect("/portal/dashboard");
  return <CanvassingShell />;
}
