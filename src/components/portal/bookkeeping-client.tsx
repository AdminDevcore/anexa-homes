"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Loader2, Trash2, Pencil, Plug, TrendingUp, TrendingDown, Scale, Download, BookOpen, Building2, CheckCircle2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { formatCents } from "@/lib/format";
import type { BookkeepingData, BkTxn } from "@/server/modules/bookkeeping/queries";
import {
  createTransactionAction,
  updateTransactionAction,
  approveTransactionAction,
  unapproveTransactionAction,
  autoSuggestUnreviewedAction,
  deleteTransactionAction,
  createCategoryAction,
  updateCategoryAction,
  deleteCategoryAction,
  createVendorAction,
  renameVendorAction,
  deleteVendorAction,
  setBookkeepingConnectionAction,
} from "@/server/modules/bookkeeping/actions";

const ACCOUNT_TYPES = [
  { value: "income", label: "Income" },
  { value: "expense", label: "Expense" },
  { value: "asset", label: "Asset" },
  { value: "liability", label: "Liability" },
  { value: "equity", label: "Equity" },
] as const;

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

export function BookkeepingClient({ data, canEdit }: { data: BookkeepingData; canEdit: boolean }) {
  const router = useRouter();
  const [view, setView] = React.useState<"transactions" | "reports" | "manage">("transactions");
  const [reviewFilter, setReviewFilter] = React.useState<"review" | "booked">("review");
  const [addOpen, setAddOpen] = React.useState(false);
  const [detail, setDetail] = React.useState<BkTxn | null>(null);
  const [confirmBook, setConfirmBook] = React.useState<BkTxn | null>(null);
  const [suggesting, setSuggesting] = React.useState(false);

  async function inlineUpdate(id: string, patch: Record<string, string | null>) {
    const res = await updateTransactionAction({ id, ...patch });
    if (!res.ok) return toast.error(res.error);
    router.refresh();
  }
  async function approve(id: string) {
    const res = await approveTransactionAction(id);
    setConfirmBook(null);
    if (!res.ok) return toast.error(res.error);
    toast.success("Booked");
    router.refresh();
  }
  async function autoSuggest() {
    setSuggesting(true);
    const res = await autoSuggestUnreviewedAction();
    setSuggesting(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(res.filled ? `Auto-filled ${res.filled} transaction${res.filled === 1 ? "" : "s"}` : "Nothing to suggest");
    router.refresh();
  }

  const toReviewCount = data.transactions.filter((t) => !t.approved).length;
  const visibleTxns = data.transactions.filter((t) => (reviewFilter === "review" ? !t.approved : t.approved));

  const { summary, pnl, balanceSheet } = data;
  const refresh = () => router.refresh();

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex w-fit gap-1 rounded-xl border border-border bg-card p-1">
        <TabBtn active={view === "transactions"} onClick={() => setView("transactions")}>Transactions</TabBtn>
        <TabBtn active={view === "reports"} onClick={() => setView("reports")}>Profit &amp; Loss · Balance Sheet</TabBtn>
        <TabBtn active={view === "manage"} onClick={() => setView("manage")}>Manage</TabBtn>
      </div>

      {view === "manage" ? (
        <ManagePanel data={data} canEdit={canEdit} onChanged={refresh} />
      ) : view === "transactions" ? (
        <>
          {/* Summary */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Money in" value={formatCents(summary.moneyIn)} icon={TrendingUp} tone="emerald" />
            <Stat label="Money out" value={formatCents(summary.moneyOut)} icon={TrendingDown} tone="red" />
            <Stat label="Net profit" value={formatCents(pnl.netProfit)} icon={Scale} tone={pnl.netProfit >= 0 ? "emerald" : "red"} accent />
          </div>

          {/* Toolbar: review filter + actions */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-lg border border-border bg-card p-0.5">
              <FilterPill active={reviewFilter === "review"} onClick={() => setReviewFilter("review")}>
                To review{toReviewCount > 0 ? ` (${toReviewCount})` : ""}
              </FilterPill>
              <FilterPill active={reviewFilter === "booked"} onClick={() => setReviewFilter("booked")}>Booked</FilterPill>
            </div>
            {canEdit && (
              <Button size="sm" onClick={() => setAddOpen(true)} className="bg-gold text-gold-foreground hover:bg-gold/90">
                <Plus className="size-4" /> Add transaction
              </Button>
            )}
            {canEdit && reviewFilter === "review" && (
              <Button size="sm" variant="outline" onClick={autoSuggest} disabled={suggesting}>
                {suggesting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Auto-suggest
              </Button>
            )}
            {canEdit && (
              <Button size="sm" variant="outline" onClick={() => setView("manage")}>
                <BookOpen className="size-4" /> Manage
              </Button>
            )}
          </div>

          {/* Transactions */}
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 text-left font-semibold">Date</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Description</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Category</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Vendor</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Deal</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Amount</th>
                  {canEdit && <th className="px-3 py-2.5 text-right font-semibold">{reviewFilter === "review" ? "Approve" : ""}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleTxns.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                    {reviewFilter === "review" ? "Nothing to review — all caught up." : "No booked transactions yet."}
                  </td></tr>
                )}
                {visibleTxns.map((t) => (
                  <tr key={t.id} className={cn("hover:bg-muted/40", t.autoSuggested && !t.approved && "bg-amber-50/70")}>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground tabular-nums">{fmtDate(t.date)}</td>
                    <td className="px-3 py-2">
                      {/* Click the description to open the transaction detail. */}
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => setDetail(t)} className="text-left font-medium hover:text-gold-muted hover:underline">{t.description}</button>
                        {t.autoSuggested && !t.approved && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">suggested</span>}
                      </div>
                      {t.account && <div className="text-xs text-muted-foreground">{t.account}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={t.categoryId ?? ""}
                        disabled={!canEdit}
                        onChange={(e) => inlineUpdate(t.id, { categoryId: e.target.value || null })}
                        className={cn("max-w-[150px] rounded-md border bg-background px-2 py-1 text-xs", t.categoryId ? "border-border" : "border-amber-400/60 text-amber-600")}
                      >
                        <option value="">Uncategorized</option>
                        {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={t.vendor ?? ""}
                        disabled={!canEdit}
                        onChange={(e) => inlineUpdate(t.id, { vendor: e.target.value || null })}
                        className={cn("max-w-[140px] rounded-md border border-border bg-background px-2 py-1 text-xs", !t.vendor && "text-muted-foreground")}
                      >
                        <option value="">— none —</option>
                        {t.vendor && !data.vendors.some((v) => v.name === t.vendor) && <option value={t.vendor}>{t.vendor}</option>}
                        {data.vendors.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={t.projectId ?? ""}
                        disabled={!canEdit}
                        onChange={(e) => inlineUpdate(t.id, { projectId: e.target.value || null })}
                        className="max-w-[150px] rounded-md border border-border bg-background px-2 py-1 text-xs"
                      >
                        <option value="">— none —</option>
                        {data.projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                      </select>
                    </td>
                    <td className={cn("whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums", t.amountCents >= 0 ? "text-emerald-600" : "text-red-600")}>
                      {t.amountCents >= 0 ? "+" : "−"}{formatCents(Math.abs(t.amountCents))}
                    </td>
                    {canEdit && (
                      <td className="px-3 py-2 text-right">
                        {reviewFilter === "review" ? (
                          <button
                            onClick={() => setConfirmBook(t)}
                            disabled={!t.categoryId}
                            title={t.categoryId ? "Approve & book this transaction" : "Pick a category first"}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <CheckCircle2 className="size-3.5" /> Book
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="size-3.5" /> Booked</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-1 text-[11px] leading-snug text-muted-foreground">
            Click a transaction to see details, tag a vendor &amp; deal, or delete it. Connect a bank or QuickBooks to auto-import new transactions (they arrive uncategorized for you to file).
          </p>
        </>
      ) : (
        /* Reports: P&L + Balance Sheet */
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Profit &amp; Loss</h3>
              <a href="/api/bookkeeping/pnl" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted">
                <Download className="size-3.5" /> Download PDF
              </a>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">All transactions · cash basis</p>
            <PnlGroup title="Income" rows={pnl.income} total={pnl.totalIncome} tone="emerald" />
            <PnlGroup title="Expenses" rows={pnl.expense} total={pnl.totalExpense} tone="red" />
            <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
              <span className="font-semibold">Net profit</span>
              <span className={cn("font-display text-lg font-semibold tabular-nums", pnl.netProfit >= 0 ? "text-emerald-600" : "text-red-600")}>{formatCents(pnl.netProfit)}</span>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Balance Sheet</h3>
              <a href="/api/bookkeeping/balance-sheet" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted">
                <Download className="size-3.5" /> Download PDF
              </a>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">As of today · cash basis</p>
            <PnlGroup title="Assets" rows={balanceSheet.assets} total={balanceSheet.totalAssets} tone="emerald" />
            <PnlGroup title="Liabilities" rows={balanceSheet.liabilities} total={balanceSheet.totalLiabilities} tone="red" />
            <PnlGroup title="Equity" rows={balanceSheet.equity} total={balanceSheet.totalEquity} tone="emerald" />
            <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
              <span className="font-semibold">Assets = Liabilities + Equity</span>
              <span className="font-display text-lg font-semibold tabular-nums">{formatCents(balanceSheet.totalAssets)}</span>
            </div>
          </div>
        </div>
      )}

      {confirmBook && (
        <Dialog open onOpenChange={(o) => !o && setConfirmBook(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Book this transaction?</DialogTitle></DialogHeader>
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">Once booked, it moves out of review and into your finalized ledger &amp; reports.</p>
              <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                <span className="min-w-0 truncate font-medium">{confirmBook.description}</span>
                <span className={cn("ml-2 shrink-0 font-semibold tabular-nums", confirmBook.amountCents >= 0 ? "text-emerald-600" : "text-red-600")}>
                  {confirmBook.amountCents >= 0 ? "+" : "−"}{formatCents(Math.abs(confirmBook.amountCents))}
                </span>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmBook(null)}>Cancel</Button>
              <Button onClick={() => approve(confirmBook.id)} className="bg-emerald-600 text-white hover:bg-emerald-700">
                <CheckCircle2 className="size-4" /> Yes, book it
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {detail && <TransactionDetail txn={detail} data={data} canEdit={canEdit} onClose={() => setDetail(null)} onChanged={refresh} onDeleted={() => { setDetail(null); refresh(); }} />}
      {addOpen && <AddTransactionDialog data={data} onClose={() => setAddOpen(false)} onDone={() => { setAddOpen(false); refresh(); }} />}
    </div>
  );
}

// ---- Manage tab: chart of accounts (categories), vendors, and bank sync ------

function ManagePanel({ data, canEdit, onChanged }: { data: BookkeepingData; canEdit: boolean; onChanged: () => void }) {
  const [catDialog, setCatDialog] = React.useState<{ open: boolean; cat?: { id: string; name: string; type: string } }>({ open: false });
  const [vendorDialog, setVendorDialog] = React.useState<{ open: boolean; vendor?: { id: string; name: string } }>({ open: false });
  const [connOpen, setConnOpen] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  async function removeCat(id: string, name: string) {
    if (!confirm(`Delete category "${name}"? Transactions filed under it become uncategorized.`)) return;
    setBusyId(id);
    const res = await deleteCategoryAction(id);
    setBusyId(null);
    if (!res.ok) return toast.error(res.error);
    toast.success("Category deleted");
    onChanged();
  }
  async function removeVendor(id: string, name: string) {
    if (!confirm(`Delete vendor "${name}"? Transactions keep their recorded vendor name.`)) return;
    setBusyId(id);
    const res = await deleteVendorAction(id);
    setBusyId(null);
    if (!res.ok) return toast.error(res.error);
    toast.success("Vendor deleted");
    onChanged();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Chart of Accounts */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2">
            <BookOpen className="size-4 text-gold" />
            <h3 className="font-semibold">Chart of Accounts</h3>
            <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{data.categories.length}</span>
          </div>
          {canEdit && <Button size="sm" variant="outline" onClick={() => setCatDialog({ open: true })}><Plus className="size-4" /> Add</Button>}
        </div>
        <div className="p-3">
          {data.categories.length === 0 && <p className="px-2 py-6 text-center text-sm text-muted-foreground">No categories yet.</p>}
          {ACCOUNT_TYPES.map(({ value, label }) => {
            const cats = data.categories.filter((c) => c.type === value);
            if (cats.length === 0) return null;
            return (
              <div key={value} className="mb-2">
                <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {cats.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="font-medium">{c.name}</span>
                      {canEdit && (
                        <span className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="size-7" onClick={() => setCatDialog({ open: true, cat: c })}><Pencil className="size-3.5" /></Button>
                          <Button variant="ghost" size="icon" className="size-7" disabled={busyId === c.id} onClick={() => removeCat(c.id, c.name)}>
                            {busyId === c.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5 text-destructive" />}
                          </Button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {/* Vendors + Bank/Sync */}
      <div className="space-y-6">
        <div className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <div className="flex items-center gap-2">
              <Building2 className="size-4 text-gold" />
              <h3 className="font-semibold">Vendors &amp; Contractors</h3>
              <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{data.vendors.length}</span>
            </div>
            {canEdit && <Button size="sm" variant="outline" onClick={() => setVendorDialog({ open: true })}><Plus className="size-4" /> Add</Button>}
          </div>
          <div className="p-3">
            {data.vendors.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">No vendors yet.</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {data.vendors.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="font-medium">{v.name}</span>
                    {canEdit && (
                      <span className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="size-7" onClick={() => setVendorDialog({ open: true, vendor: v })}><Pencil className="size-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="size-7" disabled={busyId === v.id} onClick={() => removeVendor(v.id, v.name)}>
                          {busyId === v.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5 text-destructive" />}
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Bank & sync */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <Plug className="size-4 text-gold" />
            <h3 className="font-semibold">Bank &amp; QuickBooks</h3>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            {data.connected ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
                <CheckCircle2 className="size-3.5" /> Connected · {data.provider}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">Not connected — transactions are entered manually.</span>
            )}
            {canEdit && (
              <Button size="sm" variant="outline" onClick={() => setConnOpen(true)}>
                <Plug className="size-4" /> {data.connected ? "Manage" : "Connect"}
              </Button>
            )}
          </div>
          <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
            Connect a bank or QuickBooks to auto-import transactions; they arrive uncategorized for you to file against this chart of accounts.
          </p>
        </div>
      </div>

      {catDialog.open && (
        <CategoryDialog category={catDialog.cat} onClose={() => setCatDialog({ open: false })} onDone={() => { setCatDialog({ open: false }); onChanged(); }} />
      )}
      {vendorDialog.open && (
        <VendorDialog vendor={vendorDialog.vendor} onClose={() => setVendorDialog({ open: false })} onDone={() => { setVendorDialog({ open: false }); onChanged(); }} />
      )}
      {connOpen && <ConnectDialog provider={data.provider} onClose={() => setConnOpen(false)} onDone={() => { setConnOpen(false); onChanged(); }} />}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn("rounded-lg px-4 py-2 text-sm font-medium transition-colors", active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted")}>
      {children}
    </button>
  );
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn("rounded-md px-3 py-1.5 text-xs font-medium transition-colors", active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted")}>
      {children}
    </button>
  );
}

function TransactionDetail({ txn, data, canEdit, onClose, onChanged, onDeleted }: { txn: BkTxn; data: BookkeepingData; canEdit: boolean; onClose: () => void; onChanged: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [notes, setNotes] = React.useState(txn.notes ?? "");

  async function patch(p: Record<string, string | null>) {
    const res = await updateTransactionAction({ id: txn.id, ...p });
    if (!res.ok) return toast.error(res.error);
    onChanged();
  }
  async function del() {
    if (!confirm("Delete this transaction? This can't be undone.")) return;
    setBusy(true);
    const res = await deleteTransactionAction(txn.id);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Transaction deleted");
    onDeleted();
  }
  async function book() {
    if (!confirm("Book this transaction? Once booked it moves out of review into your finalized ledger.")) return;
    setBusy(true);
    const res = await approveTransactionAction(txn.id);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Booked");
    onChanged();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{txn.description}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
            <span className="text-muted-foreground">{fmtDate(txn.date)}{txn.account ? ` · ${txn.account}` : ""}</span>
            <span className={cn("font-display text-lg font-semibold tabular-nums", txn.amountCents >= 0 ? "text-emerald-600" : "text-red-600")}>
              {txn.amountCents >= 0 ? "+" : "−"}{formatCents(Math.abs(txn.amountCents))}
            </span>
          </div>
          <DetailRow label="Source"><span className="capitalize">{txn.source}</span></DetailRow>
          <Field label="Category">
            <select defaultValue={txn.categoryId ?? ""} disabled={!canEdit} onChange={(e) => patch({ categoryId: e.target.value || null })} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
              <option value="">Uncategorized</option>
              {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Vendor / contractor">
            <select defaultValue={txn.vendor ?? ""} disabled={!canEdit} onChange={(e) => patch({ vendor: e.target.value || null })} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
              <option value="">— none —</option>
              {txn.vendor && !data.vendors.some((v) => v.name === txn.vendor) && <option value={txn.vendor}>{txn.vendor}</option>}
              {data.vendors.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
            </select>
          </Field>
          <Field label="Deal">
            <select defaultValue={txn.projectId ?? ""} disabled={!canEdit} onChange={(e) => patch({ projectId: e.target.value || null })} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
              <option value="">— none —</option>
              {data.projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </Field>
          <Field label="Notes">
            <Input value={notes} disabled={!canEdit} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (txn.notes ?? "") && patch({ notes: notes || null })} placeholder="Add a note…" />
          </Field>
        </div>
        <DialogFooter className="sm:justify-between">
          {canEdit ? (
            <Button variant="outline" onClick={del} disabled={busy} className="text-destructive hover:bg-destructive/10">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Delete
            </Button>
          ) : <span />}
          <div className="flex items-center gap-2">
            {canEdit && !txn.approved && (
              <Button onClick={book} disabled={busy || !txn.categoryId} title={txn.categoryId ? "" : "Pick a category first"} className="bg-emerald-600 text-white hover:bg-emerald-700">
                <CheckCircle2 className="size-4" /> Approve &amp; book
              </Button>
            )}
            <Button variant={txn.approved ? "default" : "outline"} onClick={onClose}>Done</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function VendorDialog({ vendor, onClose, onDone }: { vendor?: { id: string; name: string }; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [name, setName] = React.useState(vendor?.name ?? "");
  async function save() {
    if (!name.trim()) return toast.error("Enter a vendor name.");
    setBusy(true);
    const res = vendor
      ? await renameVendorAction({ id: vendor.id, name })
      : await createVendorAction({ name });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(vendor ? "Vendor updated" : "Vendor added");
    onDone();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{vendor ? "Edit vendor" : "New vendor / contractor"}</DialogTitle></DialogHeader>
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ABC Supply, Diaz Crew" /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} {vendor ? "Save" : "Add"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, icon: Icon, tone, accent }: { label: string; value: string; icon: typeof Scale; tone: "emerald" | "red"; accent?: boolean }) {
  return (
    <div className={cn("rounded-xl border bg-card p-5", accent ? "border-gold/40 bg-gold/[0.04]" : "border-border")}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
        <Icon className={cn("size-4", tone === "emerald" ? "text-emerald-600" : "text-red-600")} />
      </div>
      <div className="mt-1 font-display text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function PnlGroup({ title, rows, total, tone }: { title: string; rows: { name: string; total: number }[]; total: number; tone: "emerald" | "red" }) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span>{title}</span>
        <span className={cn("tabular-nums", tone === "emerald" ? "text-emerald-600" : "text-red-600")}>{formatCents(total)}</span>
      </div>
      <ul className="mt-1.5 space-y-1 text-sm">
        {rows.length === 0 && <li className="text-xs text-muted-foreground">None yet.</li>}
        {rows.map((r) => (
          <li key={r.name} className="flex items-center justify-between">
            <span className="text-muted-foreground">{r.name}</span>
            <span className="tabular-nums">{formatCents(r.total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AddTransactionDialog({ data, onClose, onDone }: { data: BookkeepingData; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [f, setF] = React.useState({ date: new Date().toISOString().slice(0, 10), description: "", direction: "out" as "in" | "out", amount: "", vendor: "", account: "", categoryId: "", projectId: "" });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function save() {
    if (!f.description.trim() || !(parseFloat(f.amount) >= 0)) return toast.error("Add a description and amount.");
    setBusy(true);
    const res = await createTransactionAction({ ...f, amount: parseFloat(f.amount) });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Transaction added");
    onDone();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Add transaction</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date"><Input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} /></Field>
          <Field label="Direction">
            <select value={f.direction} onChange={(e) => set("direction", e.target.value)} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
              <option value="out">Money out (expense)</option>
              <option value="in">Money in (income)</option>
            </select>
          </Field>
          <Field label="Description" full><Input value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="e.g. ABC Supply — shingles" /></Field>
          <Field label="Amount ($)"><Input type="number" inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0.00" /></Field>
          <Field label="Account"><Input value={f.account} onChange={(e) => set("account", e.target.value)} placeholder="Operating Checking" /></Field>
          <Field label="Vendor / contractor">
            <select value={f.vendor} onChange={(e) => set("vendor", e.target.value)} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
              <option value="">— none —</option>
              {data.vendors.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
            </select>
          </Field>
          <Field label="Category">
            <select value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
              <option value="">Uncategorized</option>
              {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Tag to deal" full>
            <select value={f.projectId} onChange={(e) => set("projectId", e.target.value)} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
              <option value="">— none —</option>
              {data.projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CategoryDialog({ category, onClose, onDone }: { category?: { id: string; name: string; type: string }; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [name, setName] = React.useState(category?.name ?? "");
  const [type, setType] = React.useState(category?.type ?? "expense");
  async function save() {
    if (!name.trim()) return toast.error("Enter a category name.");
    setBusy(true);
    const res = category
      ? await updateCategoryAction({ id: category.id, name, type: type as never })
      : await createCategoryAction({ name, type: type as never });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(category ? "Category updated" : "Category added");
    onDone();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{category ? "Edit category" : "New category"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Materials" /></Field>
          <Field label="Type">
            <select value={type} onChange={(e) => setType(e.target.value)} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
              {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} {category ? "Save" : "Add"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConnectDialog({ provider, onClose, onDone }: { provider: string | null; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [prov, setProv] = React.useState(provider ?? "quickbooks");
  const [key, setKey] = React.useState("");
  async function save() {
    setBusy(true);
    const res = await setBookkeepingConnectionAction({ provider: prov as never, apiKey: key });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Connection saved");
    onDone();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Connect bank / QuickBooks</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Field label="Provider">
            <select value={prov} onChange={(e) => setProv(e.target.value)} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
              <option value="quickbooks">QuickBooks</option>
              <option value="plaid">Bank (Plaid)</option>
              <option value="manual">Manual only</option>
            </select>
          </Field>
          <Field label="API key">
            <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your integration key" />
          </Field>
          <p className="text-[11px] leading-snug text-muted-foreground">
            The key is stored securely for the connector. Live transaction sync runs through the provider once the integration is enabled.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("space-y-1.5", full && "sm:col-span-2")}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
