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
  Star,
  type LucideIcon,
} from "lucide-react";
import type { Resource } from "@/server/rbac/matrix";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  resource: Resource; // user must be able to "read" this resource to see the item
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
  { label: "Commissions", href: "/portal/commissions", icon: DollarSign, resource: "Commission" },
  { label: "Payroll", href: "/portal/payroll", icon: Wallet, resource: "Payroll" },
  { label: "Bookkeeping", href: "/portal/bookkeeping", icon: Calculator, resource: "Bookkeeping" },
  { label: "Reports", href: "/portal/reports", icon: BarChart3, resource: "Report" },
  { label: "Reviews", href: "/portal/settings/reviews", icon: Star, resource: "Review", customerHidden: true },
  { label: "Team", href: "/portal/team", icon: UserCog, resource: "User" },
  { label: "Settings", href: "/portal/settings", icon: Settings, resource: "Settings" },
];
