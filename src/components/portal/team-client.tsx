"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search, ArrowUpDown, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatDate, initials } from "@/lib/format";

type Member = {
  id: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  title: string | null;
  status: string;
  avatarUrl: string | null;
  createdAt: string;
};

const ROLE_ORDER = ["super_admin", "admin", "manager", "sales_rep", "canvasser", "marketing", "installer", "accounting"];
const roleRank = (r: string) => { const i = ROLE_ORDER.indexOf(r); return i === -1 ? 99 : i; };
type SortCol = "name" | "role" | "title" | "status" | "createdAt";

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  invited: "bg-blue-100 text-blue-700",
  suspended: "bg-amber-100 text-amber-700",
  disabled: "bg-red-100 text-red-700",
};

export function TeamClient({ members, roles }: { members: Member[]; roles: { value: string; label: string }[] }) {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [roleF, setRoleF] = React.useState("all");
  const [statusF, setStatusF] = React.useState("all");
  const [grouped, setGrouped] = React.useState(true);
  const [sort, setSort] = React.useState<{ col: SortCol; dir: 1 | -1 }>({ col: "role", dir: 1 });

  const filtered = members.filter((m) => {
    if (roleF !== "all" && m.role !== roleF) return false;
    if (statusF !== "all" && m.status !== statusF) return false;
    if (q.trim()) {
      const s = q.toLowerCase();
      if (!m.name.toLowerCase().includes(s) && !m.email.toLowerCase().includes(s)) return false;
    }
    return true;
  });

  function cmp(a: Member, b: Member, col: SortCol, dir: number) {
    let av: string | number, bv: string | number;
    if (col === "role") { av = roleRank(a.role); bv = roleRank(b.role); }
    else if (col === "createdAt") { av = a.createdAt; bv = b.createdAt; }
    else { av = (a[col] ?? "").toString().toLowerCase(); bv = (b[col] ?? "").toString().toLowerCase(); }
    return av < bv ? -dir : av > bv ? dir : a.name.localeCompare(b.name);
  }

  const sorted = [...filtered].sort((a, b) => cmp(a, b, sort.col, sort.dir));

  // Grouped view: members under role headers in hierarchy order.
  const groups = grouped
    ? ROLE_ORDER.map((role) => ({
        role,
        label: roles.find((r) => r.value === role)?.label ?? role,
        members: filtered.filter((m) => m.role === role).sort((a, b) => a.name.localeCompare(b.name)),
      })).filter((g) => g.members.length > 0)
    : [];

  function toggleSort(col: SortCol) {
    setGrouped(false);
    setSort((s) => (s.col === col ? { col, dir: (s.dir * -1) as 1 | -1 } : { col, dir: 1 }));
  }

  const Th = ({ col, children, className }: { col: SortCol; children: React.ReactNode; className?: string }) => (
    <th className={cn("px-4 py-2.5 text-left font-semibold", className)}>
      <button onClick={() => toggleSort(col)} className="inline-flex items-center gap-1 hover:text-foreground">
        {children}<ArrowUpDown className={cn("size-3", !grouped && sort.col === col ? "text-foreground" : "text-muted-foreground/40")} />
      </button>
    </th>
  );

  const Row = ({ m }: { m: Member }) => (
    <tr onClick={() => router.push(`/portal/team/${m.id}`)} className="cursor-pointer hover:bg-muted/50">
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <Avatar className="size-8 border border-border">
            {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt={m.name} />}
            <AvatarFallback className="bg-foreground text-[10px] font-semibold text-background">{initials(m.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="font-medium">{m.name}</div>
            <div className="truncate text-xs text-muted-foreground">{m.email}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-2.5">
        <span className="rounded-full bg-gold/15 px-2.5 py-1 text-[11px] font-medium text-gold-muted">{m.roleLabel}</span>
      </td>
      <td className="hidden px-4 py-2.5 text-sm text-muted-foreground md:table-cell">{m.title ?? "—"}</td>
      <td className="px-4 py-2.5">
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium capitalize", STATUS_STYLES[m.status] ?? "bg-muted text-muted-foreground")}>{m.status}</span>
      </td>
      <td className="hidden px-4 py-2.5 text-sm text-muted-foreground tabular-nums xl:table-cell">{formatDate(m.createdAt)}</td>
    </tr>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" className="h-9 w-56 pl-7" />
        </div>
        <Select value={roleF} onValueChange={setRoleF}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {roles.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusF} onValueChange={setStatusF}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="invited">Invited</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
            <SelectItem value="disabled">Disabled</SelectItem>
          </SelectContent>
        </Select>
        <button
          onClick={() => setGrouped((g) => !g)}
          className={cn("inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium", grouped ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}
        >
          <Users className="size-4" /> Group by role
        </button>
        <span className="ml-auto text-sm text-muted-foreground">{filtered.length} member{filtered.length === 1 ? "" : "s"}</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <Th col="name">Name</Th>
              <Th col="role">Role</Th>
              <Th col="title" className="hidden md:table-cell">Title</Th>
              <Th col="status">Status</Th>
              <Th col="createdAt" className="hidden xl:table-cell">Joined</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No team members match.</td></tr>
            )}
            {grouped
              ? groups.map((g) => (
                  <React.Fragment key={g.role}>
                    <tr className="bg-muted/30">
                      <td colSpan={5} className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {g.label} <span className="ml-1 rounded-full bg-background px-1.5 py-0.5 tabular-nums">{g.members.length}</span>
                      </td>
                    </tr>
                    {g.members.map((m) => <Row key={m.id} m={m} />)}
                  </React.Fragment>
                ))
              : sorted.map((m) => <Row key={m.id} m={m} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
