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

export type Viewer = { companyId: string; role: Role; verticals: Vertical[] };

const held = (viewer: Viewer): Vertical[] => userVerticals(viewer);

function visibleAgents(viewer: Viewer): Prisma.AgentWhereInput {
  return { companyId: viewer.companyId, OR: [{ vertical: null }, { vertical: { in: held(viewer) } }] };
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
  const rows = await prisma.agent.findMany({
    where: { AND: [visibleAgents(viewer), productWhere(filters.product), filters.department ? { department: filters.department } : {}] },
    orderBy: { name: "asc" },
    select: AGENT_LIST_SELECT,
  });

  // No nested `runs: { take: 1 }` — without the relationJoins preview, Prisma
  // fetches every run of every listed agent and applies `take` in memory.
  // One findFirst per agent, in parallel, instead. Agents are few.
  const heldVerticals = held(viewer);
  const lastRuns = await Promise.all(
    rows.map((agent) =>
      prisma.agentRun.findFirst({
        where: { agentId: agent.id, vertical: { in: heldVerticals } },
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

const RUN_SELECT = {
  id: true,
  agentId: true,
  vertical: true,
  trigger: true,
  status: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
  summary: true,
  error: true,
  leadId: true,
  leadLabel: true,
  detail: true,
  resolvedAt: true,
  resolution: true,
  resolutionNote: true,
  agent: { select: { name: true } },
  triggeredBy: { select: { firstName: true, lastName: true } },
  resolvedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.AgentRunSelect;

type RunRow = Prisma.AgentRunGetPayload<{ select: typeof RUN_SELECT }>;

/** A run as the pages show it. Plain strings, so it crosses into client components. */
export type RunView = {
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
  error: string | null;
  leadId: string | null;
  leadLabel: string | null;
  detail: RunDetail;
  resolution: { by: string | null; at: string; how: AgentRunResolution; note: string | null } | null;
};

function toRunView(r: RunRow): RunView {
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
    error: r.error,
    leadId: r.leadId,
    leadLabel: r.leadLabel,
    detail: readDetail(r.detail),
    resolution:
      r.resolvedAt && r.resolution
        ? { by: fullName(r.resolvedBy), at: r.resolvedAt.toISOString(), how: r.resolution, note: r.resolutionNote }
        : null,
  };
}

export type RunPage = { runs: RunView[]; page: number; pageCount: number; total: number };

async function runPage(where: Prisma.AgentRunWhereInput, page: number, size: number): Promise<RunPage> {
  const total = await prisma.agentRun.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const rows = await prisma.agentRun.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (current - 1) * size,
    take: size,
    select: RUN_SELECT,
  });
  return { runs: rows.map(toRunView), page: current, pageCount, total };
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
export async function needsHumanQueue(viewer: Viewer): Promise<RunView[]> {
  const rows = await prisma.agentRun.findMany({
    where: unresolvedNeedsHuman(viewer),
    orderBy: { createdAt: "asc" },
    take: QUEUE_LIMIT,
    select: RUN_SELECT,
  });
  return rows.map(toRunView);
}

export function countNeedsHuman(viewer: Viewer): Promise<number> {
  return prisma.agentRun.count({ where: unresolvedNeedsHuman(viewer) });
}
