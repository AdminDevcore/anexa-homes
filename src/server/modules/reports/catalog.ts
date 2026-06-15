import { can, type AccessUser } from "@/server/rbac/guards";
import type { Action, Resource } from "@/server/rbac/matrix";
import { allowedSections, type ReportType } from "./builders";

/** Icon keys map to lucide-react icons in the hub page (keeps this file server-safe). */
export type ReportIcon =
  | "executive"
  | "operations"
  | "financial"
  | "payroll"
  | "jobs"
  | "delinquency"
  | "contractorPay";

/** Cards are shown under labeled groups on the hub for hierarchy. */
export type ReportGroup = "company" | "ops_finance";

export const GROUP_LABELS: Record<ReportGroup, string> = {
  company: "Company report",
  ops_finance: "Operations & finance",
};

const GROUP_ORDER: ReportGroup[] = ["company", "ops_finance"];

export type ReportCard = {
  id: string;
  title: string;
  description: string;
  href: string;
  icon: ReportIcon;
  group: ReportGroup;
  /** RBAC gate — the viewer must be able to `action` this `resource` to see the card. */
  action: Action;
  resource: Resource;
  /** Set for the standalone Company-Report sections; also gated by role's allowed sections. */
  section?: ReportType;
};

/** The four Company-Report sections, each now its own standalone report. */
export const SECTION_META: Record<ReportType, { title: string; description: string; icon: ReportIcon }> = {
  executive: {
    title: "Executive Summary",
    description: "At-a-glance scorecard — sales, cash, profit, backlog, and liabilities with trends.",
    icon: "executive",
  },
  operations: {
    title: "Operations",
    description: "Appointments, closing rate, jobs by status, and production by rep.",
    icon: "operations",
  },
  financial: {
    title: "Financial",
    description: "Revenue, collections, commissions owed, and contractor spend.",
    icon: "financial",
  },
  payroll: {
    title: "Payroll",
    description: "Payroll runs and upcoming commissions by person.",
    icon: "payroll",
  },
};

/** Reports that aren't a Company-Report section. */
const STATIC_CARDS: ReportCard[] = [
  {
    id: "jobs",
    title: "Job Profitability",
    description: "Per-job contract, supplement, cost, commission, and profit — estimated vs. actual.",
    href: "/portal/reports/jobs",
    icon: "jobs",
    group: "ops_finance",
    action: "read",
    resource: "Commission",
  },
  {
    id: "delinquency",
    title: "Delinquency / Follow-up",
    description: "Every deal sitting in a pipeline stage past its day limit, grouped by stage.",
    href: "/portal/reports/delinquency",
    icon: "delinquency",
    group: "ops_finance",
    action: "read",
    resource: "Report",
  },
  {
    id: "contractor-pay",
    title: "Contractor Pay",
    description: "Money paid and still owed to installer-crews and 1099 contractors.",
    href: "/portal/reports/contractor-pay",
    icon: "contractorPay",
    group: "ops_finance",
    action: "read",
    resource: "Commission",
  },
];

/** The report cards this viewer is allowed to open. */
export function visibleReportCards(user: AccessUser): ReportCard[] {
  const sectionCards: ReportCard[] = allowedSections(user.role).map((s) => ({
    id: s,
    title: SECTION_META[s].title,
    description: SECTION_META[s].description,
    href: `/portal/reports/${s}`,
    icon: SECTION_META[s].icon,
    group: "company",
    action: "read",
    resource: "Report",
    section: s,
  }));
  return [...sectionCards, ...STATIC_CARDS].filter((c) => can(user, c.action, c.resource));
}

/** Visible cards bucketed into labeled groups (empty groups dropped), in display order. */
export function visibleReportGroups(user: AccessUser): { group: ReportGroup; label: string; cards: ReportCard[] }[] {
  const cards = visibleReportCards(user);
  return GROUP_ORDER.map((group) => ({
    group,
    label: GROUP_LABELS[group],
    cards: cards.filter((c) => c.group === group),
  })).filter((g) => g.cards.length > 0);
}
