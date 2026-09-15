import type { NotificationEvent } from "@prisma/client";

export type ConditionKind = "stage" | "status" | null;

export type EventDef = {
  value: NotificationEvent;
  label: string;
  condition: ConditionKind;
  tokens: string[];
  defaultTitle: string;
  defaultBody: string;
};

// Catalog of triggerable events, surfaced in the rule builder.
export const EVENT_DEFS: EventDef[] = [
  {
    value: "lead_created",
    label: "Appointment created",
    condition: null,
    tokens: ["{{customer}}", "{{actor}}"],
    defaultTitle: "New appointment: {{customer}}",
    defaultBody: "{{actor}} added a new appointment — {{customer}}.",
  },
  {
    value: "lead_assigned",
    label: "Appointment assigned",
    condition: null,
    tokens: ["{{customer}}", "{{actor}}"],
    defaultTitle: "Appointment assigned: {{customer}}",
    defaultBody: "You were assigned the appointment {{customer}}.",
  },
  {
    value: "stage_changed",
    label: "Pipeline stage changed",
    condition: "stage",
    tokens: ["{{customer}}", "{{stage}}", "{{actor}}"],
    defaultTitle: "{{customer}} → {{stage}}",
    defaultBody: "{{actor}} moved {{customer}} to {{stage}}.",
  },
  {
    value: "project_status_changed",
    label: "Project status changed",
    condition: "status",
    tokens: ["{{project}}", "{{status}}", "{{actor}}"],
    defaultTitle: "Project {{project}} → {{status}}",
    defaultBody: "{{actor}} set project {{project}} to {{status}}.",
  },
  {
    value: "document_sent",
    label: "Document sent for signature",
    condition: null,
    tokens: ["{{document}}", "{{customer}}"],
    defaultTitle: "Document sent: {{document}}",
    defaultBody: "{{document}} was sent to {{customer}} for signature.",
  },
  {
    value: "document_viewed",
    label: "Document viewed",
    condition: null,
    tokens: ["{{document}}", "{{customer}}"],
    defaultTitle: "Document viewed: {{document}}",
    defaultBody: "{{customer}} viewed {{document}}.",
  },
  {
    value: "document_signed",
    label: "Document signed",
    condition: null,
    tokens: ["{{document}}", "{{customer}}"],
    defaultTitle: "Document signed: {{document}}",
    defaultBody: "{{customer}} signed {{document}}.",
  },
  {
    value: "document_completed",
    label: "Document completed (all signed)",
    condition: null,
    tokens: ["{{document}}", "{{customer}}"],
    defaultTitle: "Completed: {{document}}",
    defaultBody: "All parties signed {{document}}.",
  },
  {
    value: "task_assigned",
    label: "Task assigned",
    condition: null,
    tokens: ["{{task}}", "{{actor}}"],
    defaultTitle: "New task: {{task}}",
    defaultBody: "{{actor}} assigned you a task — {{task}}.",
  },
  {
    value: "daily_report_submitted",
    label: "Daily report submitted",
    condition: null,
    tokens: ["{{project}}", "{{actor}}"],
    defaultTitle: "Daily report — {{project}}",
    defaultBody: "{{actor}} submitted a daily report for {{project}}.",
  },
  {
    value: "commission_approved",
    label: "Commission approved",
    condition: null,
    tokens: ["{{project}}"],
    defaultTitle: "Commission approved",
    defaultBody: "A commission for {{project}} was approved.",
  },
  {
    value: "payroll_approved",
    label: "Payroll run approved",
    condition: null,
    tokens: [],
    defaultTitle: "Payroll approved",
    defaultBody: "A payroll run was approved.",
  },
  {
    value: "automation_failed",
    label: "An automation failed",
    condition: null,
    tokens: ["{{customer}}", "{{status}}"],
    defaultTitle: "Automation failed on {{customer}}",
    defaultBody: "{{status}}",
  },
  {
    value: "agent_run_failed",
    label: "An agent run failed",
    condition: null,
    tokens: ["{{agent}}", "{{customer}}", "{{status}}"],
    defaultTitle: "Agent failed: {{agent}}",
    defaultBody: "{{status}}",
  },
  {
    value: "agent_needs_human",
    label: "An agent run needs a human",
    condition: null,
    tokens: ["{{agent}}", "{{customer}}", "{{status}}"],
    defaultTitle: "Needs a human: {{agent}}",
    defaultBody: "{{status}}",
  },
];

export const DYNAMIC_TARGETS = [
  { value: "assigned_rep", label: "Assigned sales rep" },
  { value: "project_manager", label: "Project manager" },
  { value: "lead_creator", label: "Lead creator" },
  { value: "task_assignee", label: "Task assignee" },
  { value: "all_admins", label: "All admins" },
  { value: "all_managers", label: "All managers" },
  { value: "agents_access", label: "People with Agents access" },
] as const;

export type RecipientConfig = {
  roles?: string[];
  userIds?: string[];
  dynamic?: string[];
};

export function eventLabel(event: NotificationEvent): string {
  return EVENT_DEFS.find((e) => e.value === event)?.label ?? event;
}
