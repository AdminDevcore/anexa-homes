import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { agentCan, canEditAgentConfig } from "@/server/modules/agents/access";
import { countNeedsHuman, getAgent, listRunsForAgent, type AgentView } from "@/server/modules/agents/queries";
import { handlerOptions } from "@/server/modules/agents/registry";
import { describeSchedule } from "@/server/modules/agents/schedule";
import { DEPARTMENT_LABEL, PRODUCT_LABEL, productOf } from "@/lib/agent-labels";
import { hrefWith } from "@/lib/agents-href";
import { cn } from "@/lib/utils";
import { AgentConfigForm } from "@/components/portal/agents/agent-config-form";
import { AgentEnabledSwitch } from "@/components/portal/agents/agent-enabled-switch";
import { AgentTabs } from "@/components/portal/agents/agent-tabs";
import { AutoRefresh } from "@/components/portal/agents/auto-refresh";
import { LocalTime } from "@/components/portal/agents/local-time";
import { Pagination } from "@/components/portal/agents/pagination";
import { productChoicesFor } from "@/components/portal/agents/product-choices";
import { RunList } from "@/components/portal/agents/run-list";
import { RunNowButton } from "@/components/portal/agents/run-now-button";

export const metadata = { title: "Agent" };
// Run now's after() and a resolve's stage automations both run inside this
// page's server actions, so they get the same 300 s the cron tick has.
export const maxDuration = 300;

/** Every Agent.id is a generated uuid, so anything else is a 404 without a database round trip — the same guard the actions apply. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-muted-foreground", className)}>
      {children}
    </span>
  );
}

function ReadOnlyConfig({ agent }: { agent: AgentView }) {
  const rows: [string, React.ReactNode][] = [
    ["Handler", agent.handlerLabel ? `${agent.handlerLabel} (${agent.handlerKey})` : `${agent.handlerKey} — not deployed`],
    ["Product", PRODUCT_LABEL[productOf(agent.vertical)]],
    ["Department", DEPARTMENT_LABEL[agent.department]],
    ["Schedule", agent.schedule ? `${describeSchedule(agent.schedule)} (${agent.schedule}, UTC)` : "Only when someone presses Run now"],
    ["Timeout", `${agent.timeoutSeconds} seconds`],
    ["Human gate", agent.requiresHumanGate ? "On" : "Off — can advance deals by itself"],
    ["Last edited", agent.updatedBy ? `${agent.updatedBy}` : "—"],
  ];
  return (
    <div data-testid="agent-config-readonly" className="space-y-3 rounded-xl border border-border bg-card p-4">
      <dl className="space-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <div>
        <div className="mb-1 text-xs text-muted-foreground">Config</div>
        <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-xs">
          {JSON.stringify(agent.config ?? {}, null, 2)}
        </pre>
      </div>
    </div>
  );
}

export default async function AgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requireUser();
  if (!agentCan(user, "read")) redirect("/portal/dashboard");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();

  const agent = await getAgent(user, id);
  if (!agent) notFound();

  const [runs, waiting] = await Promise.all([listRunsForAgent(user, agent.id, Number(sp.page) || 1), countNeedsHuman(user)]);
  const canEdit = canEditAgentConfig(user);
  const inFlight = runs.runs.some((r) => r.status === "queued" || r.status === "running");

  return (
    <div className="space-y-6">
      <AutoRefresh active={inFlight} />
      <Link href="/portal/agents" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All agents
      </Link>

      <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight">{agent.name}</h1>
          {agent.description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{agent.description}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-medium">
            <Chip>{PRODUCT_LABEL[productOf(agent.vertical)]}</Chip>
            <Chip>{DEPARTMENT_LABEL[agent.department]}</Chip>
            {agent.handlerLabel ? (
              <Chip>{agent.handlerLabel}</Chip>
            ) : (
              <span className="rounded-full border chip-danger px-2 py-0.5">{`Handler missing: ${agent.handlerKey}`}</span>
            )}
            <span className={cn("rounded-full border px-2 py-0.5", agent.requiresHumanGate ? "chip-info" : "chip-warning")}>
              {agent.requiresHumanGate ? "Human gate" : "Can advance deals"}
            </span>
            <Chip>{describeSchedule(agent.schedule)}</Chip>
            {agent.enabled && agent.nextRunAt && (
              <Chip>
                Next run <LocalTime iso={agent.nextRunAt} mode="absolute" />
              </Chip>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {canEdit ? (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              Enabled
              <AgentEnabledSwitch agentId={agent.id} name={agent.name} enabled={agent.enabled} />
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">{agent.enabled ? "Enabled" : "Turned off"}</span>
          )}
          {agentCan(user, "run") && <RunNowButton agentId={agent.id} enabled={agent.enabled} />}
        </div>
      </div>

      <AgentTabs active="/portal/agents" waiting={waiting} />

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="space-y-3 lg:col-span-3">
          <h2 className="font-semibold">Run history</h2>
          <RunList runs={runs.runs} canResolve={agentCan(user, "approve")} emptyText="No runs yet." />
          <Pagination
            page={runs.page}
            pageCount={runs.pageCount}
            total={runs.total}
            noun="runs"
            // A page link carries nothing else, but it states `page` the way
            // every filter link states `page: null` — see hrefWith.
            hrefFor={(p) => hrefWith(`/portal/agents/${agent.id}`, {}, { page: p === 1 ? null : p })}
          />
        </section>
        <section className="space-y-3 lg:col-span-2">
          <h2 className="font-semibold">Config</h2>
          {canEdit ? (
            <AgentConfigForm
              mode={{ kind: "edit", agentId: agent.id }}
              initial={agent.form}
              handlers={handlerOptions()}
              products={productChoicesFor(user)}
            />
          ) : (
            <ReadOnlyConfig agent={agent} />
          )}
        </section>
      </div>
    </div>
  );
}
