import type {
  AgentDepartment,
  AgentRunResolution,
  AgentRunStatus,
  AgentRunTrigger,
  Prisma,
  Role,
  Vertical,
} from "@prisma/client";
import { prisma } from "@/server/db/client";
import { userVerticals } from "@/server/auth/vertical";
import { formValuesFor, type AgentFormValues, type Product } from "@/lib/agent-labels";
import { readDetail } from "./detail";
import { handlerFor } from "./registry";
import type { RunDetail } from "./types";

/**
 * What the Agents pages read. Agent and AgentRun are SHARED models, so the
 * viewer's workspaces are applied here, explicitly, on every query: agents
 * whose product is Both (NULL) or a workspace the viewer holds, and runs in a
 * workspace the viewer holds. Pages check agentCan(user, "read") first.
 */

export const RUNS_PER_AGENT_PAGE = 25;
export const RUNS_FEED_PAGE = 50;
const QUEUE_LIMIT = 100;

/**
 * The most agents one company may hold. `listAgents` below fires one last-run
 * query PER AGENT, all at once, against a pool whose default size is
 * `cpus * 2 + 1` — typically 5–9 on a serverless instance. Past a certain
 * number the cost is not page latency, it is that one page load saturates the
 * pool and every concurrent request queues behind it.
 *
 * Enforced at creation time in `createAgentAction`. Far above any real back
 * office, and its only job is to make "agents are few" an invariant instead of
 * a hope.
 */
export const MAX_AGENTS = 100;

export type Viewer = { companyId: string; role: Role; verticals: Vertical[] };

const held = (viewer: Viewer): Vertical[] => userVerticals(viewer);

function visibleAgents(viewer: Viewer, heldVerticals: Vertical[] = held(viewer)): Prisma.AgentWhereInput {
  return { companyId: viewer.companyId, OR: [{ vertical: null }, { vertical: { in: heldVerticals } }] };
}

function visibleRuns(viewer: Viewer): Prisma.AgentRunWhereInput {
  return { companyId: viewer.companyId, vertical: { in: held(viewer) } };
}

/** "Roofing" means every agent that runs in Roofing, so Both agents are included. */
function productWhere(product: Product | null): Prisma.AgentWhereInput {
  if (product === "both") return { vertical: null };
  if (product === "roofing" || product === "solar") return { OR: [{ vertical: product }, { vertical: null }] };
  return {};
}

const fullName = (u: { firstName: string; lastName: string } | null) => (u ? `${u.firstName} ${u.lastName}`.trim() : null);

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export type AgentListRow = {
  id: string;
  name: string;
  description: string;
  handlerKey: string;
  handlerMissing: boolean;
  vertical: Vertical | null;
  department: AgentDepartment;
  enabled: boolean;
  schedule: string | null;
  lastRun: { status: AgentRunStatus; createdAt: Date } | null;
};

const AGENT_LIST_SELECT = {
  id: true,
  name: true,
  description: true,
  handlerKey: true,
  vertical: true,
  department: true,
  enabled: true,
  schedule: true,
} satisfies Prisma.AgentSelect;

const LAST_RUN_SELECT = { status: true, createdAt: true } satisfies Prisma.AgentRunSelect;

export async function listAgents(
  viewer: Viewer,
  filters: { product: Product | null; department: AgentDepartment | null }
): Promise<AgentListRow[]> {
  const heldVerticals = held(viewer);
  const rows = await prisma.agent.findMany({
    where: {
      AND: [visibleAgents(viewer, heldVerticals), productWhere(filters.product), filters.department ? { department: filters.department } : {}],
    },
    orderBy: { name: "asc" },
    select: AGENT_LIST_SELECT,
  });

  // No nested `runs: { take: 1 }` — without the relationJoins preview, Prisma
  // fetches every run of every listed agent and applies `take` in memory.
  // One findFirst per agent, in parallel, instead. Agents are few — MAX_AGENTS
  // is what makes that true rather than hoped for, and each lookup seeks on
  // @@index([agentId, createdAt]) rather than sorting a history.
  //
  // `companyId` is stated here rather than relied on positionally: this is
  // safe today only because `agent.id` already came from a company- and
  // workspace-filtered list, and a future caller of this loop should not have
  // to re-derive that from the query above.
  const lastRuns = await Promise.all(
    rows.map((agent) =>
      prisma.agentRun.findFirst({
        where: { agentId: agent.id, companyId: viewer.companyId, vertical: { in: heldVerticals } },
        orderBy: { createdAt: "desc" },
        select: LAST_RUN_SELECT,
      })
    )
  );

  return rows.map((agent, i) => ({
    ...agent,
    handlerMissing: !handlerFor(agent.handlerKey),
    lastRun: lastRuns[i] ?? null,
  }));
}

