"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, X } from "lucide-react";
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

export type TeamMember = { id: string; name: string; role: string };
export type Assignee = { id: string; userId: string; name: string; role: string | null };

/** Initials for the avatar chip — two letters, never more. */
function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/**
 * Who is going out on this install.
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
  team,
  assignees,
  canEdit,
}: {
  projectId: string;
  team: TeamMember[];
  assignees: Assignee[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [userId, setUserId] = React.useState("");
  const [role, setRole] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  // Anyone already on the job drops out of the picker: the action refuses a
  // duplicate anyway, and offering a name that can only fail is a worse way to
  // find that out.
  const assigned = new Set(assignees.map((a) => a.userId));
  const available = team.filter((m) => !assigned.has(m.id));

  async function add() {
    if (!userId) return;
    setBusy(true);
    const res = await assignInstallerAction(projectId, userId, role);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Added to the install");
    setUserId("");
    setRole("");
    router.refresh();
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
    <div className="space-y-3" data-testid="install-crew">
      {assignees.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nobody assigned yet{canEdit ? " — add whoever is going out." : "."}
        </p>
      ) : (
        <ul className="space-y-2">
          {assignees.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-background p-2.5 text-sm"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">
                {initials(a.name)}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
              {canEdit ? (
                // Saved on blur, not on every keystroke: a role is typed once
                // and a request per character would be a request per character.
                <Input
                  defaultValue={a.role ?? ""}
                  placeholder="Role"
                  maxLength={60}
                  aria-label={`Role for ${a.name}`}
                  className="h-8 w-36"
                  onBlur={(e) => {
                    if (e.target.value.trim() !== (a.role ?? "").trim()) {
                      void saveRole(a.id, e.target.value);
                    }
                  }}
                />
              ) : (
                a.role && <span className="text-xs text-muted-foreground">{a.role}</span>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => remove(a.id)}
                  aria-label={`Remove ${a.name}`}
                  className="shrink-0"
                >
                  <X className="size-4 text-destructive" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit &&
        (available.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger className="min-w-48 flex-1">
                <SelectValue placeholder="Add someone" />
              </SelectTrigger>
              <SelectContent>
                {available.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                    <span className="ml-1.5 text-xs text-muted-foreground">{m.role}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={role}
              placeholder="Role (optional)"
              maxLength={60}
              aria-label="Role"
              className="w-40"
              onChange={(e) => setRole(e.target.value)}
            />
            <Button size="sm" disabled={busy || !userId} onClick={add}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Add
            </Button>
          </div>
        ) : (
          // An empty picker is indistinguishable from a broken one, so say which
          // of the two this is.
          <p className="text-xs text-muted-foreground">
            {team.length === 0
              ? "No active team members to assign yet."
              : "Everyone on the team is already on this install."}
          </p>
        ))}
    </div>
  );
}
