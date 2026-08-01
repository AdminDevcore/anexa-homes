import type { BlockerParty, Role, StageType } from "@prisma/client";

/**
 * The canonical Solar pipeline: sales through NTP → PTO.
 *
 * The organising idea is that **no deal silently rots**, and the way you get
 * that is by refusing to treat two very different kinds of waiting as the same
 * thing:
 *
 *   INTERNALLY OWNED — we decide when it completes (design, scheduling,
 *     install, QC). It gets a hard SLA. Blowing it is our fault and escalates
 *     to the owning role.
 *
 *   EXTERNALLY BLOCKED — we are waiting on an AHJ, a utility, a lender or the
 *     customer (permit review, interconnection, inspection, PTO). It gets NO
 *     completion deadline, because we cannot control one. Instead it gets a
 *     chase cadence measured from OUR last touch. The question is "when did we
 *     last push on this?", never "why is our team late?".
 *
 * Get that wrong and every solar deal is permanently red by week three, the
 * team learns the colour means nothing, and the one deal that really is stuck
 * looks exactly like the ninety that are fine.
 */

/**
 * Stage owners are DEPARTMENT ROLES, never named people, so work keeps routing
 * correctly as staff join, leave and change seats.
 *
 * `role` maps each department role onto an RBAC role for notification routing
 * today. When a company outgrows that (a dedicated Permitting Coordinator seat),
 * the mapping is the only thing that changes.
 */
export const STAGE_OWNERS = {
  sales_rep: { label: "Sales Rep", role: "sales_rep" },
  finance: { label: "Finance / Credit", role: "accounting" },
  project_coordinator: { label: "Project Coordinator", role: "manager" },
  designer: { label: "Designer", role: "manager" },
  permitting_coordinator: { label: "Permitting Coordinator", role: "admin" },
  interconnection_coordinator: { label: "Interconnection Coordinator", role: "admin" },
  install_scheduler: { label: "Install Scheduler", role: "manager" },
  install_crew: { label: "Install Crew", role: "installer" },
  qc: { label: "QC Inspector", role: "manager" },
} as const satisfies Record<string, { label: string; role: Role }>;

export type StageOwnerKey = keyof typeof STAGE_OWNERS;

export function stageOwnerLabel(key: string | null | undefined): string | null {
  if (!key) return null;
  return (STAGE_OWNERS as Record<string, { label: string }>)[key]?.label ?? null;
}

export function stageOwnerRbacRole(key: string | null | undefined): Role | null {
  if (!key) return null;
  return (STAGE_OWNERS as Record<string, { role: Role }>)[key]?.role ?? null;
}

/** Human labels for who a deal is waiting on. */
export const BLOCKER_LABEL: Record<BlockerParty, string> = {
  us: "Us",
  ahj: "Building dept (AHJ)",
  utility: "Utility",
  customer: "Customer",
  lender: "Lender",
};

/** Colour per blocker so the aging report reads at a glance. */
export const BLOCKER_TONE: Record<BlockerParty, string> = {
  us: "bg-red-100 text-red-700", // the only one that is our fault
  ahj: "bg-violet-100 text-violet-700",
  utility: "bg-sky-100 text-sky-700",
  customer: "bg-amber-100 text-amber-700",
  lender: "bg-emerald-100 text-emerald-700",
};

export type SolarStageDef = {
  key: string;
  name: string;
  color: string;
  stageType: StageType;
  ownerRole: StageOwnerKey;
  /** internally_owned: hard deadline in days. */
  targetDays?: number;
  /** internally_owned: escalate this many days past target. */
  escalationDays?: number;
  /** externally_blocked: chase every N days, measured from our last touch. */
  followUpDays?: number;
  /** Action-required sub-state: the deal cannot advance until it is cleared. */
  isActionRequired?: boolean;
  defaultBlocker?: BlockerParty;
  isWon?: boolean;
  isLost?: boolean;
};

/**
 * Sales: getting to a signed contract. Mostly ours to drive, with two genuine
 * external waits (the lender's credit decision and the customer's signature).
 */
export const SOLAR_SALES_STAGES: SolarStageDef[] = [
  {
    key: "new_lead",
    name: "New Lead",
    color: "#A1A1AA",
    stageType: "internally_owned",
    ownerRole: "sales_rep",
    targetDays: 2,
    escalationDays: 2,
  },
  {
    key: "qualified",
    name: "Qualified",
    color: "#60A5FA",
    stageType: "internally_owned",
    ownerRole: "sales_rep",
    targetDays: 3,
    escalationDays: 3,
  },
  {
    key: "design_proposal",
    name: "Design / Proposal",
    color: "#38BDF8",
    stageType: "internally_owned",
    ownerRole: "designer",
    targetDays: 3,
    escalationDays: 2,
  },
  {
    key: "credit_submitted",
    name: "Credit / Finance Submitted",
    color: "#818CF8",
    stageType: "externally_blocked",
    ownerRole: "finance",
    followUpDays: 2,
    defaultBlocker: "lender",
  },
  {
    key: "credit_approved",
    name: "Credit Approved",
    color: "#A78BFA",
    stageType: "internally_owned",
    ownerRole: "sales_rep",
    targetDays: 2,
    escalationDays: 2,
  },
  {
    key: "contract_signed",
    name: "Contract Signed",
    color: "#FB923C",
    stageType: "externally_blocked",
    ownerRole: "sales_rep",
    followUpDays: 2,
    defaultBlocker: "customer",
  },
];

