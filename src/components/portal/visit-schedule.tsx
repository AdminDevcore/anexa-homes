"use client";

import * as React from "react";
import { CalendarCheck, CalendarClock, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProjectSchedule } from "./project-schedule";
import { VisitCrew, type Assignee, type TeamMember } from "./install-crew";

const DAY = 86_400_000;

const COPY = {
  install: { title: "Install", crew: "Install crew", Icon: CalendarClock },
  inspection: { title: "Inspection", crew: "Inspection crew", Icon: CalendarCheck },
} as const;

/**
 * How the inspection sits against the install, in words.
 *
 * The two dates used to be stacked purely so the second read as a consequence
 * of the first. Side by side they need to say it instead — and saying it is
 * better than implying it, because it also catches the inspection booked BEFORE
 * the install, which is a scheduling mistake nobody spots by reading two
 * date fields.
 */
function relation(dateIso: string | null, installIso: string | null) {
  if (!dateIso || !installIso) return null;
  const days = Math.round(
    (new Date(dateIso).setUTCHours(0, 0, 0, 0) - new Date(installIso).setUTCHours(0, 0, 0, 0)) / DAY
  );
  if (Number.isNaN(days)) return null;
  if (days === 0) return { text: "Same day as the install", warn: false };
  if (days < 0)
    return { text: `${Math.abs(days)} day${days === -1 ? "" : "s"} BEFORE the install`, warn: true };
  return { text: `${days} day${days === 1 ? "" : "s"} after the install`, warn: false };
}

/**
 * One scheduled visit: the date, and who is going out on it.
 *
 * A card per visit, two across, rather than two full-width sections stacked —
 * the install and the inspection are the same three fields twice, and read side
 * by side they take one glance and a third of the height. Everything a deal
 * page can answer about a job's schedule is above the fold again.
 */
export function VisitCard({
  kind,
  leadId,
  projectId,
  date,
  installDate = null,
  canManage,
  team,
  assignees,
  canAssign,
}: {
  kind: "install" | "inspection";
  leadId: string;
  /** Null until the deal has a job — picking a date is what opens one. */
  projectId: string | null;
  /** This visit's date, ISO, or null when unscheduled. */
  date: string | null;
  /** The install's date, so the inspection can say how far behind it it sits. */
  installDate?: string | null;
  canManage: boolean;
  team: TeamMember[];
  assignees: Assignee[];
  canAssign: boolean;
}) {
  const { title, crew, Icon } = COPY[kind];
  const rel = kind === "inspection" ? relation(date, installDate) : null;

  return (
    // A column with the crew pushed to the bottom: the inspection carries one
    // line the install does not (how far behind it it sits), and without this
    // that line shunts its crew list a row lower than the one beside it.
    <div className="flex h-full flex-col rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-solar/10 text-solar">
            <Icon className="size-4" />
          </span>
          {title}
        </h4>
        {!date && (
          // The one thing a schedule card can be wrong about is being empty,
          // and an empty native date input does not look empty — it looks like
          // a field that is simply there.
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            Not scheduled
          </span>
        )}
      </div>

      {/* Grows to take up whatever the other card's date block does not, so the
          two crew lists start on the same line. */}
      <div className="mt-3 flex-1">
        <ProjectSchedule
          bare
          field={kind}
          leadId={leadId}
          projectId={projectId}
          value={date}
          canManage={canManage}
        />
        {rel && (
          <p
            className={cn(
              "mt-1.5 flex items-center gap-1 text-xs",
              rel.warn ? "font-medium text-amber-600 dark:text-amber-400" : "text-muted-foreground"
            )}
          >
            {rel.warn && <TriangleAlert className="size-3.5" />}
            {rel.text}
          </p>
        )}
      </div>

      <div className="mt-3.5 border-t border-border pt-3">
        <VisitCrew
          label={crew}
          kind={kind}
          projectId={projectId}
          team={team}
          assignees={assignees}
          canEdit={canAssign}
        />
      </div>
    </div>
  );
}
