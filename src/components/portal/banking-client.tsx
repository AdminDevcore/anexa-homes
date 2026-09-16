"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2, RefreshCw, Upload, Landmark, AlertTriangle, ArrowLeftRight, Ban, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useFormat } from "@/components/portal/branding-provider";
import type { FeedOverview, QueueRow } from "@/server/modules/bank-feeds/queries";
import {
  acceptFeedTransactionAction,
  excludeFeedTransactionAction,
  markAsTransferAction,
  syncNowAction,
  importStatementAction,
  createLinkTokenAction,
  exchangePublicTokenAction,
  createReconnectTokenAction,
} from "@/server/modules/bank-feeds/actions";

/**
 * THE REVIEW QUEUE.
 *
 * One row, one decision. The provider's category guess and a matching rule are
 * both shown as hints beside the row and neither is applied by pressing
 * anything other than the button that says so — a screen that pre-fills and
 * auto-submits is how a wrong rule quietly books two hundred transactions.
 */

export function BankingClient({
  data,
  canEdit,
  provider,
  webhookConfigured,
}: {
  data: FeedOverview;
  canEdit: boolean;
  provider: "plaid" | "fixture";
  webhookConfigured: boolean;
}) {
  const router = useRouter();
  const fmt = useFormat();
  const refresh = () => router.refresh();
  const [importing, setImporting] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const hasConnections = data.connections.length > 0;

  return (
    <div className="space-y-5">
      <ConnectionStrip
        data={data}
        canEdit={canEdit}
        provider={provider}
        webhookConfigured={webhookConfigured}
        onChanged={refresh}
        onImport={() => setImporting(true)}
      />

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="font-semibold">
          {data.counts.review} to review
        </span>
        <span className="text-muted-foreground">{data.counts.posted} posted</span>
        <span className="text-muted-foreground">{data.counts.matched} matched</span>
        <span className="text-muted-foreground">{data.counts.excluded} excluded</span>
      </div>

      {data.transferSuggestions.length > 0 && canEdit && (
        <TransferSuggestions data={data} onChanged={refresh} />
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Description</th>
              <th className="px-4 py-2 font-medium">Account</th>
              <th className="px-4 py-2 text-right font-medium">Amount</th>
              <th className="px-4 py-2 font-medium">Category</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {data.queue.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {hasConnections
                    ? "Nothing waiting. Every transaction has been dealt with."
                    : "No bank connected yet, and nothing imported."}
                </td>
              </tr>
            )}
            {data.queue.map((row) => (
              <QueueLine
                key={row.id}
                row={row}
                accounts={data.postableAccounts}
                canEdit={canEdit}
                busy={busyId === row.id}
                setBusy={setBusyId}
                onChanged={refresh}
                money={fmt.money}
              />
            ))}
          </tbody>
        </table>
      </div>

      {importing && (
        <ImportDialog
          accounts={data.accounts}
          onClose={() => setImporting(false)}
          onDone={() => {
            setImporting(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function ConnectionStrip({
  data,
  canEdit,
  provider,
  webhookConfigured,
  onChanged,
  onImport,
}: {
  data: FeedOverview;
  canEdit: boolean;
  provider: "plaid" | "fixture";
  webhookConfigured: boolean;
  onChanged: () => void;
  onImport: () => void;
}) {
  const [busy, setBusy] = React.useState(false);

  async function connect() {
    setBusy(true);
    const token = await createLinkTokenAction();
    if (!token.ok) {
      setBusy(false);
      return toast.error(token.error);
    }

    /**
     * WITH PLAID, THE HANDOFF IS NOT OURS TO COMPLETE.
     *
     * Their Link widget takes the user's banking credentials in a context we
     * never see and hands back a public token. Loading that widget needs live
     * credentials, so the flow stops here and says so, rather than presenting a
     * button that appears to work and silently does nothing.
     */
    if (provider === "plaid") {
      setBusy(false);
      return toast.info(
        "Plaid is configured. Opening the Link widget needs the browser SDK and live credentials — see docs/plaid-security-answers.md."
      );
    }

    const res = await exchangePublicTokenAction({ publicToken: "public-fixture-token" });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(`Connected — ${res.accountsLinked} accounts linked`);
    onChanged();
  }

  async function sync(connectionId: string) {
    setBusy(true);
    const res = await syncNowAction({ connectionId });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(`${res.added} new, ${res.modified} updated`);
    onChanged();
  }

  async function reconnect(connectionId: string) {
    const res = await createReconnectTokenAction({ connectionId });
    if (!res.ok) return toast.error(res.error);
    toast.info("Reconnection token created. Finish in the bank's window.");
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          {provider === "fixture" ? (
            <span>
              Using the <strong>fixture</strong> bank — seeded data, nothing real. Set
              {" "}
              <code className="rounded bg-muted px-1">BANK_FEED_PROVIDER=plaid</code> to go live.
            </span>
          ) : webhookConfigured ? (
            <span>Connected to Plaid. Updates arrive by webhook and every four hours.</span>
          ) : (
            // Stated because it changes only latency, never correctness.
            <span>
              Connected to Plaid. No webhook URL configured, so updates arrive on the
              four-hourly sweep only.
            </span>
          )}
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onImport}>
              <Upload className="size-4" /> Import a statement
            </Button>
            <Button size="sm" onClick={connect} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Landmark className="size-4" />}
              Connect a bank
            </Button>
          </div>
        )}
      </div>

      {data.connections.map((c) => (
        <div
          key={c.id}
          className={cn(
            "flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-sm",
            c.needsAttention ? "border-destructive bg-destructive/10" : "border-border bg-card"
          )}
        >
          <div className="flex items-center gap-2">
            {c.needsAttention ? (
              <AlertTriangle className="size-4 text-destructive" />
            ) : (
              <Landmark className="size-4 text-gold" />
            )}
            <span className="font-medium">{c.institutionName ?? "Bank"}</span>
            <span className="text-muted-foreground">
              {c.accountCount} account{c.accountCount === 1 ? "" : "s"}
            </span>
            {c.lastSyncedAt && (
              <span className="text-xs text-muted-foreground">
                synced {c.lastSyncedAt.slice(0, 10)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {c.needsAttention && (
              <span className="text-xs text-destructive">
                The bank needs you to sign in again.
              </span>
            )}
            {canEdit && c.needsAttention && (
              <Button size="sm" variant="outline" onClick={() => reconnect(c.id)}>
                Reconnect
              </Button>
            )}
            {canEdit && (
              <Button size="sm" variant="ghost" onClick={() => sync(c.id)} disabled={busy}>
                <RefreshCw className="size-4" /> Sync
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function QueueLine({
  row,
  accounts,
  canEdit,
  busy,
  setBusy,
  onChanged,
  money,
}: {
  row: QueueRow;
  accounts: FeedOverview["postableAccounts"];
  canEdit: boolean;
  busy: boolean;
  setBusy: (id: string | null) => void;
  onChanged: () => void;
  money: (cents: number) => string;
}) {
  // Pre-selected from the rule when one claims the row — but never submitted on
  // its own. The person still presses Add.
  const [accountId, setAccountId] = React.useState(row.suggestion?.accountId ?? "");

  async function add() {
    if (!accountId) return toast.error("Pick a category first.");
    setBusy(row.id);
    const res = await acceptFeedTransactionAction({
      feedTransactionId: row.id,
      lines: [{ accountId, amount: Math.abs(row.amountCents) / 100 }],
    });
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    toast.success("Added to the books");
    onChanged();
  }

  async function exclude() {
    setBusy(row.id);
    const res = await excludeFeedTransactionAction({ feedTransactionId: row.id });
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    onChanged();
  }

  const moneyIn = row.amountCents > 0;

  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-2 tabular-nums whitespace-nowrap">{row.postedAt.slice(0, 10)}</td>
      <td className="px-4 py-2">
        <div>{row.merchantName ?? row.description}</div>
        {row.merchantName && (
          <div className="text-xs text-muted-foreground">{row.description}</div>
        )}
        {row.pending && (
          <span className="mt-1 inline-block rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
            pending — cannot be posted until it settles
          </span>
        )}
      </td>
      <td className="px-4 py-2 text-xs text-muted-foreground">{row.bankAccountName ?? "—"}</td>
      <td
        className={cn(
          "px-4 py-2 text-right tabular-nums whitespace-nowrap",
          moneyIn && "text-emerald-600 dark:text-emerald-400"
        )}
      >
        {moneyIn ? "+" : "−"}
        {money(Math.abs(row.amountCents))}
      </td>
      <td className="px-4 py-2">
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          disabled={!canEdit || row.pending}
          className="h-8 w-48 rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="">Choose…</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.number} · {a.name}
            </option>
          ))}
        </select>
        {row.suggestion && (
          <div className="mt-1 text-[11px] text-muted-foreground">
            Rule “{row.suggestion.ruleName}” suggests {row.suggestion.accountName}
          </div>
        )}
      </td>
      <td className="px-4 py-2 text-right whitespace-nowrap">
        {canEdit && (
          <div className="flex justify-end gap-1">
            <Button size="sm" onClick={add} disabled={busy || row.pending}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              Add
            </Button>
            <Button size="sm" variant="ghost" onClick={exclude} disabled={busy}>
              <Ban className="size-3.5" /> Exclude
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}

function TransferSuggestions({ data, onChanged }: { data: FeedOverview; onChanged: () => void }) {
  const fmt = useFormat();
  const [busy, setBusy] = React.useState<string | null>(null);

  async function confirm(outId: string, inId: string) {
    setBusy(outId);
    const res = await markAsTransferAction({ outFeedTransactionId: outId, inFeedTransactionId: inId });
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    toast.success("Booked as a transfer");
    onChanged();
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <ArrowLeftRight className="size-4 text-gold" />
        Possible transfers between your own accounts
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Same amount, opposite directions, a few days apart. That also describes a real payment to
        a supplier who banks where you do, so nothing is booked until you say so.
      </p>
      <div className="mt-3 space-y-2">
        {data.transferSuggestions.map((s) => (
          <div key={s.outId} className="flex items-center justify-between gap-3 text-sm">
            <span>
              {fmt.money(s.amountCents)} — {s.daysApart} day{s.daysApart === 1 ? "" : "s"} apart
            </span>
            <Button size="sm" variant="outline" onClick={() => confirm(s.outId, s.inId)} disabled={busy === s.outId}>
              {busy === s.outId && <Loader2 className="size-3.5 animate-spin" />}
              Mark as transfer
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ImportDialog({
  accounts,
  onClose,
  onDone,
}: {
  accounts: FeedOverview["accounts"];
  onClose: () => void;
  onDone: () => void;
}) {
  const [bankAccountId, setBankAccountId] = React.useState(accounts[0]?.id ?? "");
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function run() {
    if (!file || !bankAccountId) return;
    setBusy(true);
    const content = await file.text();
    const res = await importStatementAction({ bankAccountId, filename: file.name, content });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);

    // Duplicates are the ORDINARY result of an overlapping statement, so they
    // are reported as information rather than as a failure.
    toast.success(
      `${res.imported} imported, ${res.duplicates} already present` +
        (res.errors.length ? `, ${res.errors.length} rows could not be read` : "")
    );
    if (res.errors.length) console.warn("[import]", res.errors);
    onDone();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Import a statement</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Account</Label>
            <select
              value={bankAccountId}
              onChange={(e) => setBankAccountId(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.mask ? ` ••••${a.mask}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">File</Label>
            <Input
              type="file"
              accept=".csv,.ofx,.qfx,.txt"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            CSV, OFX or QFX. OFX and QFX carry the bank&apos;s own transaction ids, so re-importing
            an overlapping file is exact. A CSV has no ids, so rows are matched on date, amount and
            description — the same statement imported twice is safe, but the same transactions in a
            differently-ordered file will need excluding by hand.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={run} disabled={busy || !file || !bankAccountId}>
            {busy && <Loader2 className="size-4 animate-spin" />} Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