export type AgentView = {
  id: string;
  name: string;
  description: string;
  handlerKey: string;
  handlerLabel: string | null;
  vertical: Vertical | null;
  department: AgentDepartment;
  enabled: boolean;
  schedule: string | null;
  nextRunAt: string | null;
  timeoutSeconds: number;
  requiresHumanGate: boolean;
  config: unknown;
  updatedAt: string;
  updatedBy: string | null;
  form: AgentFormValues;
};

export async function getAgent(viewer: Viewer, agentId: string): Promise<AgentView | null> {
  const a = await prisma.agent.findFirst({
    where: { AND: [visibleAgents(viewer), { id: agentId }] },
    select: {
      id: true,
      name: true,
      description: true,
      handlerKey: true,
      vertical: true,
      department: true,
      enabled: true,
      schedule: true,
      nextRunAt: true,
      timeoutSeconds: true,
      requiresHumanGate: true,
      config: true,
      updatedAt: true,
      updatedBy: { select: { firstName: true, lastName: true } },
    },
  });
  if (!a) return null;
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    handlerKey: a.handlerKey,
    handlerLabel: handlerFor(a.handlerKey)?.label ?? null,
    vertical: a.vertical,
    department: a.department,
    enabled: a.enabled,
    schedule: a.schedule,
    nextRunAt: a.nextRunAt?.toISOString() ?? null,
    timeoutSeconds: a.timeoutSeconds,
    requiresHumanGate: a.requiresHumanGate,
    config: a.config,
    updatedAt: a.updatedAt.toISOString(),
    updatedBy: fullName(a.updatedBy),
    form: formValuesFor(a),
  };
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

/**
 * What a run LIST reads. `detail` and `error` are deliberately absent.
 *
 * `AgentRun.detail` is `Json @default("{}")`: the runner caps each log line and
 * each handler result, but nothing caps what one row can accumulate overall.
 * `AgentRun.error` holds full error text and stack — `errorText` writes
 * `err.stack` into it, routinely kilobytes. A feed page is 50 rows and the
 * needs-a-human queue is 100, so reading both into a list parses and
 * serialises megabytes to draw rows nobody has expanded.
 *
 * A collapsed row shows the status and the summary, and `summary` IS bounded:
 * every path that writes it goes through `truncateSummary` (SUMMARY_MAX, 280),
 * and the runner already writes the first line of a failure into it. So a
 * failed row still says what went wrong without its stack.
 *
 * A run's changes, log and stack are read one run at a time, by `getRun`.
 *
 * Named the same as runner.ts's own RUN_SELECT, which is a different shape for
 * a different purpose (claiming a run to execute it, not showing it on a page)
 * — the two never import from each other, so there's no collision, but
 * grepping for "RUN_SELECT" turns up both.
 */
