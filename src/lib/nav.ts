import {
  LayoutDashboard,
  Users,
  KanbanSquare,
  FileSignature,
  DollarSign,
  Wallet,
  BarChart3,
  Settings,
  UserCog,
  ListTodo,
  MessagesSquare,
  MapPinned,
  CalendarDays,
  Calculator,
  GraduationCap,
  Hammer,
  ReceiptText,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@prisma/client";
import type { Resource } from "@/server/rbac/matrix";

/**
 * A second-level route that lives INSIDE a sidebar item rather than beside it.
 *
 * A tab carries its own resource gate, so an item can be visible to everyone
 * while one of its tabs is not: Commissions is every rep's page, and the
 * Contractor Pay tab on it belongs to accounting alone.
 */
export type NavTab = {
  label: string;
  href: string;
  icon: LucideIcon;
  resource: Resource;
};

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  resource: Resource; // user must be able to "read" this resource to see the item
  /**
   * Narrows an item to specific roles ON TOP of the resource check, for a page
   * that exists because of who someone is rather than what they may read.
   * "My Jobs" is every installer's whole portal and nobody else's business —
   * gating it on Project:read alone would have put it in front of the entire
   * sales floor, who reach the same jobs through the pipeline.
   *
   * It can only ever REMOVE an item: an entry listing a role its resource
   * check would reject is still hidden.
   */
  roles?: Role[];
  customerHidden?: boolean;
  /**
   * Routes this item owns as tabs. They do NOT get sidebar rows of their own —
   * the item highlights on all of them, and the page draws the tab strip.
   */
  tabs?: NavTab[];
};

/**
 * The two halves of what the company pays out: what the SALES FLOOR earned and
 * what the CREWS billed. One sidebar item, one page, two tabs — they answer the
 * same question ("who are we about to pay, and for what") and they empty into
 * the same payroll run, so splitting them across two sidebar rows meant two
 * screens that did not know about each other.
 *
 * Most people hold only the first tab (ContractorInvoice is accounting's alone
 * in the RBAC matrix), and a lone tab is not drawn as a choice, so a rep's
 * page looks exactly as it did before the merge.
 */
export const PAY_TABS: NavTab[] = [
  { label: "Commissions", href: "/portal/commissions", icon: DollarSign, resource: "Commission" },
  { label: "Contractor Pay", href: "/portal/contractor-pay", icon: ReceiptText, resource: "ContractorInvoice" },
];

/** Every route an item owns — its own plus its tabs'. Used for highlighting. */
export function navRoutes(item: NavItem): string[] {
  return [item.href, ...(item.tabs ?? []).map((t) => t.href)];
}

export const PORTAL_NAV: NavItem[] = [
  { label: "Dashboard", href: "/portal/dashboard", icon: LayoutDashboard, resource: "Project" },
  { label: "Appointments", href: "/portal/leads", icon: Users, resource: "Lead" },
  { label: "Pipeline", href: "/portal/pipeline", icon: KanbanSquare, resource: "Lead" },
  { label: "Calendar", href: "/portal/calendar", icon: CalendarDays, resource: "Project" },
  { label: "Field Map", href: "/portal/canvassing", icon: MapPinned, resource: "Canvassing" },
  // Storm Intel is folded into the Field Map (Storm leads / Address checker / Zones tabs).
  { label: "Tasks", href: "/portal/tasks", icon: ListTodo, resource: "Task" },
  { label: "Chat", href: "/portal/chat", icon: MessagesSquare, resource: "Chat" },
  { label: "Documents", href: "/portal/documents", icon: FileSignature, resource: "Document" },
  { label: "Knowledge Base", href: "/portal/knowledge", icon: GraduationCap, resource: "Knowledge", customerHidden: true },
  // An installer reaches no deal page (see rbac/policies.ts), so this is the
  // only way in to the job he is standing on — and the only way to bill it.
  { label: "My Jobs", href: "/portal/jobs", icon: Hammer, resource: "Project", roles: ["installer"] },
  { label: "Commissions", href: "/portal/commissions", icon: DollarSign, resource: "Commission", tabs: PAY_TABS },
  { label: "Payroll", href: "/portal/payroll", icon: Wallet, resource: "Payroll" },
  { label: "Bookkeeping", href: "/portal/bookkeeping", icon: Calculator, resource: "Bookkeeping" },
  { label: "Reports", href: "/portal/reports", icon: BarChart3, resource: "Report" },
  { label: "Team", href: "/portal/team", icon: UserCog, resource: "User" },
  { label: "Settings", href: "/portal/settings", icon: Settings, resource: "Settings" },
];
