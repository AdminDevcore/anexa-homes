"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
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
import { ActiveFilterChips, FilterBuilderButton } from "@/components/portal/pipeline-filters";
import {
  DeleteViewDialog,
  PipelineViewsMenu,
  SaveViewDialog,
  type SavedFilterView,
} from "@/components/portal/pipeline-views-menu";
import { deleteFilterViewAction, saveFilterViewAction } from "@/server/modules/pipeline/filter-views";
import {
  completeConditions,
  matchesDeal,
  sameFilter,
  stateFromSearchParams,
  stateToQuery,
  toStoredConditions,
  visibleStageColumns,
  type Condition,
  type DealPlacement,
  type FilterField,
  type FilterUrlState,
  type FilterableDeal,
  type MatchMode,
} from "@/lib/pipeline-filters";

export type ListLead = FilterableDeal &
  DealPlacement & {
    id: string;
    name: string;
    value: number;
    city: string | null;
    rep: string | null;
    serviceType: string;
    stageName: string;
    stageColor: string;
    createdAt: string;
  };

type Stage = { id: string; name: string; color: string; targetDays?: number };

type ViewDialog = { mode: "new" } | { mode: "edit"; view: SavedFilterView };

const readParams = (sp: URLSearchParams) => stateFromSearchParams(Object.fromEntries(sp.entries()));

