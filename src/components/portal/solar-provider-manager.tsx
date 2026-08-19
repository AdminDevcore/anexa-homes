"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Undo2, Archive } from "lucide-react";
import type { SolarProviderKind } from "@prisma/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  saveSolarProviderAction,
  setSolarProviderActiveAction,
} from "@/server/modules/solar/actions";

export type ProviderRow = { id: string; name: string; active: boolean; position: number };

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
            <li key={r.id} className="flex items-center gap-2 py-2">
              <span className={cn("flex-1 text-sm", !r.active && "text-muted-foreground line-through")}>
                {r.name}
              </span>
              {!r.active && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  retired
                </span>
              )}
              {canEdit && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => setSolarProviderActiveAction(r.id, !r.active),
                      r.active ? "Retired" : "Back in use"
                    )
                  }
                >
                  {r.active ? <Archive className="size-4" /> : <Undo2 className="size-4" />}
                  {r.active ? "Retire" : "Restore"}
                </Button>
              )}
            </li>
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
