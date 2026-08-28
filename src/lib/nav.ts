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
  Star,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@prisma/client";
import type { Resource } from "@/server/rbac/matrix";

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
};

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
  { label: "Commissions", href: "/portal/commissions", icon: DollarSign, resource: "Commission" },
  { label: "Payroll", href: "/portal/payroll", icon: Wallet, resource: "Payroll" },
  { label: "Contractor Pay", href: "/portal/contractor-pay", icon: ReceiptText, resource: "ContractorInvoice" },
  { label: "Bookkeeping", href: "/portal/bookkeeping", icon: Calculator, resource: "Bookkeeping" },
  { label: "Reports", href: "/portal/reports", icon: BarChart3, resource: "Report" },
  { label: "Reviews", href: "/portal/settings/reviews", icon: Star, resource: "Review", customerHidden: true },
  { label: "Team", href: "/portal/team", icon: UserCog, resource: "User" },
  { label: "Settings", href: "/portal/settings", icon: Settings, resource: "Settings" },
];