/**
 * Operations: NTP → PTO. This is where solar deals actually die, and where the
 * owned/blocked split earns its keep — roughly half of these stages are spent
 * waiting on a third party.
 */
export const SOLAR_OPS_STAGES: SolarStageDef[] = [
  {
    key: "ntp_submitted",
    name: "NTP Submitted",
    color: "#FBBF24",
    stageType: "externally_blocked",
    ownerRole: "project_coordinator",
    followUpDays: 3,
    defaultBlocker: "lender",
  },
  {
    key: "ntp_approved",
    name: "NTP Approved",
    color: "#FACC15",
    stageType: "internally_owned",
    ownerRole: "project_coordinator",
    targetDays: 2,
    escalationDays: 2,
  },
  {
    key: "site_survey_scheduled",
    name: "Site Survey Scheduled",
    color: "#FDE047",
    stageType: "internally_owned",
    ownerRole: "project_coordinator",
    targetDays: 5,
    escalationDays: 3,
  },
  {
    key: "site_survey_complete",
    name: "Site Survey Complete",
    color: "#A3E635",
    stageType: "internally_owned",
    ownerRole: "project_coordinator",
    targetDays: 2,
    escalationDays: 2,
  },
  {
    key: "engineering_design",
    name: "Engineering / Design (Plan Set)",
    color: "#84CC16",
    stageType: "internally_owned",
    ownerRole: "designer",
    targetDays: 7,
    escalationDays: 3,
  },
  {
    key: "design_redline",
    name: "Design Redline — Action Required",
    color: "#EF4444",
    stageType: "internally_owned",
    ownerRole: "designer",
    targetDays: 3,
    escalationDays: 2,
    isActionRequired: true,
    defaultBlocker: "us",
  },
  {
    key: "permit_submitted",
    name: "Permit Submitted",
    color: "#C084FC",
    stageType: "externally_blocked",
    ownerRole: "permitting_coordinator",
    followUpDays: 7,
    defaultBlocker: "ahj",
  },
  {
    key: "permit_redline",
    name: "Permit Redline — Action Required",
    color: "#EF4444",
    stageType: "internally_owned",
    ownerRole: "permitting_coordinator",
    targetDays: 3,
    escalationDays: 2,
    isActionRequired: true,
    defaultBlocker: "us",
  },
  {
    key: "permit_approved",
    name: "Permit Approved",
    color: "#D8B4FE",
    stageType: "internally_owned",
    ownerRole: "permitting_coordinator",
    targetDays: 2,
    escalationDays: 2,
  },
  {
    key: "interconnection_submitted",
    name: "Interconnection Application Submitted",
    color: "#22D3EE",
    stageType: "externally_blocked",
    ownerRole: "interconnection_coordinator",
    followUpDays: 7,
    defaultBlocker: "utility",
  },
  {
    key: "interconnection_approved",
    name: "Interconnection Approved",
    color: "#67E8F9",
    stageType: "internally_owned",
    ownerRole: "interconnection_coordinator",
    targetDays: 2,
    escalationDays: 2,
  },
  {
    key: "install_scheduled",
    name: "Install Scheduled",
    color: "#F97316",
    stageType: "internally_owned",
    ownerRole: "install_scheduler",
    targetDays: 10,
    escalationDays: 5,
  },
  {
    key: "mpu_derate",
    name: "MPU / Derate (if required)",
    color: "#FB7185",
    stageType: "internally_owned",
    ownerRole: "project_coordinator",
    targetDays: 10,
    escalationDays: 5,
  },
  {
    key: "installed",
    name: "Installed",
    color: "#34D399",
    stageType: "internally_owned",
    ownerRole: "install_crew",
    targetDays: 1,
    escalationDays: 1,
  },
  {
    key: "inspection",
    name: "Building / Electrical Inspection",
    color: "#2DD4BF",
    stageType: "externally_blocked",
    ownerRole: "permitting_coordinator",
    followUpDays: 5,
    defaultBlocker: "ahj",
  },
  {
    key: "inspection_corrections",
    name: "Inspection Corrections — Action Required",
    color: "#EF4444",
    stageType: "internally_owned",
    ownerRole: "qc",
    targetDays: 3,
    escalationDays: 2,
    isActionRequired: true,
    defaultBlocker: "us",
  },
  {
    key: "inspection_passed",
    name: "Inspection Passed",
    color: "#4ADE80",
    stageType: "internally_owned",
    ownerRole: "qc",
    targetDays: 2,
    escalationDays: 2,
  },
  {
    key: "utility_pto",
    name: "Utility PTO",
    color: "#22C55E",
    stageType: "externally_blocked",
    ownerRole: "interconnection_coordinator",
    followUpDays: 7,
    defaultBlocker: "utility",
  },
  {
    key: "system_activated",
    name: "System Activated / Monitoring",
    color: "#16A34A",
    stageType: "internally_owned",
    ownerRole: "qc",
    targetDays: 3,
    escalationDays: 2,
    isWon: true,
  },
];

/** The full canonical Solar pipeline, in order. */
export const SOLAR_STAGES: SolarStageDef[] = [...SOLAR_SALES_STAGES, ...SOLAR_OPS_STAGES];

/**
 * Stages at which the site is physically assessed, and therefore where a
 * re-roof or main-panel upgrade gets discovered. Used to prompt the crossover
 * check so it is asked at the right moment rather than remembered later.
 */
export const CROSSOVER_PROMPT_STAGES = new Set([
  "site_survey_complete",
  "engineering_design",
  "design_redline",
]);
