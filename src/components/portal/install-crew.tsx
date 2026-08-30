"use client";

import * as React from "react";
import type { AssignmentKind } from "@prisma/client";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Plus, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  assignInstallerAction,
  setInstallerRoleAction,
  unassignInstallerAction,
} from "@/server/modules/projects/actions";

export type TeamMember = { id: string; name: string; role: string; noAccess?: boolean };
export type Assignee = {
  id: string;
  userId: string;
  name: string;
  role: string | null;
  /** True when this person is not granted this deal's workspace. */
  noAccess?: boolean;
};

/**
 * Copy per visit. A job has two, they send different people, and "add whoever
 * is going out" under the inspection date would be describing the wrong day.
 */
const COPY: Record<AssignmentKind, { noun: string; empty: string; added: string; full: string }> = {
  install: {
    noun: "install",
    empty: "Nobody on the install yet",
    added: "Added to the install",
    full: "Everyone on the team is already on this install.",
  },
  inspection: {
    noun: "inspection",
    empty: "Nobody on the inspection yet",
    added: "Added to the inspection",
    full: "Everyone on the team is already on this inspection.",
  },
};

/** Initials for the avatar chip — two letters, never more. */
function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/**
 * Who is going out on ONE of the job's scheduled visits.
 *
 * Rendered once per visit — under the install date, and again under the
 * inspection date — because those are different days and usually different
 * people. A single list per job could not say which, so nothing on the calendar
 * could tell the install crew from the inspection crew, and neither could be
 * put in front of the right person.
 *
 * Several people, each with a role, rather than one crew. `Crew`/`CrewMember`
 * model a standing team and nothing in the app ever created one, so the crew
 * picker hid itself on every job and installs were staffed nowhere at all — the
 * section said "No crew assigned" and offered no way to change that.
 *
 * The role is free text next to each name rather than a fixed list. A company
 * that calls someone a "lead setter" and one that calls them "crew chief" are
 * both right, and payroll does not read this field.
 */
