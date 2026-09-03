"use client";

import * as React from "react";
import { toast } from "sonner";
import { KeyRound, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  setSolarLenderApiKeyAction,
  clearSolarLenderApiKeyAction,
} from "@/server/modules/solar/amos-actions";

/**
 * The lender's API key.
 *
 * Its own control, outside the lender form, because a secret must only travel
 * INBOUND. The form round-trips every field it edits, so a key living in it
 * would have to be sent to this browser on every settings load in order to be
 * sent back on save. This one receives `masked` — the last four characters —
 * and nothing else, and posts a new key directly.
 *
 * There is no "reveal": the plaintext is not stored in a form we can reverse,
 * and an admin who has lost the key asks the lender for a new one, which is
 * also what revoking a leaked key looks like.
 */
export function LenderApiKeyField({
  lenderId,
  masked,
}: {
  lenderId: string;
  masked: string | null;
}) {
  const [entering, setEntering] = React.useState(false);
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [current, setCurrent] = React.useState(masked);

  async function save() {
    setBusy(true);
    const res = await setSolarLenderApiKeyAction(lenderId, value);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setCurrent(res.masked);
    setValue("");
    setEntering(false);
    toast.success("API key saved.");
  }

  async function clear() {
    setBusy(true);
    const res = await clearSolarLenderApiKeyAction(lenderId);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error ?? "Could not remove the key.");
      return;
    }
    setCurrent(null);
    toast.success("API key removed. This lender falls back to its application link.");
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">API key</p>

      {current && !entering ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1 font-mono text-xs">
            <KeyRound className="size-3" /> ····{current}
          </span>
          <Button size="xs" variant="outline" onClick={() => setEntering(true)} disabled={busy}>
            Replace
          </Button>
          <Button size="xs" variant="ghost" onClick={clear} disabled={busy}>
            <Trash2 className="size-3" /> Remove
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="max-w-sm font-mono"
            placeholder={current ? "Paste the replacement key" : "Paste the key the lender issued"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button size="sm" onClick={save} disabled={busy || value.trim().length === 0}>
            {busy ? "Saving…" : "Save key"}
          </Button>
          {current && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEntering(false);
                setValue("");
              }}
              disabled={busy}
            >
              Cancel
            </Button>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Stored encrypted. It is never shown again — if it is lost, ask the lender to issue a new
        one, which is also how you revoke one that has leaked.
      </p>
    </div>
  );
}
