"use client";

import * as React from "react";
import Link from "next/link";
import { KanbanSquare, List } from "lucide-react";
import { cn } from "@/lib/utils";
import { PipelineBoard, type BoardLead } from "./pipeline-board";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useFormat } from "@/components/portal/branding-provider";
import { serviceTypeLabel } from "@/lib/service-types";

export type ListLead = {
  id: string;
  name: string;
  value: number;
  city: string | null;
  /** Full street/city/state/ZIP — searchable, but only `city` is rendered. */
  addressText: string | null;
  rep: string | null;
  serviceType: string;
  stageName: string;
  stageColor: string;
  createdAt: string;
};

type Stage = { id: string; name: string; color: string; targetDays?: number };

export function PipelineView({
  title,
  count,
  stages,
  initialLeadsByStage,
  listLeads,
  canMove,
}: {
  title: string;
  count: number;
  stages: Stage[];
  initialLeadsByStage: Record<string, BoardLead[]>;
  listLeads: ListLead[];
  canMove: boolean;
}) {
  const fmt = useFormat();
  const [view, setView] = React.useState<"kanban" | "list">("kanban");
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    const saved = window.localStorage.getItem("pipeline-view");
    if (saved === "list" || saved === "kanban") setView(saved);
    setMounted(true);
  }, []);

  function choose(v: "kanban" | "list") {
    setView(v);
    window.localStorage.setItem("pipeline-view", v);
  }

  return (
    <div className={cn("flex flex-col space-y-4", view === "kanban" && "h-[calc(100vh-8rem)]")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {count} active {count === 1 ? "deal" : "deals"}
            {view === "kanban" ? " · drag cards to move stages" : ""}
          </p>
        </div>
        <div className="inline-flex overflow-hidden rounded-lg border border-border">
          <button
            onClick={() => choose("kanban")}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors",
              view === "kanban" ? "bg-foreground text-background" : "hover:bg-muted"
            )}
          >
            <KanbanSquare className="size-4" /> Kanban
          </button>
          <button
            onClick={() => choose("list")}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors",
              view === "list" ? "bg-foreground text-background" : "hover:bg-muted"
            )}
          >
            <List className="size-4" /> List
          </button>
        </div>
      </div>

      {!mounted ? (
        <div className="flex-1" />
      ) : view === "kanban" ? (
        <PipelineBoard stages={stages} initialLeadsByStage={initialLeadsByStage} canMove={canMove} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="hidden sm:table-cell">Type</TableHead>
                <TableHead className="hidden lg:table-cell">Rep</TableHead>
                <TableHead className="hidden md:table-cell">Location</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="hidden xl:table-cell">Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listLeads.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    No deals in the pipeline.
                  </TableCell>
                </TableRow>
              ) : (
                listLeads.map((l) => (
                  <TableRow
                    key={l.id}
                    className="cursor-pointer"
                    data-search-item
                    data-search-text={l.addressText ?? undefined}
                  >
                    <TableCell className="font-medium">
                      <Link href={`/portal/leads/${l.id}`} className="hover:text-gold-muted">
                        {l.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span
                        className="inline-block rounded-full px-2 py-0.5 text-xs font-medium"
                        style={{ backgroundColor: `${l.stageColor}22`, color: l.stageColor }}
                      >
                        {l.stageName}
                      </span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                      {serviceTypeLabel(l.serviceType as never)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{l.rep ?? "—"}</TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{l.city ?? "—"}</TableCell>
                    <TableCell className="text-right font-semibold">{fmt.money(l.value, { compact: true })}</TableCell>
                    <TableCell className="hidden xl:table-cell text-sm text-muted-foreground">{fmt.date(l.createdAt)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
