import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { canEditAgentConfig } from "@/server/modules/agents/access";
import { handlerOptions } from "@/server/modules/agents/registry";
import { NEW_AGENT_VALUES } from "@/lib/agent-labels";
import { PageHeader } from "@/components/portal/ui";
import { AgentConfigForm } from "@/components/portal/agents/agent-config-form";
import { productChoicesFor } from "@/components/portal/agents/product-choices";

export const metadata = { title: "New agent" };

export default async function NewAgentPage() {
  const user = await requireUser();
  // Anyone else who can read agents lands on the list; the list itself sends
  // away everyone who cannot.
  if (!canEditAgentConfig(user)) redirect("/portal/agents");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/portal/agents" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All agents
      </Link>
      <PageHeader
        title="New agent"
        description="A handler, when it runs, and what it may do on its own. It starts turned off unless you turn it on here."
      />
      <AgentConfigForm mode={{ kind: "create" }} initial={NEW_AGENT_VALUES} handlers={handlerOptions()} products={productChoicesFor(user)} />
    </div>
  );
}
