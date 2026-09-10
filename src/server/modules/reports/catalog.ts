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
  | "contractorPay"
  | "funnel"
  | "leadSources"
  | "canvassing"
  | "scorecard"
  | "claims"
  | "arAging"
  | "production";

/** Cards are shown under labeled groups on the hub for hierarchy. */
export type ReportGroup = "company" | "sales" | "ops_finance" | "production";

export const GROUP_LABELS: Record<ReportGroup, string> = {
  company: "Company report",
  sales: "Sales & marketing",
  ops_finance: "Operations & finance",
  production: "Production",
};

const GROUP_ORDER: ReportGroup[] = ["company", "sales", "ops_finance", "production"];

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
    id: "funnel",
    title: "Sales Funnel & Velocity",
    description: "Stage-by-stage pipeline waterfall, time-in-stage, and where deals stall.",
    href: "/portal/reports/funnel",
    icon: "funnel",
    group: "sales",
    action: "read",
    resource: "Report",
  },
  {
    id: "lead-sources",
    title: "Lead Source ROI",
    description: "Leads, wins, close rate, and revenue by marketing channel.",
    href: "/portal/reports/lead-sources",
    icon: "leadSources",
    group: "sales",
    action: "read",
    resource: "Report",
  },
  {
    id: "canvassing",
    title: "Canvassing Productivity",
    description: "Knock → contact → appointment → lead funnel, by canvasser and territory.",
    href: "/portal/reports/canvassing",
    icon: "canvassing",
    group: "sales",
    action: "read",
    resource: "Report",
  },
  {
    id: "rep-scorecard",
    title: "Rep Scorecard",
    description: "Per-rep appointments, close rate, jobs, revenue, commission, and open tasks.",
    href: "/portal/reports/rep-scorecard",
    icon: "scorecard",
    group: "sales",
    action: "read",
    resource: "Report",
  },
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
    title: "Overdue Jobs",
    description: "Every job past its stage day-limit, grouped by the stage it's stuck in.",
    href: "/portal/reports/delinquency",
    icon: "delinquency",
    group: "ops_finance",
    action: "read",
    resource: "Report",
  },
  // Contractor Pay is no longer a card here. It moved to /portal/contractor-pay
  // — the Contractor Pay tab on Commissions — so the money owed to a crew sits
  // beside the invoices that crew submitted, and the payout report hangs off
  // that tab's header. Its old URL redirects; the `contractorPay` icon key is
  // kept in ReportIcon because the hub still maps icons by name and removing a
  // value there is a wider change than removing a card.
  {
    id: "claims",
    title: "Claims & Supplement Capture",
    description: "RCV/ACV exposure, recoverable depreciation, and supplement approval rate.",
    href: "/portal/reports/claims",
    icon: "claims",
    group: "ops_finance",
    action: "read",
    resource: "Report",
  },
  {
    id: "ar-aging",
    title: "A/R Collections Aging",
    description: "Every unpaid invoice bucketed by how far past due — who owes you and how late.",
    href: "/portal/reports/ar-aging",
    icon: "arAging",
    group: "ops_finance",
    action: "read",
    resource: "Report",
  },
  {
    id: "production",
    title: "Production & Throughput",
    description: "Jobs by production status, squares completed, and installs scheduled.",
    href: "/portal/reports/production",
    icon: "production",
    group: "production",
    action: "read",
    resource: "Report",
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
