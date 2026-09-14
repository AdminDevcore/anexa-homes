"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { KanbanSquare, List, Search } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { useFormat } from "@/components/portal/branding-provider";
import { serviceTypeLabel } from "@/lib/service-types";
import { stageChipStyle } from "@/lib/chip-color";
import { ActivePipelineFilters, PipelineFiltersButton } from "@/components/portal/pipeline-filters";
import {
  buildFilterOptions,
  filtersFromSearchParams,
  filtersToQuery,
  isFiltering,
  matchesPipelineFilters,
  type FilterableDeal,
  type PipelineFilters,
} from "@/lib/pipeline-filters";

export type ListLead = FilterableDeal & {
  id: string;
  serviceType: string;
  stageId: string | null;
  stageName: string;
  stageColor: string;
  targetDays: number;
};

type Stage = { id: string; name: string; color: string; targetDays?: number };

const readParams = (sp: URLSearchParams) => filtersFromSearchParams(Object.fromEntries(sp.entries()));

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

  // Filters live in the URL. Read at mount (server and browser see the same
  // params, so no hydration mismatch), and written back as they change — so
  // Back from a deal, or a reload, lands on the same narrowed board.
  const searchParams = useSearchParams();
  const paramsKey = searchParams.toString();
  const [filters, setFilters] = React.useState<PipelineFilters>(() => readParams(searchParams));
  // Every query string this component has written. The URL catching up to one
  // of them — possibly a stale one, mid-typing — is our own echo; anything else
  // (the sidebar's Pipeline link, which carries none) came from outside and wins.
  const written = React.useRef(new Set([paramsKey]));

  React.useEffect(() => {
    if (written.current.has(paramsKey)) return;
    written.current = new Set([paramsKey]);
    setFilters(readParams(new URLSearchParams(paramsKey)));
  }, [paramsKey]);

  React.useEffect(() => {
    const qs = filtersToQuery(filters);
    if (qs === new URLSearchParams(window.location.search).toString()) return;
    written.current.add(qs);
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [filters]);

  const patch = React.useCallback((p: Partial<PipelineFilters>) => setFilters((f) => ({ ...f, ...p })), []);

  React.useEffect(() => {
    const saved = window.localStorage.getItem("pipeline-view");
    if (saved === "list" || saved === "kanban") setView(saved);
    setMounted(true);
  }, []);

  function choose(v: "kanban" | "list") {
    setView(v);
    window.localStorage.setItem("pipeline-view", v);
  }

  const filtering = isFiltering(filters);
  const options = React.useMemo(() => buildFilterOptions(listLeads), [listLeads]);
  const stageOptions = React.useMemo(
    () =>
      stages.map((s) => ({
        value: s.id,
        label: s.name,
        count: listLeads.filter((l) => l.stageId === s.id).length,
      })),
    [stages, listLeads]
  );
  const shownLeads = React.useMemo(
    () =>
      filtering
        ? listLeads.filter((l) => matchesPipelineFilters(l, { stageId: l.stageId, targetDays: l.targetDays }, filters))
        : listLeads,
    [filtering, listLeads, filters]
  );
  const noun = count === 1 ? "deal" : "deals";

  return (
    <div className={cn("flex flex-col space-y-4", view === "kanban" && "h-[calc(100vh-8rem)]")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {(filtering ? `${shownLeads.length} of ${count} ${noun}` : `${count} active ${noun}`) +
              (view === "kanban" ? " · drag cards to move stages" : "")}
          </p>
        </div>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filters.q}
              onChange={(e) => patch({ q: e.target.value })}
              placeholder="Search deals by name, address…"
              className="h-9 pl-8"
              aria-label="Search this page"
            />
          </div>
          <PipelineFiltersButton
            filters={filters}
            onChange={patch}
            options={options}
            stages={stageOptions}
            shown={shownLeads.length}
            total={count}
          />
          <div className="inline-flex shrink-0 overflow-hidden rounded-lg border border-border">
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
      </div>

      <ActivePipelineFilters filters={filters} onChange={patch} options={options} stages={stageOptions} />

      {!mounted ? (
        <div className="flex-1" />
      ) : view === "kanban" ? (
        <PipelineBoard
          stages={stages}
          initialLeadsByStage={initialLeadsByStage}
          canMove={canMove}
          filters={filters}
        />
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
              {shownLeads.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    {filtering ? "No deals match these filters." : "No deals in the pipeline."}
                  </TableCell>
                </TableRow>
              ) : (
                shownLeads.map((l) => (
                  <TableRow key={l.id} className="cursor-pointer">
                    <TableCell className="font-medium">
                      <Link href={`/portal/leads/${l.id}`} className="hover:text-gold-muted">
                        {l.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span
                        className="inline-block rounded-full border px-2 py-0.5 text-xs font-medium"
                        style={stageChipStyle(l.stageColor)}
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
