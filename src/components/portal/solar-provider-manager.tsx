"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Undo2, Archive, Check, Pencil, X, Zap } from "lucide-react";
import type { SolarProviderKind } from "@prisma/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  saveSolarProviderAction,
  saveSolarProviderTermsAction,
  setSolarProviderActiveAction,
} from "@/server/modules/solar/actions";
import {
  hasProviderTerms,
  providerTermsLine,
  type ProviderTerms,
} from "@/lib/solar-provider-terms";

export type ProviderRow = {
  id: string;
  name: string;
  active: boolean;
  position: number;
} & ProviderTerms;

/**
 * The two provider lists a solar company sells against.
 *
 * Separate lists because they are separate things: in a deregulated market the
 * utility delivers the power and a retailer bills for it, and a proposal that
 * confuses the two names the wrong company on the customer's own document.
 */
export function SolarProviderManager({
  utilities,
  retailers,
  canEdit,
}: {
  utilities: ProviderRow[];
  retailers: ProviderRow[];
  canEdit: boolean;
}) {
  return (
    <div className="space-y-6">
      <ProviderList
        kind="utility"
        title="Utilities"
        blurb="Who physically delivers the power and owns the meter — Oncor, CenterPoint, AEP Texas, TNMP."
        rows={utilities}
        canEdit={canEdit}
      />
      <ProviderList
        kind="retail"
        title="Retail electric providers"
        blurb="Who bills the customer, where that is a different company from the utility."
        rows={retailers}
        canEdit={canEdit}
      />
    </div>
  );
}

/** Module scope on purpose — react-hooks/static-components is an error here. */
function ProviderList({
  kind,
  title,
  blurb,
  rows,
  canEdit,
}: {
  kind: SolarProviderKind;
  title: string;
  blurb: string;
  rows: ProviderRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [adding, setAdding] = React.useState("");

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) return toast.error(res.error ?? "Something went wrong.");
    toast.success(okMsg);
    router.refresh();
  }

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-5">
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{blurb}</p>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing here yet. A rep can still type a provider by hand on the Energy step — this list
          just saves them doing it, and keeps the spelling consistent.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <ProviderItem
              key={r.id}
              row={r}
              busy={busy}
              canEdit={canEdit}
              onToggle={() =>
                run(
                  () => setSolarProviderActiveAction(r.id, !r.active),
                  r.active ? "Retired" : "Back in use"
                )
              }
              onSaveTerms={(terms) =>
                run(() => saveSolarProviderTermsAction(r.id, terms), `${r.name} updated`)
              }
            />
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1 space-y-1">
            <Label htmlFor={`add-${kind}`} className="text-xs">
              Add a {kind === "utility" ? "utility" : "retail provider"}
            </Label>
            <Input
              id={`add-${kind}`}
              value={adding}
              placeholder={kind === "utility" ? "e.g. Oncor" : "e.g. Rhythm Energy"}
              onChange={(e) => setAdding(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            disabled={busy || !adding.trim()}
            onClick={async () => {
              const name = adding.trim();
              await run(
                () => saveSolarProviderAction({ kind, name, position: rows.length }),
                `${name} added`
              );
              setAdding("");
            }}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add
          </Button>
        </div>
      )}
    </section>
  );
}

/**
 * One provider, and what the office knows about it.
 *
 * The terms open on demand rather than sitting open on every row: this list
 * runs to two hundred Texas municipals, and seven fields against each of them
 * is a settings page nobody can find anything on. Closed, a provider is a name
 * and one line of summary — which is the form a rep needs it in anyway.
 */
