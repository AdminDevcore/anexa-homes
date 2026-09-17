"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import type { AgentDepartment } from "@prisma/client";
import { Button } from "@/components/ui/button";
import {
  FieldGrid,
  NumField,
  Panel,
  SaveBar,
  SelectField,
  TextAreaField,
  TextField,
  ToggleRow,
  useDraft,
} from "@/components/portal/settings-kit";
import { configError, DEPARTMENTS, DEPARTMENT_LABEL, PRODUCT_LABEL, type AgentFormValues, type Product } from "@/lib/agent-labels";
import { useIsClient } from "@/lib/use-is-client";
import { createAgentAction, updateAgentAction } from "@/server/modules/agents/actions";
import { SCHEDULE_PRESETS, upcomingRuns, validateSchedule } from "@/server/modules/agents/schedule";

const NONE = "none";
const CUSTOM = "custom";

const isPreset = (schedule: string) => SCHEDULE_PRESETS.some((p) => p.schedule === schedule);

/**
 * An agent's config, for an owner or admin. The server re-validates everything
 * (validate-agent.ts); what this form checks is only what it can show while
 * someone types — a schedule that will not parse, and when it would next run.
 */
export function AgentConfigForm({
  mode,
  initial,
  handlers,
  products,
}: {
  mode: { kind: "create" } | { kind: "edit"; agentId: string };
  initial: AgentFormValues;
  handlers: { value: string; label: string }[];
  products: Product[];
}) {
  const router = useRouter();
  const client = useIsClient();
  // `enabled` is the header switch's business, not this form's: edit mode never
  // renders it, and updateAgentAction overrides it from the database anyway.
  // Keeping it out of the seed means flipping that switch — which refreshes the
  // page — cannot change useDraft's signature and silently throw away an edit
  // somebody is halfway through.
  const { draft, set, dirty, reset } = useDraft(mode.kind === "edit" ? { ...initial, enabled: false } : initial);
  const [customMode, setCustomMode] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const trimmed = draft.schedule.trim();
  const custom = customMode || (trimmed !== "" && !isPreset(trimmed));
  const scheduleChoice = custom ? CUSTOM : trimmed === "" ? NONE : trimmed;
  const checked = trimmed ? validateSchedule(trimmed) : null;
  // Same shape as `checked`, and the server's own sentences: a typo in the box
  // below should not cost a round trip to discover.
  const badConfig = React.useMemo(() => configError(draft.config), [draft.config]);
  // The next runs are in the VIEWER's time zone, which the server cannot know,
  // so they wait for hydration rather than failing it.
  const upcoming = client && checked?.ok ? upcomingRuns(checked.schedule, 3) : [];

  // A removed handler, or a product this editor could not normally pick, still
  // shows as the current value rather than as a blank box.
  const handlerChoices = handlers.some((h) => h.value === draft.handlerKey)
    ? handlers
    : [{ value: draft.handlerKey, label: `${draft.handlerKey} — not deployed` }, ...handlers];
  const productChoices = (products.includes(draft.product) ? products : [draft.product, ...products]).map((p) => ({
    value: p,
    label: PRODUCT_LABEL[p],
  }));

  async function save() {
    setBusy(true);
    try {
      if (mode.kind === "create") {
        const res = await createAgentAction(draft);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(`${draft.name.trim()} created`);
        router.push(`/portal/agents/${res.id}`);
      } else {
        const res = await updateAgentAction(mode.agentId, draft);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Saved");
        router.refresh();
      }
    } catch {
      toast.error("Could not save the agent. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Panel title="Agent">
        <div className="space-y-3">
          <TextField label="Name" value={draft.name} onChange={(v) => set("name", v)} placeholder="NTP Poller" />
          <TextAreaField
            label="Description"
            value={draft.description}
            onChange={(v) => set("description", v)}
            rows={2}
            placeholder="What it checks, and what it does about it."
          />
          <SelectField
            label="Handler"
            value={draft.handlerKey}
            onChange={(v) => set("handlerKey", v)}
            options={handlerChoices}
            hint="The code this agent runs. Only handlers in this deployment are listed."
          />
          <FieldGrid>
            <SelectField<Product>
              label="Product"
              value={draft.product}
              onChange={(v) => set("product", v)}
              options={productChoices}
              hint="Both runs once in each workspace."
            />
            <SelectField<AgentDepartment>
              label="Department"
              value={draft.department}
              onChange={(v) => set("department", v)}
              options={DEPARTMENTS.map((d) => ({ value: d, label: DEPARTMENT_LABEL[d] }))}
            />
          </FieldGrid>
          {mode.kind === "create" && (
            <ToggleRow
              label="Turn it on now"
              description="Off, it never runs on its schedule. Run now still works, after a confirmation."
              checked={draft.enabled}
              onChange={(v) => set("enabled", v)}
            />
          )}
        </div>
      </Panel>

      <Panel title="When it runs">
        <div className="space-y-3">
          <SelectField
            label="Schedule"
            value={scheduleChoice}
            onChange={(v) => {
              if (v === CUSTOM) {
                setCustomMode(true);
                return;
              }
              setCustomMode(false);
              set("schedule", v === NONE ? "" : v);
            }}
            options={[
              { value: NONE, label: "Only when someone presses Run now" },
              ...SCHEDULE_PRESETS.map((p) => ({ value: p.schedule as string, label: p.label })),
              { value: CUSTOM, label: "Custom cron" },
            ]}
          />
          {custom && (
            <TextField
              label="Cron expression"
              value={draft.schedule}
              onChange={(v) => set("schedule", v)}
              placeholder="*/10 * * * *"
              hint="Five fields — minute hour day month weekday — in UTC."
            />
          )}
          {checked && !checked.ok && <p className="text-xs text-destructive">{checked.error}</p>}
          {upcoming.length > 0 && (
            <div data-testid="agent-upcoming-runs" className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
              <div className="font-medium">Next runs, in your time</div>
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                {upcoming.map((d) => (
                  <li key={d.toISOString()}>
                    {d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <NumField
            label="Timeout (seconds)"
            value={draft.timeoutSeconds}
            onChange={(v) => set("timeoutSeconds", v)}
            step="1"
            hint="5 to 240. A run still going at its timeout is stopped and recorded as failed."
          />
        </div>
      </Panel>

      <Panel title="Human gate">
        <ToggleRow
          label="Hold stage moves for a person"
          description={
            draft.requiresHumanGate
              ? "On: by itself, this agent can only move a deal into an Action Required stage. Any other move waits in Runs → Needs a human."
              : "Off: this agent can advance deals by itself."
          }
          checked={draft.requiresHumanGate}
          onChange={(v) => set("requiresHumanGate", v)}
        />
      </Panel>

      <Panel title="Config">
        <div className="space-y-1.5">
          <TextAreaField
            label="Config (JSON)"
            value={draft.config}
            onChange={(v) => set("config", v)}
            rows={6}
            hint="Settings for the handler, checked when you save. Never a password or key — name where it lives instead, like env:AGENT_BANK_TOKEN."
          />
          {badConfig && <p className="text-xs text-destructive">{badConfig}</p>}
        </div>
      </Panel>

      {mode.kind === "create" ? (
        <div className="flex justify-end">
          <Button onClick={save} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Create agent
          </Button>
        </div>
      ) : (
        <SaveBar
          dirty={dirty}
          busy={busy}
          onSave={save}
          onDiscard={() => {
            reset();
            setCustomMode(false);
          }}
          what="this agent"
        />
      )}
    </div>
  );
}
