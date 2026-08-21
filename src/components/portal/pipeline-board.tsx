"use client";

import * as React from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { GripVertical, Phone, MapPin, CalendarClock, Timer, PlayCircle, ClipboardCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFormat } from "@/components/portal/branding-provider";
import { moveLeadStage } from "@/server/modules/leads/actions";
import { stageAccent } from "@/lib/chip-color";

export type BoardLead = {
  id: string;
  name: string;
  value: number;
  phone: string | null;
  city: string | null;
  /** Full street/city/state/ZIP — searchable, but only `city` is rendered. */
  addressText: string | null;
  rep: string | null;
  // Whole-day ages (computed server-side): total age since the appointment was
  // booked, and time spent in the current stage.
  ageDays: number;
  stageDays: number;
  // Recorded outcomes (null until set on the deal).
  appointmentOutcome: string | null;
  inspectionOutcome: string | null;
};
type Stage = { id: string; name: string; color: string; targetDays?: number };

// "3d" / "1d" / "today" — compact day count for the age badges.
function fmtDays(d: number) {
  return d <= 0 ? "today" : `${d}d`;
}

// First-letter initials for the card avatar (max two).
function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function PipelineBoard({
  stages,
  initialLeadsByStage,
  canMove,
}: {
  stages: Stage[];
  initialLeadsByStage: Record<string, BoardLead[]>;
  canMove: boolean;
}) {
  const fmt = useFormat();
  const [columns, setColumns] = React.useState(initialLeadsByStage);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const colorByStage = React.useMemo(
    () => Object.fromEntries(stages.map((s) => [s.id, s.color])),
    [stages]
  );

  const findLead = React.useCallback(
    (id: string): { lead: BoardLead; stageId: string } | null => {
      for (const [stageId, leads] of Object.entries(columns)) {
        const lead = leads.find((l) => l.id === id);
        if (lead) return { lead, stageId };
      }
      return null;
    },
    [columns]
  );

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const leadId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId) return;

    const from = findLead(leadId);
    if (!from || from.stageId === overId) return;
    if (!canMove) {
      toast.error("You don't have permission to move leads.");
      return;
    }

    const prev = columns;
    // Optimistic update
    setColumns((cols) => {
      const next: Record<string, BoardLead[]> = {};
      for (const [sid, leads] of Object.entries(cols)) next[sid] = leads.filter((l) => l.id !== leadId);
      next[overId] = [from.lead, ...(next[overId] ?? [])];
      return next;
    });

    const res = await moveLeadStage({ leadId, stageId: overId });
    if (!res.ok) {
      setColumns(prev);
      toast.error(res.error);
    } else {
      toast.success("Appointment moved");
    }
  }

  const active = activeId ? findLead(activeId) : null;

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex flex-1 gap-3 overflow-x-auto pb-4">
        {stages.map((stage) => (
          <Column key={stage.id} stage={stage} leads={columns[stage.id] ?? []} canMove={canMove} />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {active ? <Card lead={active.lead} accent={colorByStage[active.stageId] ?? "#A1A1AA"} canMove overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({ stage, leads, canMove }: { stage: Stage; leads: BoardLead[]; canMove: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const fmt = useFormat();
  const total = leads.reduce((sum, l) => sum + l.value, 0);

  return (
    <div className="flex w-[19rem] shrink-0 flex-col" data-testid="pipeline-column">
      {/* Column header */}
      <div className="mb-2 rounded-xl border border-border bg-card px-3 py-2.5 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: stageAccent(stage.color) }} />
            <span className="truncate text-sm font-semibold">{stage.name}</span>
            <span className="shrink-0 rounded-full bg-muted px-1.5 text-xs font-medium text-muted-foreground">
              {leads.length}
            </span>
          </div>
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {fmt.money(total, { compact: true })}
          </span>
        </div>
        {/* Stage-colored accent rule under the header */}
        <div className="mt-2 h-0.5 w-full rounded-full" style={{ backgroundColor: "var(--muted)" }}>
          <div className="h-full rounded-full" style={{ backgroundColor: stageAccent(stage.color), width: leads.length ? "100%" : "0%" }} />
        </div>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        data-testid="pipeline-dropzone"
        className={cn(
          "flex flex-1 flex-col gap-2.5 overflow-y-auto rounded-xl border border-dashed border-transparent p-1.5 transition-colors",
          isOver && "border-gold/50 bg-gold/5"
        )}
      >
        {leads.map((lead) => (
          <Card key={lead.id} lead={lead} accent={stageAccent(stage.color)} canMove={canMove} targetDays={stage.targetDays ?? 0} />
        ))}
        {leads.length === 0 && (
          <div className="m-1 flex flex-1 items-center justify-center rounded-xl border border-dashed border-border/70 px-2 py-10 text-center text-xs text-muted-foreground">
            Drop appointments here
          </div>
        )}
      </div>
    </div>
  );
}

function Card({
  lead,
  accent,
  canMove,
  overlay = false,
  targetDays = 0,
}: {
  lead: BoardLead;
  accent: string;
  canMove: boolean;
  overlay?: boolean;
  targetDays?: number;
}) {
  const fmt = useFormat();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: lead.id,
    disabled: !canMove,
  });
  // NOTE: do NOT apply useDraggable's `transform` to the source card. We render a
  // <DragOverlay> (a position:fixed sibling of the board) as the moving copy, so the
  // source must stay put — otherwise it translates out of the board's overflow-x-auto
  // container and gets clipped at the sidebar edge. We only dim it in place instead.

  return (
    <div
      ref={setNodeRef}
      data-search-item
      data-search-text={lead.addressText ?? undefined}
      data-testid="pipeline-card"
      className={cn(
        // shrink-0 is load-bearing: the card is a flex item in the column's
        // overflow-y-auto drop zone, and `overflow-hidden` here resolves its auto
        // min-height to 0. Without it, a full column squashes every card instead of
        // scrolling — clipping the footer/age row inside each one.
        "group relative shrink-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-all",
        "hover:-translate-y-0.5 hover:border-border hover:shadow-md",
        isDragging && "opacity-40",
        overlay && "rotate-2 shadow-xl ring-1 ring-gold/30"
      )}
    >
      {/* Stage-colored accent spine */}
      <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: accent }} aria-hidden />

      {/* The whole card opens the lead/deal detail. */}
      <Link href={`/portal/leads/${lead.id}`} className="block py-3 pl-4 pr-3">
        <div className="flex items-start gap-2.5">
          <span
            className="grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold"
            style={{ backgroundColor: `${accent}22`, color: accent }}
            aria-hidden
          >
            {initials(lead.name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold leading-tight">{lead.name}</p>
            <div className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
              {lead.city && (
                <span className="flex items-center gap-1">
                  <MapPin className="size-3 shrink-0" /> <span className="truncate">{lead.city}</span>
                </span>
              )}
              {lead.phone && (
                <span className="flex items-center gap-1">
                  <Phone className="size-3 shrink-0" /> {lead.phone}
                </span>
              )}
            </div>
          </div>
          {/* spacer so text doesn't run under the drag handle */}
          {canMove && <span className="size-5 shrink-0" aria-hidden />}
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="rounded-md bg-muted px-2 py-0.5 text-sm font-semibold tabular-nums">
            {fmt.money(lead.value, { compact: true })}
          </span>
          {lead.rep && <span className="truncate text-[11px] text-muted-foreground">{lead.rep}</span>}
        </div>

        {/* Recorded outcomes — appointment outcome (gold) and inspection outcome (blue). */}
        {(lead.appointmentOutcome || lead.inspectionOutcome) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {lead.appointmentOutcome && (
              <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-medium text-gold-muted">
                <PlayCircle className="size-3 shrink-0" /> <span className="truncate">{lead.appointmentOutcome}</span>
              </span>
            )}
            {lead.inspectionOutcome && (
              <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-600">
                <ClipboardCheck className="size-3 shrink-0" /> <span className="truncate">{lead.inspectionOutcome}</span>
              </span>
            )}
          </div>
        )}

        {/* Age indicators: total time since the appointment, and time in this stage. */}
        <div className="mt-3 flex items-center gap-2 border-t border-border/60 pt-2.5 text-[11px] text-muted-foreground">
          <span
            className="inline-flex items-center gap-1 rounded-full bg-muted/70 px-2 py-0.5"
            title={`${lead.ageDays} day${lead.ageDays === 1 ? "" : "s"} since appointment`}
          >
            <CalendarClock className="size-3" /> {fmtDays(lead.ageDays)}
          </span>
          {(() => {
            const overdue = targetDays > 0 && lead.stageDays > targetDays;
            const dueSoon = targetDays > 0 && !overdue && lead.stageDays >= targetDays - 1;
            const cls = overdue ? "bg-red-100 font-medium text-red-700"
              : dueSoon ? "bg-amber-100 font-medium text-amber-700"
              : targetDays > 0 ? "bg-emerald-100 font-medium text-emerald-700"
              : lead.stageDays >= 14 ? "bg-amber-100 font-medium text-amber-700" : "bg-muted/70";
            const dot = overdue ? "🔴 " : dueSoon ? "🟡 " : targetDays > 0 ? "🟢 " : "";
            const title = targetDays > 0
              ? `${lead.stageDays}/${targetDays} days in stage${overdue ? ` · overdue by ${lead.stageDays - targetDays}` : ""}`
              : `${lead.stageDays} day${lead.stageDays === 1 ? "" : "s"} in this status`;
            return (
              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5", cls)} title={title}>
                <Timer className="size-3" /> {dot}{fmtDays(lead.stageDays)}{targetDays > 0 ? `/${targetDays}d` : " here"}
              </span>
            );
          })()}
        </div>
      </Link>

      {canMove && (
        <button
          {...attributes}
          {...listeners}
          onClick={(e) => e.preventDefault()}
          className="absolute right-1.5 top-2.5 cursor-grab rounded p-0.5 text-muted-foreground/60 opacity-0 transition-opacity hover:bg-muted hover:text-foreground active:cursor-grabbing group-hover:opacity-100"
          aria-label="Drag to move stage"
        >
          <GripVertical className="size-4" />
        </button>
      )}
    </div>
  );
}