export function PipelineView({
  title,
  count,
  stages,
  initialLeadsByStage,
  listLeads,
  canMove,
  fields,
  views,
  canShareViews,
}: {
  title: string;
  count: number;
  stages: Stage[];
  initialLeadsByStage: Record<string, BoardLead[]>;
  listLeads: ListLead[];
  canMove: boolean;
  fields: FilterField[];
  views: SavedFilterView[];
  canShareViews: boolean;
}) {
  const fmt = useFormat();
  const [view, setView] = React.useState<"kanban" | "list">("kanban");
  const [mounted, setMounted] = React.useState(false);

  // Filters live in the URL. Read at mount (server and browser see the same
  // params, so no hydration mismatch), and written back as they change — so
  // Back from a deal, a reload or a pasted link lands on the same board.
  const searchParams = useSearchParams();
  const paramsKey = searchParams.toString();
  const [filter, setFilter] = React.useState<FilterUrlState>(() => readParams(searchParams));
  // Every query string this component has written. The URL catching up to one
  // of them — possibly a stale one, mid-typing — is our own echo; anything else
  // (the sidebar's Pipeline link, which carries none) came from outside and wins.
  const written = React.useRef(new Set([paramsKey]));

  React.useEffect(() => {
    if (written.current.has(paramsKey)) return;
    written.current = new Set([paramsKey]);
    setFilter(readParams(new URLSearchParams(paramsKey)));
  }, [paramsKey]);

  React.useEffect(() => {
    const qs = stateToQuery(filter);
    if (qs === new URLSearchParams(window.location.search).toString()) return;
    written.current.add(qs);
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [filter]);

  React.useEffect(() => {
    const saved = window.localStorage.getItem("pipeline-view");
    if (saved === "list" || saved === "kanban") setView(saved);
    setMounted(true);
  }, []);

  function choose(v: "kanban" | "list") {
    setView(v);
    window.localStorage.setItem("pipeline-view", v);
  }

  const fieldMap = React.useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);
  const active = React.useMemo(() => completeConditions(filter.conditions, fieldMap), [filter.conditions, fieldMap]);
  const filtering = filter.q.trim() !== "" || active.length > 0;
  const activeView = views.find((v) => v.id === filter.viewId) ?? null;
  const dirty = activeView !== null && !sameFilter({ conditions: active, match: filter.match }, activeView);

  const shownLeads = React.useMemo(
    () =>
      filtering
        ? listLeads.filter((l) => matchesDeal(l, l, active, fieldMap, { q: filter.q, match: filter.match }))
        : listLeads,
    [filtering, listLeads, active, fieldMap, filter.q, filter.match]
  );
  const countMatches = React.useCallback(
    (draft: Condition[], match: MatchMode) =>
      listLeads.filter((l) => matchesDeal(l, l, draft, fieldMap, { q: filter.q, match })).length,
    [listLeads, fieldMap, filter.q]
  );

  // The board keeps its own column state (drags move cards without a reload),
  // so it asks per card and per column rather than being handed a filtered list.
  const dealsById = React.useMemo(() => new Map(listLeads.map((l) => [l.id, l])), [listLeads]);
  const isVisible = React.useCallback(
    (leadId: string, stage: Stage) => {
      const deal = dealsById.get(leadId);
      return (
        !deal ||
        matchesDeal(deal, { stageId: stage.id, targetDays: stage.targetDays ?? 0 }, active, fieldMap, {
          q: filter.q,
          match: filter.match,
        })
      );
    },
    [dealsById, active, fieldMap, filter.q, filter.match]
  );
  // A Stage condition narrows the board to the columns it allows.
  const visibleStageIds = React.useMemo(
    () => visibleStageColumns(stages.map((s) => s.id), active, fieldMap, filter.match),
    [active, fieldMap, stages, filter.match]
  );

  const setConditions = (conditions: Condition[]) => setFilter((f) => ({ ...f, conditions }));
  const applyFilters = (conditions: Condition[], match: MatchMode) => setFilter((f) => ({ ...f, conditions, match }));
  const clearAll = () => setFilter((f) => ({ ...f, conditions: [], match: "all", viewId: null }));
  const selectView = (v: SavedFilterView | null) =>
    setFilter((f) => ({
      ...f,
      viewId: v?.id ?? null,
      match: v?.match ?? "all",
      conditions: v ? v.conditions.map((c, i) => ({ ...c, id: `${v.id}-${i}` })) : [],
    }));

  // ── Saved views ──
  const [dialog, setDialog] = React.useState<ViewDialog | null>(null);
  const [dialogKey, setDialogKey] = React.useState(0);
  const [deleting, setDeleting] = React.useState<SavedFilterView | null>(null);
  const [pending, startTransition] = React.useTransition();

  function openDialog(d: ViewDialog) {
    setDialogKey((k) => k + 1);
    setDialog(d);
  }

  function saveView(name: string, shared: boolean) {
    const editing = dialog?.mode === "edit" ? dialog.view : null;
    startTransition(async () => {
      const res = await saveFilterViewAction({
        id: editing?.id,
        name,
        shared,
        // Renaming keeps what the view saved; a new view takes the board as it is.
        match: editing ? editing.match : filter.match,
        conditions: toStoredConditions(editing ? editing.conditions : active),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setDialog(null);
      if (!editing) setFilter((f) => ({ ...f, viewId: res.view.id }));
      toast.success(`Saved “${res.view.name}”`);
    });
  }

  function updateView(v: SavedFilterView) {
    startTransition(async () => {
      const res = await saveFilterViewAction({
        id: v.id,
        name: v.name,
        shared: v.shared,
        match: filter.match,
        conditions: toStoredConditions(active),
      });
      if (!res.ok) toast.error(res.error);
      else toast.success(`Updated “${v.name}”`);
    });
  }

  function confirmDelete() {
    const v = deleting;
    if (!v) return;
    startTransition(async () => {
      const res = await deleteFilterViewAction(v.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setDeleting(null);
      setFilter((f) => (f.viewId === v.id ? { ...f, viewId: null } : f));
      toast.success(`Deleted “${v.name}”`);
    });
  }

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
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filter.q}
              onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
              placeholder="Search deals by name, address…"
              className="h-9 pl-8"
              aria-label="Search this page"
            />
          </div>
          <PipelineViewsMenu
            views={views}
            active={activeView}
            dirty={dirty}
            hasFilters={active.length > 0}
            canShare={canShareViews}
            onSelect={selectView}
            onSaveNew={() => openDialog({ mode: "new" })}
            onUpdate={updateView}
            onEdit={(v) => openDialog({ mode: "edit", view: v })}
            onDelete={setDeleting}
          />
          <FilterBuilderButton
            fields={fields}
            conditions={active}
            match={filter.match}
            onApply={applyFilters}
            countMatches={countMatches}
            total={count}
            onSaveAsView={() => openDialog({ mode: "new" })}
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

      <ActiveFilterChips
        fields={fields}
        conditions={active}
        match={filter.match}
        onChange={setConditions}
        onClearAll={clearAll}
      />

      {!mounted ? (
        <div className="flex-1" />
      ) : view === "kanban" ? (
        <PipelineBoard
          stages={stages}
          initialLeadsByStage={initialLeadsByStage}
          canMove={canMove}
          filtering={filtering}
          isVisible={isVisible}
          visibleStageIds={visibleStageIds}
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

      <SaveViewDialog
        key={dialogKey}
        open={dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
        title={dialog?.mode === "edit" ? "Edit view" : "Save view"}
        initialName={dialog?.mode === "edit" ? dialog.view.name : ""}
        initialShared={dialog?.mode === "edit" ? dialog.view.shared : false}
        canShare={canShareViews}
        pending={pending}
        onSubmit={saveView}
      />
      <DeleteViewDialog
        view={deleting}
        pending={pending}
        onOpenChange={(open) => !open && setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
