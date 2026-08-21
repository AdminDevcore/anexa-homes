import type { NotificationEvent } from "@prisma/client";

/**
 * A starter set of notification rules for a workspace that has none.
 *
 * NotificationRule is vertical-isolated, so Solar inherited none of Roofing's
 * fifteen rules and fired nothing at all — not one alert, with no error to
 * notice. The stage-duration path (pipeline/stage-alerts.ts) covered nothing
 * either, since it needs `targetDays > 0` and no solar stage sets one.
 *
 * Stages are matched by NAME, not by key or id. A company's pipeline is edited
 * in the UI, so its stage keys are whatever the builder generated
 * ("ntp_action_required_10") and bear no relation to the canonical keys in
 * lib/solar-pipeline.ts. The name is the only stable thing a human actually
 * chose, and the six solar blockers are all literally named "... Action
 * Required" — which is the signal this leans on.
 */

export type RecipientSpec = {
  roles?: string[];
  dynamic?: string[];
};

/** A rule that does not depend on any stage existing. */
export type GenericRuleSpec = {
  name: string;
  event: Exclude<NotificationEvent, "stage_changed">;
  recipients: RecipientSpec;
  channels: ("in_app" | "email")[];
  titleTemplate: string;
  bodyTemplate: string;
};

/** A rule generated once per stage whose name matches. */
export type StageRuleSpec = {
  /** Used in the generated rule name, so a human can tell them apart. */
  id: string;
  match: RegExp;
  /** `{{stage}}` is substituted with the matched stage's own name. */
  nameTemplate: string;
  recipients: RecipientSpec;
  channels: ("in_app" | "email")[];
  titleTemplate: string;
  bodyTemplate: string;
};

/**
 * Channel choice mirrors the roofing set already in production rather than
 * inventing a second convention: stage movement and a new appointment are worth
 * an email; an assignment, a signed document and a task are in-app only.
 */
export const GENERIC_RULES: GenericRuleSpec[] = [
  {
    name: "New appointment → Managers",
    event: "lead_created",
    recipients: { roles: ["manager", "admin"] },
    channels: ["in_app", "email"],
    titleTemplate: "New appointment: {{customer}}",
    bodyTemplate: "{{actor}} added a new appointment — {{customer}}.",
  },
  {
    name: "Appointment assigned → Rep",
    event: "lead_assigned",
    recipients: { dynamic: ["assigned_rep"] },
    channels: ["in_app"],
    titleTemplate: "Appointment assigned: {{customer}}",
    bodyTemplate: "You were assigned the appointment {{customer}}.",
  },
  {
    name: "Document completed → Customer & Rep",
    event: "document_completed",
    recipients: { dynamic: ["customer", "assigned_rep"] },
    channels: ["in_app"],
    titleTemplate: "Document completed",
    bodyTemplate: "{{document}} is fully signed.",
  },
  {
    name: "Task assigned → Assignee",
    event: "task_assigned",
    recipients: { dynamic: ["task_assignee"] },
    channels: ["in_app"],
    titleTemplate: "Task assigned",
    bodyTemplate: "You were assigned a task.",
  },
];

export const STAGE_RULES: StageRuleSpec[] = [
  {
    // The whole point of the set. Six solar stages are named this way and each
    // one means the deal is parked until a person does something.
    id: "action_required",
    match: /action required/i,
    nameTemplate: "{{stage}} → Rep, Manager & Admin",
    recipients: { roles: ["manager", "admin"], dynamic: ["assigned_rep"] },
    channels: ["in_app", "email"],
    titleTemplate: "Action required: {{customer}} → {{stage}}",
    bodyTemplate: "{{customer}} is blocked at {{stage}} and needs someone to act.",
  },
  {
    id: "contract_signed",
    match: /^contract signed/i,
    nameTemplate: "{{stage}} → Manager & PM",
    recipients: { roles: ["manager"], dynamic: ["project_manager"] },
    channels: ["in_app", "email"],
    titleTemplate: "{{customer}} → {{stage}}",
    bodyTemplate: "{{actor}} moved {{customer}} to {{stage}}.",
  },
  {
    id: "install_scheduled",
    match: /^install scheduled/i,
    nameTemplate: "{{stage}} → Rep, Manager & Installer",
    recipients: { roles: ["manager", "installer"], dynamic: ["assigned_rep"] },
    channels: ["in_app", "email"],
    titleTemplate: "{{customer}} → {{stage}}",
    bodyTemplate: "{{actor}} moved {{customer}} to {{stage}}.",
  },
  {
    id: "install_complete",
    match: /^install(ation)? complete/i,
    nameTemplate: "{{stage}} → Manager & Accounting",
    recipients: { roles: ["manager", "accounting"] },
    channels: ["in_app", "email"],
    titleTemplate: "{{customer}} → {{stage}}",
    bodyTemplate: "{{actor}} moved {{customer}} to {{stage}}.",
  },
  {
    // PTO is the moment the system may legally be switched on, and the moment
    // most lender milestones become claimable.
    id: "pto",
    match: /\bpto\b|permission to operate/i,
    nameTemplate: "{{stage}} → Manager, Admin & Accounting",
    recipients: { roles: ["manager", "admin", "accounting"] },
    channels: ["in_app", "email"],
    titleTemplate: "PTO granted: {{customer}}",
    bodyTemplate: "{{customer}} reached {{stage}} — the system can be switched on.",
  },
  {
    id: "funded",
    match: /^(fully )?funded|^partial funding/i,
    nameTemplate: "{{stage}} → Accounting & Owner",
    recipients: { roles: ["accounting", "super_admin"] },
    channels: ["in_app", "email"],
    titleTemplate: "{{customer}} → {{stage}}",
    bodyTemplate: "{{actor}} moved {{customer}} to {{stage}}.",
  },
];

export type PlannedRule = {
  name: string;
  event: NotificationEvent;
  conditions: { stageId?: string };
  recipients: { roles: string[]; userIds: string[]; dynamic: string[] };
  channels: ("in_app" | "email")[];
  titleTemplate: string;
  bodyTemplate: string;
};

function expand(recipients: RecipientSpec) {
  return { roles: recipients.roles ?? [], userIds: [], dynamic: recipients.dynamic ?? [] };
}

/**
 * The rules a workspace would get, given its actual pipeline stages.
 *
 * Pure — no database, no side effects — so the exact set can be previewed and
 * asserted in a test before anything is written. `existingNames` are skipped so
 * pressing the button twice tops the set up rather than duplicating it.
 */
export function planStarterRules(
  stages: { id: string; name: string }[],
  existingNames: string[] = []
): PlannedRule[] {
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  const planned: PlannedRule[] = [];

  const push = (rule: PlannedRule) => {
    if (taken.has(rule.name.trim().toLowerCase())) return;
    taken.add(rule.name.trim().toLowerCase());
    planned.push(rule);
  };

  for (const g of GENERIC_RULES) {
    push({
      name: g.name,
      event: g.event,
      conditions: {},
      recipients: expand(g.recipients),
      channels: g.channels,
      titleTemplate: g.titleTemplate,
      bodyTemplate: g.bodyTemplate,
    });
  }

  for (const spec of STAGE_RULES) {
    for (const stage of stages) {
      if (!spec.match.test(stage.name)) continue;
      push({
        name: spec.nameTemplate.replace("{{stage}}", stage.name),
        event: "stage_changed",
        conditions: { stageId: stage.id },
        recipients: expand(spec.recipients),
        channels: spec.channels,
        titleTemplate: spec.titleTemplate,
        bodyTemplate: spec.bodyTemplate,
      });
    }
  }

  return planned;
}
