import Link from "next/link";
import { redirect } from "next/navigation";
import { Bot, Plus } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { agentCan, canEditAgentConfig } from "@/server/modules/agents/access";
import { countNeedsHuman, listAgents } from "@/server/modules/agents/queries";
import { describeSchedule } from "@/server/modules/agents/schedule";
import {
  DEPARTMENTS,
  DEPARTMENT_LABEL,
  PRODUCTS,
  PRODUCT_LABEL,
  isDepartment,
  isProduct,
  productOf,
} from "@/lib/agent-labels";
import { EmptyState, PageHeader } from "@/components/portal/ui";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AgentEnabledSwitch } from "@/components/portal/agents/agent-enabled-switch";
import { AgentTabs } from "@/components/portal/agents/agent-tabs";
import { FilterChips } from "@/components/portal/agents/filter-chips";
import { hrefWith } from "@/lib/agents-href";
import { LocalTime } from "@/components/portal/agents/local-time";
import { RunStatusPill } from "@/components/portal/agents/run-status-pill";

export const metadata = { title: "Agents" };

const HEAD = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

export default async function AgentsPage({
  searchParams,
}: {
  /**
   * Optimistic by one step: a repeated key (`?product=solar&product=roofing`)
   * arrives as `string[]`, which this type does not admit. `isProduct` and
   * `isDepartment` test `typeof v === "string"` FIRST, so an array falls
   * through to null and the page degrades to unfiltered — those guards are
   * what make the narrow type safe. Widen the guards before widening this.
   */
  searchParams: Promise<{ product?: string; department?: string }>;
}) {
  const user = await requireUser();
  if (!agentCan(user, "read")) redirect("/portal/dashboard");

  const sp = await searchParams;
  const product = isProduct(sp.product) ? sp.product : null;
  const department = isDepartment(sp.department) ? sp.department : null;
  const current = { product, department };

  const [agents, waiting] = await Promise.all([listAgents(user, { product, department }), countNeedsHuman(user)]);
  const canEdit = canEditAgentConfig(user);
  const filtered = product !== null || department !== null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agents"
        description="Back-office automations: what each one does, when it runs, and how its last run went."
        action={
          canEdit ? (
            <Button asChild size="sm">
              <Link href="/portal/agents/new">
                <Plus className="size-4" /> New agent
              </Link>
            </Button>
          ) : undefined
        }
      />

      <AgentTabs active="/portal/agents" waiting={waiting} />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <FilterChips
          label="Product"
          active={product}
          options={[{ value: null, label: "All" }, ...PRODUCTS.map((p) => ({ value: p, label: PRODUCT_LABEL[p] }))]}
          // Every filter link resets the page (see hrefWith). This list has no
          // paging of its own yet; the runs list does, and the convention is
          // what keeps a `page=5` from riding through a filter change.
          hrefFor={(value) => hrefWith("/portal/agents", current, { product: value, page: null })}
        />
        <FilterChips
          label="Department"
          active={department}
          options={[{ value: null, label: "All" }, ...DEPARTMENTS.map((d) => ({ value: d, label: DEPARTMENT_LABEL[d] }))]}
          hrefFor={(value) => hrefWith("/portal/agents", current, { department: value, page: null })}
        />
      </div>

      {agents.length === 0 ? (
        <EmptyState
          icon={Bot}
          title={filtered ? "No agents match these filters" : "No agents yet"}
          description={
            filtered
              ? "Clear a filter to see more."
              : canEdit
                ? "Create one with New agent."
                : "An owner or admin creates agents."
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table className="[&_td]:px-4 [&_th]:px-4">
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className={HEAD}>Agent</TableHead>
                <TableHead className={HEAD}>Product</TableHead>
                <TableHead className={`hidden md:table-cell ${HEAD}`}>Department</TableHead>
                <TableHead className={`hidden lg:table-cell ${HEAD}`}>Schedule</TableHead>
                <TableHead className={HEAD}>Enabled</TableHead>
                <TableHead className={HEAD}>Last run</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((a) => (
                <TableRow key={a.id} data-testid="agent-row">
                  <TableCell className="max-w-md whitespace-normal align-top">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/portal/agents/${a.id}`} className="font-medium hover:underline">
                        {a.name}
                      </Link>
                      {a.handlerMissing && (
                        <span className="rounded-full border chip-danger px-2 py-0.5 text-[11px] font-medium">Handler missing</span>
                      )}
                    </div>
                    {a.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{a.description}</p>}
                  </TableCell>
                  <TableCell className="align-top text-sm">{PRODUCT_LABEL[productOf(a.vertical)]}</TableCell>
                  <TableCell className="hidden align-top text-sm md:table-cell">{DEPARTMENT_LABEL[a.department]}</TableCell>
                  <TableCell className="hidden align-top lg:table-cell">
                    <div className="text-sm">{describeSchedule(a.schedule)}</div>
                    {a.schedule && <code className="text-xs text-muted-foreground">{a.schedule}</code>}
                  </TableCell>
                  <TableCell className="align-top">
                    {canEdit ? (
                      <AgentEnabledSwitch agentId={a.id} name={a.name} enabled={a.enabled} />
                    ) : (
                      <span className="text-sm">{a.enabled ? "On" : "Off"}</span>
                    )}
                  </TableCell>
                  <TableCell className="align-top">
                    {a.lastRun ? (
                      <div className="flex flex-col items-start gap-1">
                        <RunStatusPill status={a.lastRun.status} />
                        <span className="text-xs text-muted-foreground">
                          <LocalTime iso={a.lastRun.createdAt.toISOString()} />
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Never run</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
