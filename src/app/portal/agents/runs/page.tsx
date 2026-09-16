import { redirect } from "next/navigation";
import { Hand } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { agentCan } from "@/server/modules/agents/access";
import { countNeedsHuman, listRunsFeed, needsHumanQueue } from "@/server/modules/agents/queries";
import { PRODUCT_LABEL, RUN_STATUSES, STATUS_LABEL, isRunStatus } from "@/lib/agent-labels";
import { hrefWith } from "@/lib/agents-href";
import { PageHeader } from "@/components/portal/ui";
import { AgentTabs } from "@/components/portal/agents/agent-tabs";
import { AutoRefresh } from "@/components/portal/agents/auto-refresh";
import { FilterChips } from "@/components/portal/agents/filter-chips";
import { NeedsHumanCard } from "@/components/portal/agents/needs-human-card";
import { Pagination } from "@/components/portal/agents/pagination";
import { RunList } from "@/components/portal/agents/run-list";

export const metadata = { title: "Agent runs" };
// A resolve's stage automations run inside this page's server action, so it
// gets the same 300 s the cron tick and the agent page have.
export const maxDuration = 300;

export default async function AgentRunsPage({
  searchParams,
}: {
  /**
   * Optimistic by one step, exactly like the agents list: a repeated key
   * (`?status=failed&status=success`) arrives as `string[]`, which this type
   * does not admit. Every read below tests the value rather than trusting the
   * type — `isRunStatus` checks `typeof v === "string"` first, the product
   * comparison is against two literals, and `Number([...])` of a repeated page
   * is NaN, which falls back to page 1. Widen those guards before widening
   * this.
   */
  searchParams: Promise<{ status?: string; product?: string; page?: string }>;
}) {
  const user = await requireUser();
  if (!agentCan(user, "read")) redirect("/portal/dashboard");

  const sp = await searchParams;
  const status = isRunStatus(sp.status) ? sp.status : null;
  // A run always happened in ONE workspace, so "Both" is not a filter here the
  // way it is on the agents list: an agent can be Both, a run never is.
  const product = sp.product === "roofing" || sp.product === "solar" ? sp.product : null;
  const current = { status, product };

  const [queue, waiting, feed] = await Promise.all([
    needsHumanQueue(user),
    countNeedsHuman(user),
    listRunsFeed(user, { status, product, page: Number(sp.page) || 1 }),
  ]);
  const canResolve = agentCan(user, "approve");
  const inFlight = feed.runs.some((r) => r.status === "queued" || r.status === "running");

  return (
    <div className="space-y-6">
      <AutoRefresh active={inFlight} />
      <PageHeader
        title="Agents"
        description="Every run across the agents you can see. Anything waiting on a person comes first."
      />
      <AgentTabs active="/portal/agents/runs" waiting={waiting} />

      <section aria-labelledby="needs-human" className="space-y-3">
        <h2 id="needs-human" className="flex items-center gap-2 font-semibold">
          <Hand className="size-4 text-muted-foreground" />
          Needs a human
          {waiting > 0 && (
            <span className="rounded-full border chip-warning px-2 py-0.5 text-[11px] font-semibold tabular-nums">{waiting}</span>
          )}
        </h2>
        {queue.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            Nothing is waiting on a person.
          </p>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {queue.map((run) => (
              <NeedsHumanCard key={run.id} run={run} canResolve={canResolve} />
            ))}
          </div>
        )}
        {/* The queue is capped (QUEUE_LIMIT) and worked oldest-first, so say so
            rather than let a person believe they have seen all of it. */}
        {waiting > queue.length && (
          <p className="text-xs text-muted-foreground">{`Showing the oldest ${queue.length} of ${waiting}.`}</p>
        )}
      </section>

      <section aria-labelledby="all-runs" className="space-y-3">
        <h2 id="all-runs" className="font-semibold">
          All runs
        </h2>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <FilterChips
            label="Status"
            active={status}
            options={[{ value: null, label: "All" }, ...RUN_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))]}
            // `page: null` on every filter link (see hrefWith). This is the
            // first list with real paging, so it is the first place it bites:
            // without it, changing a filter from page 5 keeps `page=5`, the
            // feed clamps to the last page, and the address bar disagrees with
            // what is on screen.
            hrefFor={(value) => hrefWith("/portal/agents/runs", current, { status: value, page: null })}
          />
          <FilterChips
            label="Product"
            active={product}
            options={[
              { value: null, label: "All" },
              { value: "roofing", label: PRODUCT_LABEL.roofing },
              { value: "solar", label: PRODUCT_LABEL.solar },
            ]}
            hrefFor={(value) => hrefWith("/portal/agents/runs", current, { product: value, page: null })}
          />
        </div>
        <RunList
          runs={feed.runs}
          canResolve={canResolve}
          showAgent
          emptyText={status || product ? "No runs match these filters." : "No runs yet."}
        />
        <Pagination
          page={feed.page}
          pageCount={feed.pageCount}
          total={feed.total}
          noun="runs"
          // A page link keeps the filters and states `page` itself, the way a
          // filter link states `page: null`.
          hrefFor={(p) => hrefWith("/portal/agents/runs", current, { page: p === 1 ? null : p })}
        />
      </section>
    </div>
  );
}
