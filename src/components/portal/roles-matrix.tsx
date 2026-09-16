"use client";

import * as React from "react";
import { ShieldCheck } from "lucide-react";
import {
  Hint,
  ItemRail,
  Panel,
  Pill,
  RailLayout,
  RailRow,
  StatRow,
} from "@/components/portal/settings-kit";

export type RoleGrants = {
  role: string;
  label: string;
  entries: { resource: string; actions: string[] }[];
};

/**
 * What each role can see and do, one role at a time.
 *
 * A grid of nine cards meant reading nine lists to answer "what can a canvasser
 * actually reach?" — and the card you wanted was wherever it happened to fall
 * in a two-column flow. The rail says how much access each role carries; the
 * panel is the one you asked about.
 *
 * Read-only on purpose: the matrix is code, so a grant cannot be widened by
 * accident from a settings screen at six in the evening.
 */
export function RolesMatrix({ roles }: { roles: RoleGrants[] }) {
  const [selected, setSelected] = React.useState<string>(() => roles[0]?.role ?? "");
  const open = roles.find((r) => r.role === selected) ?? roles[0] ?? null;

  return (
    <RailLayout
      rail={
        <ItemRail label="Roles">
          {roles.map((r) => (
            <RailRow
              key={r.role}
              title={r.label}
              subtitle={
                r.entries.length === 0
                  ? "no portal access"
                  : `${r.entries.length} ${r.entries.length === 1 ? "area" : "areas"}`
              }
              mark={
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-gold/10 text-gold">
                  <ShieldCheck className="size-3.5" />
                </span>
              }
              selected={r.role === open?.role}
              onSelect={() => setSelected(r.role)}
              muted={r.entries.length === 0}
            />
          ))}
        </ItemRail>
      }
    >
      {open && (
        <div className="min-w-0">
          <header className="flex flex-wrap items-start gap-3 border-b border-border pb-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gold/10 text-gold">
              <ShieldCheck className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-xl font-semibold tracking-tight">{open.label}</h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Pill tone={open.entries.length === 0 ? "warn" : "plain"}>
                  {open.entries.length === 0
                    ? "No portal access"
                    : `${open.entries.length} areas`}
                </Pill>
                <Pill>
                  {open.entries.filter((e) => e.actions.includes("full access")).length} with full
                  access
                </Pill>
              </div>
            </div>
          </header>

          <div className="mt-4 space-y-4">
            <Panel title="What this role can reach">
              {open.entries.length === 0 ? (
                <Hint>
                  Nothing. Somebody on this role can sign in and reach no part of the portal — it
                  exists so a person can be recorded without being let in.
                </Hint>
              ) : (
                <dl>
                  {open.entries.map((e) => (
                    <StatRow
                      key={e.resource}
                      label={e.resource}
                      value={<span className="capitalize">{e.actions.join(", ")}</span>}
                    />
                  ))}
                </dl>
              )}
            </Panel>

            <Panel title="What this page cannot tell you" tone="muted">
              <Hint>
                Row-level rules are enforced on top of every grant above — a rep who can read
                Appointments still only sees their own, and a manager sees their team&rsquo;s. This
                list is what a role can reach, not how much of it.
              </Hint>
              <Hint>
                The matrix lives in code rather than in the database, so a grant cannot be widened
                by accident from a settings screen. Changing one is a deploy.
              </Hint>
              <Hint>
                Agents access is not a role and does not appear above. It is a per-person switch on
                a team member&rsquo;s page, and it lets somebody run and resolve agents whose role
                here stops at reading them.
              </Hint>
            </Panel>
          </div>
        </div>
      )}
    </RailLayout>
  );
}
