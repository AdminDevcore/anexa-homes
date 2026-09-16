import type { AgentDepartment, AgentRunStatus, AgentRunTrigger, Vertical } from "@prisma/client";

/**
 * Words, tones and form values for agents. Safe in a client component: no
 * server module, no database, no handler code.
 */

export const DEPARTMENTS = ["permit", "operations", "accounting", "sales_escalation"] as const satisfies readonly AgentDepartment[];
export const PRODUCTS = ["both", "roofing", "solar"] as const;
export type Product = (typeof PRODUCTS)[number];
export const RUN_STATUSES = ["queued", "running", "success", "failed", "needs_human"] as const satisfies readonly AgentRunStatus[];

export const DEPARTMENT_LABEL: Record<AgentDepartment, string> = {
  permit: "Permit",
  operations: "Operations",
  accounting: "Accounting",
  sales_escalation: "Sales escalation",
};

export const PRODUCT_LABEL: Record<Product, string> = { both: "Both", roofing: "Roofing", solar: "Solar" };

export const STATUS_LABEL: Record<AgentRunStatus, string> = {
  queued: "Queued",
  running: "Running",
  success: "Success",
  failed: "Failed",
  needs_human: "Needs a human",
};

/** The chip-* tone classes from globals.css. */
export const STATUS_CHIP: Record<AgentRunStatus, string> = {
  queued: "chip-neutral",
  running: "chip-info",
  success: "chip-good",
  failed: "chip-danger",
  needs_human: "chip-warning",
};

export const TRIGGER_LABEL: Record<AgentRunTrigger, string> = { scheduled: "On schedule", manual: "Run now", event: "Event" };

export const isProduct = (v: unknown): v is Product => typeof v === "string" && (PRODUCTS as readonly string[]).includes(v);
export const isDepartment = (v: unknown): v is AgentDepartment =>
  typeof v === "string" && (DEPARTMENTS as readonly string[]).includes(v);
export const isRunStatus = (v: unknown): v is AgentRunStatus =>
  typeof v === "string" && (RUN_STATUSES as readonly string[]).includes(v);

/** NULL means Both. A retired `others` can never be saved, and reads as Both rather than crashing a page. */
export function productOf(vertical: Vertical | null): Product {
  return vertical === "roofing" || vertical === "solar" ? vertical : "both";
}

/** What the agent form holds: strings as typed, validated on save by validate-agent.ts. */
export type AgentFormValues = {
  name: string;
  description: string;
  handlerKey: string;
  product: Product;
  department: AgentDepartment;
  enabled: boolean;
  schedule: string;
  timeoutSeconds: string;
  requiresHumanGate: boolean;
  config: string;
};

export const NEW_AGENT_VALUES: AgentFormValues = {
  name: "",
  description: "",
  handlerKey: "system.hello",
  product: "both",
  department: "operations",
  enabled: false,
  schedule: "",
  timeoutSeconds: "60",
  requiresHumanGate: true,
  config: "{}",
};

export function formValuesFor(agent: {
  name: string;
  description: string;
  handlerKey: string;
  vertical: Vertical | null;
  department: AgentDepartment;
  enabled: boolean;
  schedule: string | null;
  timeoutSeconds: number;
  requiresHumanGate: boolean;
  config: unknown;
}): AgentFormValues {
  return {
    name: agent.name,
    description: agent.description,
    handlerKey: agent.handlerKey,
    product: productOf(agent.vertical),
    department: agent.department,
    enabled: agent.enabled,
    schedule: agent.schedule ?? "",
    timeoutSeconds: String(agent.timeoutSeconds),
    requiresHumanGate: agent.requiresHumanGate,
    config: JSON.stringify(agent.config ?? {}, null, 2),
  };
}

/** "just now", "4 min ago", "3 h ago", "2 d ago". */
export function timeAgo(date: Date | string, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(date).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** "14 ms", "2.3 s", "4 min 5 s". */
export function formatRunDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)} min ${total % 60} s`;
}

/**
 * The clock, for a server component that shows relative times. A named helper
 * rather than `new Date()` in render, which the React purity lint rule refuses
 * — the same reason daysInStage exists.
 */
export function renderedAt(): Date {
  return new Date();
}