function ProviderItem({
  row,
  busy,
  canEdit,
  onToggle,
  onSaveTerms,
}: {
  row: ProviderRow;
  busy: boolean;
  canEdit: boolean;
  onToggle: () => void;
  onSaveTerms: (terms: ProviderTerms) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(() => seedTerms(row));

  function open() {
    setDraft(seedTerms(row));
    setEditing(true);
  }

  const summary = providerTermsLine(row);

  return (
    <li className="py-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <span className={cn("text-sm", !row.active && "text-muted-foreground line-through")}>
            {row.name}
          </span>
          {/* NOTHING RECORDED IS ITS OWN ANSWER. On a list whose job is to say
              who buys back, a blank line reads as "they do not" when it means
              "nobody has checked", and a rep quotes the first one. */}
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {summary ||
              (hasProviderTerms(row) ? "No buyback or programme" : "Buyback and VPP not recorded")}
          </p>
          {row.notes && (
            <p className="mt-0.5 whitespace-pre-wrap text-[11px] text-muted-foreground">
              {row.notes}
            </p>
          )}
        </div>
        {!row.active && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            retired
          </span>
        )}
        {canEdit && !editing && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={open}>
            <Zap className="size-4" /> Terms
          </Button>
        )}
        {canEdit && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onToggle}>
            {row.active ? <Archive className="size-4" /> : <Undo2 className="size-4" />}
            {row.active ? "Retire" : "Restore"}
          </Button>
        )}
      </div>

      {editing && (
        <div className="mt-2 space-y-3 rounded-lg border border-border bg-muted/30 p-3">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={draft.buyback}
                onChange={(e) => setDraft((d) => ({ ...d, buyback: e.target.checked }))}
              />
              Buys back exported power
            </label>
            {draft.buyback && (
              <div className="ml-6 max-w-56 space-y-1">
                <Label htmlFor={`buyback-${row.id}`} className="text-xs">
                  Export rate ($/kWh)
                </Label>
                <Input
                  id={`buyback-${row.id}`}
                  type="number"
                  step="0.001"
                  value={draft.buybackRate}
                  placeholder="blank — rate varies"
                  onChange={(e) => setDraft((d) => ({ ...d, buybackRate: e.target.value }))}
                />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={draft.vpp}
                onChange={(e) => setDraft((d) => ({ ...d, vpp: e.target.checked }))}
              />
              Runs a battery / VPP programme
            </label>
            {draft.vpp && (
              <div className="ml-6 grid max-w-2xl gap-2 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor={`vpp-name-${row.id}`} className="text-xs">
                    Programme
                  </Label>
                  <Input
                    id={`vpp-name-${row.id}`}
                    value={draft.vppProgramme}
                    placeholder="e.g. Renew Home"
                    onChange={(e) => setDraft((d) => ({ ...d, vppProgramme: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`vpp-up-${row.id}`} className="text-xs">
                    Upfront ($)
                  </Label>
                  <Input
                    id={`vpp-up-${row.id}`}
                    type="number"
                    value={draft.vppUpfront}
                    onChange={(e) => setDraft((d) => ({ ...d, vppUpfront: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`vpp-yr-${row.id}`} className="text-xs">
                    Per year ($)
                  </Label>
                  <Input
                    id={`vpp-yr-${row.id}`}
                    type="number"
                    value={draft.vppAnnual}
                    onChange={(e) => setDraft((d) => ({ ...d, vppAnnual: e.target.value }))}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor={`notes-${row.id}`} className="text-xs">
              Notes
            </Label>
            <Textarea
              id={`notes-${row.id}`}
              rows={2}
              value={draft.notes}
              placeholder="Term length, which batteries qualify, enrolment window — anything the boxes above cannot hold."
              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                onSaveTerms(termsFromDraft(draft));
                setEditing(false);
              }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Save
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
              <X className="size-4" /> Cancel
            </Button>
            <span className="text-[11px] text-muted-foreground">
              <Pencil className="mr-1 inline size-3" />
              Rep-facing only — none of this reaches a customer&rsquo;s proposal.
            </span>
          </div>
        </div>
      )}
    </li>
  );
}

/** The row as text boxes. Money and rates are typed in dollars, stored in cents. */
type TermsDraft = {
  buyback: boolean;
  buybackRate: string;
  vpp: boolean;
  vppProgramme: string;
  vppUpfront: string;
  vppAnnual: string;
  notes: string;
};

function seedTerms(r: ProviderRow): TermsDraft {
  return {
    buyback: r.buyback,
    buybackRate: r.buybackRateMills == null ? "" : (r.buybackRateMills / 1000).toFixed(3),
    vpp: r.vpp,
    vppProgramme: r.vppProgramme ?? "",
    vppUpfront: r.vppUpfrontCents == null ? "" : String(Math.round(r.vppUpfrontCents / 100)),
    vppAnnual: r.vppAnnualCents == null ? "" : String(Math.round(r.vppAnnualCents / 100)),
    notes: r.notes ?? "",
  };
}

/** A blank box is "not recorded", which is not the same as zero. */
const num = (v: string, scale: number): number | null => {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * scale) : null;
};

function termsFromDraft(d: TermsDraft): ProviderTerms {
  return {
    buyback: d.buyback,
    buybackRateMills: num(d.buybackRate, 1000),
    vpp: d.vpp,
    vppProgramme: d.vppProgramme.trim() || null,
    vppUpfrontCents: num(d.vppUpfront, 100),
    vppAnnualCents: num(d.vppAnnual, 100),
    notes: d.notes.trim() || null,
  };
}
