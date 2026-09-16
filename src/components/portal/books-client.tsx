"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Loader2, Lock, Unlock, Landmark, BookOpen, Scale, ArrowLeftRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useFormat } from "@/components/portal/branding-provider";
import type { BooksOverview, ChartRow } from "@/server/modules/books/queries";
import {
  seedChartAction,
  postManualEntryAction,
  voidEntryAction,
  setPeriodLockAction,
  createBankAccountAction,
  postTransferAction,
  updateLedgerAccountAction,
} from "@/server/modules/books/actions";

type Tab = "chart" | "journal" | "banks" | "close";

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "chart", label: "Chart of accounts", icon: BookOpen },
  { key: "journal", label: "Journal", icon: Scale },
  { key: "banks", label: "Bank accounts", icon: Landmark },
  { key: "close", label: "Period close", icon: Lock },
];

/** Class → the heading a bookkeeper expects to see it under. */
const TYPE_LABEL: Record<string, string> = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  income: "Income",
  cogs: "Job costs",
  expense: "Operating expenses",
  other_income: "Other income",
  other_expense: "Other expenses",
};
const TYPE_ORDER = ["asset", "liability", "equity", "income", "cogs", "expense", "other_income", "other_expense"];

export function BooksClient({
  data,
  canEdit,
  isOwner,
}: {
  data: BooksOverview;
  canEdit: boolean;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = React.useState<Tab>("chart");
  const refresh = () => router.refresh();

  if (!data.seeded) {
    return <SeedPrompt canEdit={canEdit} onDone={refresh} />;
  }

  return (
    <div className="space-y-5">
      <TrialBalanceBanner tb={data.trialBalance} lockedThrough={data.periodLockedThrough} />

      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab === t.key
                ? "border-gold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <t.icon className="size-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "chart" && <ChartTab data={data} canEdit={canEdit} onChanged={refresh} />}
      {tab === "journal" && <JournalTab data={data} canEdit={canEdit} onChanged={refresh} />}
      {tab === "banks" && <BanksTab data={data} canEdit={canEdit} onChanged={refresh} />}
      {tab === "close" && <CloseTab data={data} isOwner={isOwner} onChanged={refresh} />}
    </div>
  );
}

/**
 * The trial balance, on every tab.
 *
 * It is the one figure that checks the LEDGER rather than describing it: the
 * posting service refuses an unbalanced entry, so debits and credits can only
 * disagree if something wrote journal_lines without going through it. A red
 * banner here means a bug, not a bookkeeping mistake, and it should be
 * impossible to miss.
 */
function TrialBalanceBanner({
  tb,
  lockedThrough,
}: {
  tb: BooksOverview["trialBalance"];
  lockedThrough: string | null;
}) {
  const fmt = useFormat();
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4",
        tb.balanced ? "border-border bg-card" : "border-destructive bg-destructive/10"
      )}
    >
      <div className="flex items-center gap-2 text-sm">
        <Scale className={cn("size-4", tb.balanced ? "text-gold" : "text-destructive")} />
        {tb.balanced ? (
          <span>
            Trial balance agrees — {fmt.money(tb.totalDebitsCents)} debits, {fmt.money(tb.totalCreditsCents)} credits.
          </span>
        ) : (
          <span className="font-semibold text-destructive">
            The ledger does not balance: {fmt.money(tb.totalDebitsCents)} debits against{" "}
            {fmt.money(tb.totalCreditsCents)} credits. Something wrote the journal without going through the posting
            service.
          </span>
        )}
      </div>
      {lockedThrough && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium">
          <Lock className="size-3.5" /> Closed through {lockedThrough.slice(0, 10)}
        </span>
      )}
    </div>
  );
}

function SeedPrompt({ canEdit, onDone }: { canEdit: boolean; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false);
  async function seed() {
    setBusy(true);
    const res = await seedChartAction();
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(`Created ${res.created} accounts`);
    onDone();
  }
  return (
    <div className="rounded-xl border border-border bg-card p-8 text-center">
      <BookOpen className="mx-auto size-8 text-gold" />
      <h3 className="mt-3 font-semibold">No chart of accounts yet</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        The books need a chart of accounts before anything can be posted. This creates the standard roofing and solar
        contractor set — four-digit, grouped by class. You can rename, renumber and add to it afterwards.
      </p>
      {canEdit && (
        <Button className="mt-4" onClick={seed} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />} Create the chart of accounts
        </Button>
      )}
    </div>
  );
}