export function InstallCrew({
  projectId,
  kind = "install",
  team,
  assignees,
  canEdit,
}: {
  projectId: string;
  /** Which visit this list staffs. */
  kind?: AssignmentKind;
  team: TeamMember[];
  assignees: Assignee[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [userId, setUserId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const copy = COPY[kind];

  // Anyone already on the job drops out of the picker: the action refuses a
  // duplicate anyway, and offering a name that can only fail is a worse way to
  // find that out.
  const assigned = new Set(assignees.map((a) => a.userId));
  const available = team.filter((m) => !assigned.has(m.id));

  async function add() {
    if (!userId) return;
    setBusy(true);
    // try/finally, not a bare await: a server action that throws would
    // otherwise leave `busy` latched on and the picker permanently disabled,
    // with nothing on screen explaining why.
    try {
      // No role at add time: it is typed on the row once they are on the list,
      // which is the only place anything ever read it from.
      const res = await assignInstallerAction(projectId, userId, "", kind);
      if (!res.ok) return toast.error(res.error);
      toast.success(copy.added);
      setUserId("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const res = await unassignInstallerAction(id);
    if (!res.ok) return toast.error(res.error);
    router.refresh();
  }

  async function saveRole(id: string, value: string) {
    const res = await setInstallerRoleAction(id, value);
    if (!res.ok) return toast.error(res.error);
    router.refresh();
  }

  return (
    <div className="space-y-3" data-testid={`install-crew-${kind}`}>
      {assignees.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {copy.empty}{canEdit ? " — add whoever is going out." : "."}
        </p>
      ) : (
        <ul className="-mx-1.5 divide-y divide-border/60">
          {assignees.map((a) => (
            <li key={a.id} className="flex items-center gap-2.5 px-1.5 py-2 text-sm">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-solar/10 text-[11px] font-semibold text-solar">
                {initials(a.name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium leading-tight">{a.name}</p>
                {/* Assigned, but this workspace is not one they can open — so
                    the visit will never appear on their calendar. Said here
                    rather than discovered on the day: silently staffing someone
                    who cannot see the job is the failure this whole feature
                    exists to end. On its own line, because squeezed onto the
                    name's it pushed the role field off the row. */}
                {a.noAccess && (
                  <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium leading-tight text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="size-3" /> No workspace access — won&rsquo;t see it
                  </span>
                )}
              </div>
              {canEdit ? (
                // Saved on blur, not on every keystroke: a role is typed once
                // and a request per character would be a request per character.
                //
                // Styled as text until you touch it. Every crew row carried a
                // full bordered input whether or not anybody had ever typed a
                // role in it, which is one empty box per person on a card that
                // is mostly people.
                <Input
                  defaultValue={a.role ?? ""}
                  placeholder="Role"
                  maxLength={60}
                  aria-label={`Role for ${a.name} on the ${copy.noun}`}
                  className="h-7 w-24 shrink-0 border-transparent bg-transparent px-1.5 text-xs shadow-none placeholder:text-muted-foreground/60 hover:border-border focus-visible:border-border focus-visible:bg-background"
                  onBlur={(e) => {
                    if (e.target.value.trim() !== (a.role ?? "").trim()) {
                      void saveRole(a.id, e.target.value);
                    }
                  }}
                />
              ) : (
                a.role && <span className="shrink-0 text-xs text-muted-foreground">{a.role}</span>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => remove(a.id)}
                  aria-label={`Remove ${a.name} from the ${copy.noun}`}
                  className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <X className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit &&
        (available.length > 0 ? (
          <div className="flex items-center gap-2">
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger
                className="h-9 min-w-0 flex-1"
                aria-label={`Add someone to the ${copy.noun}`}
              >
                <SelectValue placeholder="Add someone" />
              </SelectTrigger>
              <SelectContent>
                {available.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                    <span className="ml-1.5 text-xs text-muted-foreground">{m.role}</span>
                    {m.noAccess && (
                      <span className="ml-1.5 text-xs text-amber-600 dark:text-amber-400">
                        · no access to this workspace
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" className="h-9 shrink-0" disabled={busy || !userId} onClick={add}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Add
            </Button>
          </div>
        ) : (
          // An empty picker is indistinguishable from a broken one, so say which
          // of the two this is.
          <p className="text-xs text-muted-foreground">
            {team.length === 0 ? "No active team members to assign yet." : copy.full}
          </p>
        ))}
    </div>
  );
}

/**
 * One visit's crew, under the date it belongs to.
 *
 * Exists so the deal page can render the same control twice without repeating
 * the "there is no job yet" branch. The dates are settable before the job
 * exists — picking one is what creates it — but an assignment needs something
 * to hang on, so before that the box says which order the two steps go in
 * rather than showing a picker that cannot save.
 *
 * A ruled-off block inside its visit's card, not a dashed box of its own: the
 * crew used to sit in a bordered box, inside a bordered date box, inside a
 * bordered card, and each person then got a fourth border of their own. Four
 * frames around one name is what made this tab look like a form.
 */
export function VisitCrew({
  label,
  kind,
  projectId,
  team,
  assignees,
  canEdit,
}: {
  label: string;
  kind: AssignmentKind;
  /** Null until the deal has a job. */
  projectId: string | null;
  team: TeamMember[];
  assignees: Assignee[];
  canEdit: boolean;
}) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Users className="size-3.5" /> {label}
        {assignees.length > 0 && (
          <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums normal-case tracking-normal">
            {assignees.length}
          </span>
        )}
      </p>
      {projectId ? (
        <InstallCrew
          projectId={projectId}
          kind={kind}
          team={team}
          assignees={assignees}
          canEdit={canEdit}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Pick the date first — that opens the job, and the crew goes on the job.
        </p>
      )}
    </div>
  );
}