const RUN_LIST_SELECT = {
  id: true,
  agentId: true,
  vertical: true,
  trigger: true,
  status: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
  summary: true,
  leadId: true,
  leadLabel: true,
  resolvedAt: true,
  resolution: true,
  resolutionNote: true,
  agent: { select: { name: true } },
  triggeredBy: { select: { firstName: true, lastName: true } },
  resolvedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.AgentRunSelect;

/** The list shape plus the two unbounded columns. Only ever used for ONE run. */
const RUN_SELECT = { ...RUN_LIST_SELECT, detail: true, error: true } satisfies Prisma.AgentRunSelect;

type RunListRow = Prisma.AgentRunGetPayload<{ select: typeof RUN_LIST_SELECT }>;
type RunRow = Prisma.AgentRunGetPayload<{ select: typeof RUN_SELECT }>;

/** A run as a LIST shows it. Plain strings, so it crosses into client components. */
export type RunListView = {
  id: string;
  agentId: string;
  agentName: string;
  vertical: Vertical;
  trigger: AgentRunTrigger;
  status: AgentRunStatus;
  triggeredBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  summary: string;
  leadId: string | null;
  leadLabel: string | null;
  resolution: { by: string | null; at: string; how: AgentRunResolution; note: string | null } | null;
};

/** One run, opened: the list shape plus the two columns a list leaves behind. */
export type RunView = RunListView & { detail: RunDetail; error: string | null };

function toRunListView(r: RunListRow): RunListView {
  return {
    id: r.id,
    agentId: r.agentId,
    agentName: r.agent.name,
    vertical: r.vertical,
    trigger: r.trigger,
    status: r.status,
    triggeredBy: fullName(r.triggeredBy),
    createdAt: r.createdAt.toISOString(),
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
    summary: r.summary,
    leadId: r.leadId,
    leadLabel: r.leadLabel,
    resolution:
      r.resolvedAt && r.resolution
        ? { by: fullName(r.resolvedBy), at: r.resolvedAt.toISOString(), how: r.resolution, note: r.resolutionNote }
        : null,
  };
}

function toRunView(r: RunRow): RunView {
  return { ...toRunListView(r), detail: readDetail(r.detail), error: r.error };
}

export type RunPage = { runs: RunListView[]; page: number; pageCount: number; total: number };

async function runPage(where: Prisma.AgentRunWhereInput, page: number, size: number): Promise<RunPage> {
  const total = await prisma.agentRun.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const rows = await prisma.agentRun.findMany({
    where,
    // A tiebreaker on `id` matters here: the tick can start several runs in
    // the same millisecond, so `createdAt` alone is not a stable sort key,
    // and skip/take over an unstable order can show a row on two pages or
    // drop it from both.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (current - 1) * size,
    take: size,
    select: RUN_LIST_SELECT,
  });
  return { runs: rows.map(toRunListView), page: current, pageCount, total };
}

export function listRunsForAgent(viewer: Viewer, agentId: string, page: number): Promise<RunPage> {
  return runPage({ AND: [visibleRuns(viewer), { agentId }] }, page, RUNS_PER_AGENT_PAGE);
}

export function listRunsFeed(
  viewer: Viewer,
  filters: { status: AgentRunStatus | null; product: Product | null; page: number }
): Promise<RunPage> {
  return runPage(
    {
      AND: [
        visibleRuns(viewer),
        filters.status ? { status: filters.status } : {},
        filters.product === "roofing" || filters.product === "solar" ? { vertical: filters.product } : {},
      ],
    },
    filters.page,
    RUNS_FEED_PAGE
  );
}

const unresolvedNeedsHuman = (viewer: Viewer): Prisma.AgentRunWhereInput => ({
  AND: [visibleRuns(viewer), { status: "needs_human", resolvedAt: null }],
});

/** Oldest first: the queue is worked from the top. */
export async function needsHumanQueue(viewer: Viewer): Promise<RunListView[]> {
  const rows = await prisma.agentRun.findMany({
    where: unresolvedNeedsHuman(viewer),
    // Same tiebreaker as runPage, and for the same reason: same-millisecond
    // ties from the tick must sort the same way every time this is read.
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: QUEUE_LIMIT,
    select: RUN_LIST_SELECT,
  });
  return rows.map(toRunListView);
}

/**
 * One run, with its changes, its log and its error text. The ONLY read that
 * carries `detail` and `error`, so a list stays a list and a person who opens
 * a run pays for that run alone.
 *
 * Scoped exactly like every list above: a run in a workspace the viewer does
 * not hold, or in another company, is simply not found.
 */
export async function getRun(viewer: Viewer, runId: string): Promise<RunView | null> {
  const run = await prisma.agentRun.findFirst({
    where: { AND: [visibleRuns(viewer), { id: runId }] },
    select: RUN_SELECT,
  });
  return run ? toRunView(run) : null;
}

export function countNeedsHuman(viewer: Viewer): Promise<number> {
  return prisma.agentRun.count({ where: unresolvedNeedsHuman(viewer) });
}