function ChartTab({
  data,
  canEdit,
  onChanged,
}: {
  data: BooksOverview;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const fmt = useFormat();
  const [editing, setEditing] = React.useState<ChartRow | null>(null);
  const byType = new Map<string, ChartRow[]>();
  for (const a of data.accounts) {
    const list = byType.get(a.type) ?? [];
    list.push(a);
    byType.set(a.type, list);
  }

  return (
    <div className="space-y-4">
      {TYPE_ORDER.filter((t) => byType.has(t)).map((type) => (
        <div key={type} className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-2.5 text-sm font-semibold">{TYPE_LABEL[type] ?? type}</div>
          <table className="w-full text-sm">
            <tbody>
              {byType.get(type)!.map((a) => (
                <tr key={a.id} className={cn("border-b border-border last:border-0", !a.active && "opacity-50")}>
                  <td className="w-20 px-4 py-2 font-mono text-xs text-muted-foreground">{a.number}</td>
                  <td className="px-4 py-2">
                    {a.name}
                    {a.systemKey && (
                      <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        system
                      </span>
                    )}
                    {!a.active && <span className="ml-2 text-xs text-muted-foreground">(inactive)</span>}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{a.taxLine ?? ""}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmt.money(a.balanceCents)}</td>
                  <td className="w-20 px-4 py-2 text-right">
                    {canEdit && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>
                        Edit
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {editing && (
        <AccountDialog
          account={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function AccountDialog({
  account,
  onClose,
  onDone,
}: {
  account: ChartRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = React.useState(account.name);
  const [taxLine, setTaxLine] = React.useState(account.taxLine ?? "");
  const [active, setActive] = React.useState(account.active);
  const [busy, setBusy] = React.useState(false);

  async function save() {
    setBusy(true);
    const res = await updateLedgerAccountAction({ id: account.id, name, taxLine: taxLine || null, active });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Account saved");
    onDone();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {account.number} · {account.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Tax line</Label>
            <Input
              value={taxLine}
              onChange={(e) => setTaxLine(e.target.value)}
              placeholder="e.g. Schedule C: Advertising"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active
          </label>
          {account.systemKey && (
            <p className="text-[11px] leading-snug text-muted-foreground">
              This account is resolved by the software when it posts. It can be renamed, but it cannot be switched off.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JournalTab({
  data,
  canEdit,
  onChanged,
}: {
  data: BooksOverview;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const fmt = useFormat();
  const [open, setOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="size-4" /> New entry
          </Button>
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Memo</th>
              <th className="px-4 py-2 font-medium">Source</th>
              <th className="px-4 py-2 text-right font-medium">Amount</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {data.recentEntries.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Nothing posted yet.
                </td>
              </tr>
            )}
            {data.recentEntries.map((e) => (
              <React.Fragment key={e.id}>
                <tr className="border-b border-border last:border-0">
                  <td className="px-4 py-2 tabular-nums">{e.date.slice(0, 10)}</td>
                  <td className="px-4 py-2">
                    {e.memo ?? "—"}
                    {e.status === "void" && (
                      <span className="ml-2 rounded border border-destructive px-1.5 py-0.5 text-[10px] text-destructive">
                        void
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{e.sourceType}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmt.money(e.totalCents)}</td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                    >
                      {e.lineCount} lines
                    </Button>
                  </td>
                </tr>
                {expanded === e.id &&
                  e.lines.map((l, i) => (
                    <tr key={i} className="border-b border-border bg-muted/30 text-xs last:border-0">
                      <td className="px-4 py-1.5" />
                      <td className="px-4 py-1.5">
                        <span className="font-mono text-muted-foreground">{l.accountNumber}</span> {l.accountName}
                        {l.vertical && <span className="ml-2 text-muted-foreground">· {l.vertical}</span>}
                      </td>
                      <td className="px-4 py-1.5 text-right tabular-nums">
                        {l.debitCents ? fmt.money(l.debitCents) : ""}
                      </td>
                      <td className="px-4 py-1.5 text-right tabular-nums">
                        {l.creditCents ? fmt.money(l.creditCents) : ""}
                      </td>
                      <td className="px-4 py-1.5 text-right">
                        {canEdit && i === 0 && e.status !== "void" && (
                          <VoidButton entryId={e.id} onDone={onChanged} />
                        )}
                      </td>
                    </tr>
                  ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {open && (
        <EntryDialog
          accounts={data.accounts.filter((a) => a.active)}
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function VoidButton({ entryId, onDone }: { entryId: string; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false);
  async function run() {
    const reason = window.prompt("Why is this entry being voided?");
    if (!reason?.trim()) return;
    setBusy(true);
    const res = await voidEntryAction({ entryId, reason });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Entry reversed");
    onDone();
  }
  return (
    <Button size="sm" variant="ghost" onClick={run} disabled={busy}>
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : "Void"}
    </Button>
  );
}

type DraftLine = { accountId: string; debit: string; credit: string; vertical: string };

const EMPTY_LINE: DraftLine = { accountId: "", debit: "", credit: "", vertical: "" };

function EntryDialog({
  accounts,
  onClose,
  onDone,
}: {
  accounts: ChartRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [date, setDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = React.useState("");
  const [lines, setLines] = React.useState<DraftLine[]>([{ ...EMPTY_LINE }, { ...EMPTY_LINE }]);
  const [busy, setBusy] = React.useState(false);

  const num = (s: string) => (s.trim() ? Number(s) : 0);
  const debits = lines.reduce((s, l) => s + num(l.debit), 0);
  const credits = lines.reduce((s, l) => s + num(l.credit), 0);
  const difference = Math.round((debits - credits) * 100) / 100;

  function setLine(i: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  async function save() {
    setBusy(true);
    const res = await postManualEntryAction({
      date,
      memo: memo || undefined,
      lines: lines
        .filter((l) => l.accountId && (num(l.debit) > 0 || num(l.credit) > 0))
        .map((l) => ({
          accountId: l.accountId,
          debit: num(l.debit) || undefined,
          credit: num(l.credit) || undefined,
          vertical: (l.vertical || null) as "roofing" | "solar" | "others" | null,
        })),
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Entry posted");
    onDone();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>New journal entry</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Memo</Label>
              <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="What is this entry for?" />
            </div>
          </div>

          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">Account</th>
                <th className="py-1 font-medium">Department</th>
                <th className="w-28 py-1 text-right font-medium">Debit</th>
                <th className="w-28 py-1 text-right font-medium">Credit</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="py-1 pr-2">
                    <select
                      value={l.accountId}
                      onChange={(e) => setLine(i, { accountId: e.target.value })}
                      className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                    >
                      <option value="">Pick an account…</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.number} · {a.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    <select
                      value={l.vertical}
                      onChange={(e) => setLine(i, { vertical: e.target.value })}
                      className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                    >
                      <option value="">Company</option>
                      <option value="roofing">Roofing</option>
                      <option value="solar">Solar</option>
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      inputMode="decimal"
                      value={l.debit}
                      onChange={(e) => setLine(i, { debit: e.target.value, credit: "" })}
                      className="text-right"
                    />
                  </td>
                  <td className="py-1">
                    <Input
                      inputMode="decimal"
                      value={l.credit}
                      onChange={(e) => setLine(i, { credit: e.target.value, debit: "" })}
                      className="text-right"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex items-center justify-between">
            <Button size="sm" variant="outline" onClick={() => setLines((p) => [...p, { ...EMPTY_LINE }])}>
              <Plus className="size-4" /> Add line
            </Button>
            <div className={cn("text-sm tabular-nums", difference === 0 ? "text-muted-foreground" : "text-destructive")}>
              {difference === 0 ? "Balanced" : `Out of balance by ${difference.toFixed(2)}`}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {/* The server refuses an unbalanced entry regardless; this only stops
              the round trip when the form can already see the problem. */}
          <Button onClick={save} disabled={busy || difference !== 0}>
            {busy && <Loader2 className="size-4 animate-spin" />} Post entry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BanksTab({
  data,
  canEdit,
  onChanged,
}: {
  data: BooksOverview;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const fmt = useFormat();
  const [adding, setAdding] = React.useState(false);
  const [transferring, setTransferring] = React.useState(false);

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setTransferring(true)} disabled={data.bankAccounts.length < 2}>
            <ArrowLeftRight className="size-4" /> Transfer
          </Button>
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add account
          </Button>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {data.bankAccounts.map((b) => (
          <div key={b.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold">{b.name}</div>
                <div className="text-xs text-muted-foreground">
                  {[b.institution, b.mask ? `••••${b.mask}` : null, b.kind.replace("_", " ")]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <div className="text-right">
                <div className="tabular-nums font-semibold">{fmt.money(b.bookBalanceCents)}</div>
                <div className="text-[11px] text-muted-foreground">
                  {b.kind === "credit_card" ? "owed" : "book balance"}
                </div>
              </div>
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground">
              Account {b.accountNumber}
              {b.defaultVertical ? ` · defaults to ${b.defaultVertical}` : ""}
            </div>
          </div>
        ))}
        {data.bankAccounts.length === 0 && (
          <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground sm:col-span-2">
            No bank accounts yet. Add one to start reconciling.
          </div>
        )}
      </div>
      {adding && (
        <BankDialog
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            onChanged();
          }}
        />
      )}
      {transferring && (
        <TransferDialog
          accounts={data.bankAccounts}
          onClose={() => setTransferring(false)}
          onDone={() => {
            setTransferring(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function BankDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = React.useState("");
  const [institution, setInstitution] = React.useState("");
  const [mask, setMask] = React.useState("");
  const [kind, setKind] = React.useState<"checking" | "savings" | "credit_card">("checking");
  const [vertical, setVertical] = React.useState("");
  const [opening, setOpening] = React.useState("");
  const [openingDate, setOpeningDate] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function save() {
    setBusy(true);
    const res = await createBankAccountAction({
      name,
      institution: institution || undefined,
      mask: mask || undefined,
      kind,
      defaultVertical: (vertical || null) as "roofing" | "solar" | "others" | null,
      openingBalance: opening.trim() ? Number(opening) : undefined,
      openingBalanceDate: openingDate || undefined,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Account added");
    onDone();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a bank or card</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Truist Checking — Solar" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Institution</Label>
            <Input value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="Truist" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Last 4</Label>
            <Input value={mask} onChange={(e) => setMask(e.target.value)} maxLength={4} placeholder="4321" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Type</Label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="checking">Checking</option>
              <option value="savings">Savings</option>
              <option value="credit_card">Credit card</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Default department</Label>
            <select
              value={vertical}
              onChange={(e) => setVertical(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="">Company</option>
              <option value="roofing">Roofing</option>
              <option value="solar">Solar</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Opening balance</Label>
            <Input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0.00" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">As of</Label>
            <Input type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground sm:col-span-2">
            A credit card is a liability: its opening balance is what is OWED. The opening balance posts a real entry
            against Opening Balance Equity, so the account is right from its first day.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !name.trim()}>
            {busy && <Loader2 className="size-4 animate-spin" />} Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({
  accounts,
  onClose,
  onDone,
}: {
  accounts: BooksOverview["bankAccounts"];
  onClose: () => void;
  onDone: () => void;
}) {
  const [from, setFrom] = React.useState(accounts[0]?.id ?? "");
  const [to, setTo] = React.useState(accounts[1]?.id ?? "");
  const [amount, setAmount] = React.useState("");
  const [date, setDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = React.useState(false);

  async function save() {
    setBusy(true);
    const res = await postTransferAction({
      fromBankAccountId: from,
      toBankAccountId: to,
      amount: Number(amount),
      date,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Transfer posted");
    onDone();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer between accounts</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">From</Label>
            <select
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">To</Label>
            <select
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Amount</Label>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Moving money between your own accounts is never income and never an expense. Paying a credit card down is a
            transfer to the card.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || from === to || !amount.trim()}>
            {busy && <Loader2 className="size-4 animate-spin" />} Post transfer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CloseTab({
  data,
  isOwner,
  onChanged,
}: {
  data: BooksOverview;
  isOwner: boolean;
  onChanged: () => void;
}) {
  const [through, setThrough] = React.useState(data.periodLockedThrough?.slice(0, 10) ?? "");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function apply(clear: boolean) {
    setBusy(true);
    const res = await setPeriodLockAction({
      lockedThrough: clear ? null : through,
      note: note || undefined,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(clear ? "Books reopened" : "Books closed");
    onChanged();
  }

  return (
    <div className="max-w-xl space-y-4 rounded-xl border border-border bg-card p-5">
      <div>
        <h3 className="font-semibold">Period close</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything dated on or before the close date is locked. Only the owner can post into a closed period, and only
          with a reason, which is recorded against the entry and in the audit trail.
        </p>
      </div>

      {data.periodLockedThrough ? (
        <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
          <Lock className="size-4 text-gold" /> Closed through {data.periodLockedThrough.slice(0, 10)}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">
          <Unlock className="size-4" /> The books are fully open.
        </div>
      )}

      {isOwner ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Close through</Label>
              <Input type="date" value={through} onChange={(e) => setThrough(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Note</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Q1 filed" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => apply(false)} disabled={busy || !through}>
              {busy && <Loader2 className="size-4 animate-spin" />} Close the books
            </Button>
            {data.periodLockedThrough && (
              <Button variant="outline" onClick={() => apply(true)} disabled={busy}>
                Reopen
              </Button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Only the owner can close or reopen a period.</p>
      )}
    </div>
  );
}
