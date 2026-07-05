"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Loader2, Trash2, Pencil, Plug, TrendingUp, TrendingDown, Scale, Download, BookOpen, Building2, CheckCircle2, Sparkles, Paperclip, Upload, FileText, Wallet } from "lucide-react";
import { TransactionsExport } from "@/components/portal/transactions-export";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useFormat } from "@/components/portal/branding-provider";
import type { BookkeepingData, BkTxn, BkVendor, BkReconciliation } from "@/server/modules/bookkeeping/queries";
import { computeReports, resolvePeriod, type PeriodPreset } from "@/lib/bookkeeping-reports";
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
  updateVendorAction,
  deleteVendorAction,
  setBookkeepingConnectionAction,
  uploadTransactionAttachmentAction,
  deleteTransactionAttachmentAction,
  finishReconciliationAction,
  undoReconciliationAction,
} from "@/server/modules/bookkeeping/actions";

const ACCOUNT_TYPES = [
  { value: "income", label: "Income" },
  { value: "expense", label: "Expense" },
  { value: "asset", label: "Asset" },
  { value: "liability", label: "Liability" },
  { value: "equity", label: "Equity" },
] as const;

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

export function BookkeepingClient({
  data,
  canEdit,
}: {
  data: BookkeepingData;
  canEdit: boolean;
}) {
  const fmt = useFormat();
  const router = useRouter();
  const [view, setView] = React.useState<"transactions" | "reports" | "reconcile" | "manage">("transactions");
  const [reviewFilter, setReviewFilter] = React.useState<"review" | "booked">("review");
  const [addOpen, setAddOpen] = React.useState(false);
  const [detail, setDetail] = React.useState<BkTxn | null>(null);
  const [confirmBook, setConfirmBook] = React.useState<BkTxn | null>(null);
  const [suggesting, setSuggesting] = React.useState(false);
  // Transactions-tab date filter (independent of the Reports period picker).
  const [txnPreset, setTxnPreset] = React.useState<PeriodPreset>("all");
  const [txnStart, setTxnStart] = React.useState("");
  const [txnEnd, setTxnEnd] = React.useState("");

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

  // Resolve the date filter to epoch-ms bounds (reuses the Reports period logic
  // so presets like "This month"/years/custom range behave identically).
  const txnPeriod = React.useMemo(
    () => resolvePeriod(txnPreset, new Date(), { start: txnStart || null, end: txnEnd || null }).period,
    [txnPreset, txnStart, txnEnd]
  );
  const dateFilterActive = txnPeriod.startMs != null || txnPeriod.endMs != null;

  const visibleTxns = data.transactions.filter((t) => {
    if (reviewFilter === "review" ? t.approved : !t.approved) return false;
    const tms = new Date(t.date).getTime();
    if (txnPeriod.startMs != null && tms < txnPeriod.startMs) return false;
    if (txnPeriod.endMs != null && tms > txnPeriod.endMs) return false;
    return true;
  });

  const { summary } = data;
  const refresh = () => router.refresh();

  // ── Reports period (P&L is for a span; Balance Sheet is a snapshot as-of end).
  const [periodPreset, setPeriodPreset] = React.useState<PeriodPreset>("all");
  const [customStart, setCustomStart] = React.useState("");
  const [customEnd, setCustomEnd] = React.useState("");

  // Years present in the ledger (descending), for the preset list.
  const ledgerYears = React.useMemo(() => {
    const ys = new Set<number>();
    for (const t of data.transactions) ys.add(new Date(t.date).getFullYear());
    ys.add(new Date().getFullYear());
    return [...ys].sort((a, b) => b - a);
  }, [data.transactions]);

  const resolved = React.useMemo(
    () => resolvePeriod(periodPreset, new Date(), { start: customStart || null, end: customEnd || null }),
    [periodPreset, customStart, customEnd]
  );
  const { pnl, balanceSheet } = React.useMemo(
    () => computeReports(data.transactions, resolved.period),
    [data.transactions, resolved.period]
  );

  // PDF links carry the selected period so the download matches the screen.
  const pdfParams = (kind: "pnl" | "bs") => {
    const p = new URLSearchParams();
    if (resolved.period.startMs != null && kind === "pnl") p.set("start", String(resolved.period.startMs));
    if (resolved.period.endMs != null) p.set("end", String(resolved.period.endMs));
    if (kind === "pnl") p.set("label", resolved.pnlLabel);
    else p.set("asOf", resolved.asOfLabel.replace(/^As of /, ""));
    const qs = p.toString();
    return qs ? `?${qs}` : "";
  };

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex w-fit gap-1 rounded-xl border border-border bg-card p-1">
        <TabBtn active={view === "transactions"} onClick={() => setView("transactions")}>Transactions</TabBtn>
        <TabBtn active={view === "reports"} onClick={() => setView("reports")}>Profit &amp; Loss · Balance Sheet</TabBtn>
        <TabBtn active={view === "reconcile"} onClick={() => setView("reconcile")}>Reconcile</TabBtn>
        <TabBtn active={view === "manage"} onClick={() => setView("manage")}>Manage</TabBtn>
      </div>

      {view === "manage" ? (
        <ManagePanel data={data} canEdit={canEdit} onChanged={refresh} />
      ) : view === "transactions" ? (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
            <Stat label="Money in" value={fmt.money(summary.moneyIn)} icon={TrendingUp} tone="emerald" />
            <Stat label="Money out" value={fmt.money(summary.moneyOut)} icon={TrendingDown} tone="red" />
            <Stat label="Net profit" value={fmt.money(pnl.netProfit)} icon={Scale} tone={pnl.netProfit >= 0 ? "emerald" : "red"} accent />
            <Stat label="Left to collect" value={fmt.money(summary.outstanding)} icon={Wallet} tone="emerald" />
          </div>

          {/* Toolbar: review filter + actions */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-lg border border-border bg-card p-0.5">
              <FilterPill active={reviewFilter === "review"} onClick={() => setReviewFilter("review")}>
                To review{toReviewCount > 0 ? ` (${toReviewCount})` : ""}
              </FilterPill>
              <FilterPill active={reviewFilter === "booked"} onClick={() => setReviewFilter("booked")}>Booked</FilterPill>
            </div>
            {/* Date filter */}
            <select
              value={txnPreset}
              onChange={(e) => setTxnPreset(e.target.value)}
              className="h-9 rounded-lg border border-border bg-card px-2 text-sm"
            >
              <option value="all">All dates</option>
              <option value="month">This month</option>
              <option value="quarter">This quarter</option>
              {ledgerYears.map((y) => (
                <option key={y} value={String(y)}>
                  {y === new Date().getFullYear() ? `${y} (this year)` : y}
                </option>
              ))}
              <option value="custom">Custom range…</option>
            </select>
            {txnPreset === "custom" && (
              <>
                <Input type="date" value={txnStart} onChange={(e) => setTxnStart(e.target.value)} className="h-9 w-40" />
                <span className="text-sm text-muted-foreground">to</span>
                <Input type="date" value={txnEnd} onChange={(e) => setTxnEnd(e.target.value)} className="h-9 w-40" />
              </>
            )}
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
            <div className="ml-auto flex items-center gap-2">
              <a
                href="/portal/bookkeeping/1099"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted"
              >
                1099s
              </a>
              <TransactionsExport categories={data.categories} vendors={data.vendors} />
            </div>
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
                    {dateFilterActive
                      ? "No transactions in this date range."
                      : reviewFilter === "review" ? "Nothing to review — all caught up." : "No booked transactions yet."}
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
                      {t.amountCents >= 0 ? "+" : "−"}{fmt.money(Math.abs(t.amountCents))}
                    </td>
                    {canEdit && (
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex items-center gap-2.5">
                          {/* Notes & receipt attachment for this transaction. */}
                          <button
                            onClick={() => setDetail(t)}
                            title="Notes & receipt"
                            className="relative text-muted-foreground hover:text-foreground"
                          >
                            <Pencil className="size-4" />
                            {t.attachments.length > 0 && (
                              <Paperclip className="absolute -right-2 -top-1.5 size-2.5 text-gold" />
                            )}
                          </button>
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
                        </div>
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
      ) : view === "reports" ? (
        /* Reports: P&L + Balance Sheet */
        <div className="space-y-4">
          {/* Period selector */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-4 py-3">
            <span className="text-sm font-medium text-muted-foreground">Period</span>
            <select
              value={periodPreset}
              onChange={(e) => setPeriodPreset(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="all">All time</option>
              <option value="month">This month</option>
              <option value="quarter">This quarter</option>
              {ledgerYears.map((y) => (
                <option key={y} value={String(y)}>
                  {y === new Date().getFullYear() ? `${y} (this year)` : y}
                </option>
              ))}
              <option value="custom">Custom range…</option>
            </select>
            {periodPreset === "custom" && (
              <>
                <Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="h-9 w-40" />
                <span className="text-sm text-muted-foreground">to</span>
                <Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="h-9 w-40" />
              </>
            )}
            <span className="ml-auto text-xs text-muted-foreground">{resolved.pnlLabel} · cash basis</span>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Profit &amp; Loss</h3>
                <a href={`/api/bookkeeping/pnl${pdfParams("pnl")}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted">
                  <Download className="size-3.5" /> Download PDF
                </a>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{resolved.pnlLabel} · cash basis</p>
              <PnlGroup title="Income" rows={pnl.income} total={pnl.totalIncome} tone="emerald" />
              <PnlGroup title="Expenses" rows={pnl.expense} total={pnl.totalExpense} tone="red" />
              <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                <span className="font-semibold">Net profit</span>
                <span className={cn("font-display text-lg font-semibold tabular-nums", pnl.netProfit >= 0 ? "text-emerald-600" : "text-red-600")}>{fmt.money(pnl.netProfit)}</span>
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Balance Sheet</h3>
                <a href={`/api/bookkeeping/balance-sheet${pdfParams("bs")}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted">
                  <Download className="size-3.5" /> Download PDF
                </a>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{resolved.asOfLabel} · cash basis</p>
              <PnlGroup title="Assets" rows={balanceSheet.assets} total={balanceSheet.totalAssets} tone="emerald" />
              <PnlGroup title="Liabilities" rows={balanceSheet.liabilities} total={balanceSheet.totalLiabilities} tone="red" />
              <PnlGroup title="Equity" rows={balanceSheet.equity} total={balanceSheet.totalEquity} tone="emerald" />
              <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                <span className="font-semibold">Assets = Liabilities + Equity</span>
                <span className="font-display text-lg font-semibold tabular-nums">{fmt.money(balanceSheet.totalAssets)}</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <ReconcilePanel data={data} canEdit={canEdit} />
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
                  {confirmBook.amountCents >= 0 ? "+" : "−"}{fmt.money(Math.abs(confirmBook.amountCents))}
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
  const [vendorDialog, setVendorDialog] = React.useState<{ open: boolean; vendor?: BkVendor }>({ open: false });
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

// ---- Reconcile tab: match transactions to a bank statement -------------------
function ReconcilePanel({ data, canEdit }: { data: BookkeepingData; canEdit: boolean }) {
  const fmt = useFormat();
  const router = useRouter();

  const accounts = React.useMemo(() => {
    const s = new Set<string>();
    for (const t of data.transactions) if (t.account) s.add(t.account);
    return [...s].sort();
  }, [data.transactions]);

  const [account, setAccount] = React.useState<string>(accounts[0] ?? "");
  const [statementDate, setStatementDate] = React.useState("");
  const [endingBalance, setEndingBalance] = React.useState("");
  const [cleared, setCleared] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);

  // Beginning balance = everything already reconciled on this account.
  const beginning = React.useMemo(
    () => data.transactions.filter((t) => t.account === account && t.status === "reconciled").reduce((s, t) => s + t.amountCents, 0),
    [data.transactions, account]
  );

  // Outstanding (not-yet-reconciled) transactions on this account, up to the statement date.
  const outstanding = React.useMemo(() => {
    const endMs = statementDate ? new Date(`${statementDate}T23:59:59`).getTime() : Infinity;
    return data.transactions
      .filter((t) => t.account === account && t.status !== "reconciled" && new Date(t.date).getTime() <= endMs)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [data.transactions, account, statementDate]);

  // Keep the cleared set valid when the account/date filter changes.
  React.useEffect(() => {
    setCleared((prev) => new Set([...prev].filter((id) => outstanding.some((t) => t.id === id))));
  }, [outstanding]);

  const clearedTxns = outstanding.filter((t) => cleared.has(t.id));
  const clearedDeposits = clearedTxns.filter((t) => t.amountCents >= 0).reduce((s, t) => s + t.amountCents, 0);
  const clearedPayments = clearedTxns.filter((t) => t.amountCents < 0).reduce((s, t) => s + -t.amountCents, 0);
  const clearedBalance = beginning + clearedDeposits - clearedPayments;
  const endingCents = endingBalance.trim() === "" ? null : Math.round(parseFloat(endingBalance) * 100);
  const difference = endingCents == null || Number.isNaN(endingCents) ? null : endingCents - clearedBalance;
  const canFinish = canEdit && !!account && !!statementDate && endingCents != null && !Number.isNaN(endingCents) && cleared.size > 0 && difference === 0;

  function toggle(id: string) {
    setCleared((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function finish() {
    if (endingCents == null) return;
    setBusy(true);
    const res = await finishReconciliationAction({ account, statementDate, endingBalanceCents: endingCents, transactionIds: [...cleared] });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Reconciled");
    setCleared(new Set()); setEndingBalance("");
    router.refresh();
  }

  async function undo(id: string) {
    if (!window.confirm("Undo this reconciliation? Its transactions go back to unreconciled.")) return;
    const res = await undoReconciliationAction(id);
    if (!res.ok) return toast.error(res.error);
    toast.success("Reconciliation undone");
    router.refresh();
  }

  if (accounts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
        No bank accounts to reconcile yet. Add transactions with an <strong>Account</strong> (e.g. &ldquo;Operating Checking&rdquo;), then come back to match them against your statement.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Statement inputs */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="space-y-1">
          <Label className="text-xs">Account</Label>
          <select value={account} onChange={(e) => setAccount(e.target.value)} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
            {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Statement ending date</Label>
          <Input type="date" value={statementDate} onChange={(e) => setStatementDate(e.target.value)} className="h-9 w-44" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Statement ending balance</Label>
          <Input type="number" inputMode="decimal" value={endingBalance} onChange={(e) => setEndingBalance(e.target.value)} placeholder="0.00" className="h-9 w-40" />
        </div>
      </div>

      {/* Worksheet */}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="overflow-x-auto rounded-xl border border-border bg-card lg:col-span-2">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Cleared</th>
                <th className="px-3 py-2 text-left font-semibold">Date</th>
                <th className="px-3 py-2 text-left font-semibold">Description</th>
                <th className="px-3 py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {outstanding.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">Nothing outstanding for this account{statementDate ? " up to that date" : ""}.</td></tr>
              )}
              {outstanding.map((t) => (
                <tr key={t.id} className={cn("cursor-pointer hover:bg-muted/40", cleared.has(t.id) && "bg-emerald-50/60")} onClick={() => toggle(t.id)}>
                  <td className="px-3 py-2"><input type="checkbox" checked={cleared.has(t.id)} onChange={() => toggle(t.id)} onClick={(e) => e.stopPropagation()} /></td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground tabular-nums">{fmtDate(t.date)}</td>
                  <td className="px-3 py-2">{t.description}</td>
                  <td className={cn("whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums", t.amountCents >= 0 ? "text-emerald-600" : "text-red-600")}>{fmt.money(t.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Summary */}
        <div className="space-y-3 rounded-xl border border-border bg-card p-5">
          <h3 className="font-semibold">Reconciliation</h3>
          <SumLine label="Beginning balance" value={fmt.money(beginning)} />
          <SumLine label={`Cleared deposits (${clearedTxns.filter((t) => t.amountCents >= 0).length})`} value={fmt.money(clearedDeposits)} tone="emerald" />
          <SumLine label={`Cleared payments (${clearedTxns.filter((t) => t.amountCents < 0).length})`} value={`-${fmt.money(clearedPayments)}`} tone="red" />
          <div className="flex items-center justify-between border-t border-border pt-2 text-sm font-semibold">
            <span>Cleared balance</span><span className="tabular-nums">{fmt.money(clearedBalance)}</span>
          </div>
          <SumLine label="Statement ending balance" value={endingCents != null && !Number.isNaN(endingCents) ? fmt.money(endingCents) : "—"} />
          <div className={cn("flex items-center justify-between rounded-lg border px-3 py-2 text-sm font-semibold", difference === 0 ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-amber-300 bg-amber-50 text-amber-700")}>
            <span>Difference</span><span className="tabular-nums">{difference == null ? "—" : fmt.money(difference)}</span>
          </div>
          <Button onClick={finish} disabled={!canFinish || busy} className="w-full bg-gold text-gold-foreground hover:bg-gold/90">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Finish reconciliation
          </Button>
          {difference != null && difference !== 0 && (
            <p className="text-[11px] text-muted-foreground">Clear transactions until the difference is $0 to finish.</p>
          )}
        </div>
      </div>

      {/* History */}
      {data.reconciliations.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3 text-sm font-semibold">Past reconciliations</div>
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Statement date</th>
                <th className="px-4 py-2 text-left font-semibold">Account</th>
                <th className="px-4 py-2 text-right font-semibold">Ending balance</th>
                <th className="px-4 py-2 text-right font-semibold">Cleared</th>
                <th className="px-4 py-2 text-right font-semibold">Report</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.reconciliations.map((r) => (
                <tr key={r.id} className="hover:bg-muted/40">
                  <td className="px-4 py-2 tabular-nums">{fmtDate(r.statementDate)}</td>
                  <td className="px-4 py-2">{r.account}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmt.money(r.endingBalanceCents)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.clearedCount}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-2">
                      <a href={`/api/bookkeeping/reconciliation?id=${r.id}`} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted">
                        <Download className="size-3.5" /> PDF
                      </a>
                      {canEdit && (
                        <button onClick={() => undo(r.id)} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
                          <Trash2 className="size-3.5" /> Undo
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SumLine({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "red" }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", tone === "emerald" && "text-emerald-600", tone === "red" && "text-red-600")}>{value}</span>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn("rounded-lg px-4 py-2 text-sm font-medium transition-colors", active ? "bg-muted text-gold" : "text-muted-foreground hover:bg-muted")}>
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
  const fmt = useFormat();
  const [busy, setBusy] = React.useState(false);
  const [notes, setNotes] = React.useState(txn.notes ?? "");
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  // The open dialog holds the txn it was opened with; after a refresh the fresh
  // copy (e.g. with a new attachment) lives in `data`. Prefer it when present.
  const live = data.transactions.find((t) => t.id === txn.id) ?? txn;

  async function patch(p: Record<string, string | null>) {
    const res = await updateTransactionAction({ id: txn.id, ...p });
    if (!res.ok) return toast.error(res.error);
    onChanged();
  }
  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.set("transactionId", txn.id);
    fd.set("file", file);
    const res = await uploadTransactionAttachmentAction(fd);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    if (!res.ok) return toast.error(res.error);
    toast.success("Receipt attached");
    onChanged();
  }
  async function removeAttachment(fileId: string) {
    const res = await deleteTransactionAttachmentAction(fileId);
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
              {txn.amountCents >= 0 ? "+" : "−"}{fmt.money(Math.abs(txn.amountCents))}
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
          <Field label="Receipt / invoice">
            <div className="space-y-1.5">
              {live.attachments.length > 0 ? (
                <ul className="space-y-1">
                  {live.attachments.map((a) => (
                    <li key={a.id} className="flex items-center justify-between rounded-md border border-border px-2 py-1.5">
                      <a href={`/portal/files/${a.id}`} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 text-xs hover:text-gold-muted">
                        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{a.name}</span>
                      </a>
                      {canEdit && (
                        <button onClick={() => removeAttachment(a.id)} className="shrink-0 text-muted-foreground hover:text-destructive" aria-label="Remove">
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">No receipt attached.</p>
              )}
              {canEdit && (
                <>
                  <input ref={fileRef} type="file" accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx,.csv" className="hidden" onChange={onUpload} />
                  <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
                    {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Upload receipt
                  </Button>
                </>
              )}
            </div>
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

function VendorDialog({ vendor, onClose, onDone }: { vendor?: BkVendor; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [f, setF] = React.useState({
    name: vendor?.name ?? "",
    companyName: vendor?.companyName ?? "",
    contactName: vendor?.contactName ?? "",
    email: vendor?.email ?? "",
    phone: vendor?.phone ?? "",
    einTaxId: vendor?.einTaxId ?? "",
    is1099: vendor?.is1099 ?? false,
    address: vendor?.address ?? "",
    city: vendor?.city ?? "",
    state: vendor?.state ?? "",
    zip: vendor?.zip ?? "",
    accountNumber: vendor?.accountNumber ?? "",
    notes: vendor?.notes ?? "",
  });
  const upd = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  async function save() {
    if (!f.name.trim()) return toast.error("Enter a vendor name.");
    setBusy(true);
    const res = vendor ? await updateVendorAction({ id: vendor.id, ...f }) : await createVendorAction(f);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(vendor ? "Vendor updated" : "Vendor added");
    onDone();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>{vendor ? "Edit vendor / contractor" : "New vendor / contractor"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Field label="Display name"><Input value={f.name} onChange={upd("name")} placeholder="e.g. ABC Supply, Diaz Crew" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Company / legal name"><Input value={f.companyName} onChange={upd("companyName")} placeholder="ABC Supply LLC" /></Field>
            <Field label="Contact name"><Input value={f.contactName} onChange={upd("contactName")} placeholder="Jane Diaz" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email"><Input type="email" value={f.email} onChange={upd("email")} placeholder="ap@abcsupply.com" /></Field>
            <Field label="Phone"><Input value={f.phone} onChange={upd("phone")} placeholder="(555) 123-4567" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="EIN / Tax ID"><Input value={f.einTaxId} onChange={upd("einTaxId")} placeholder="12-3456789" /></Field>
            <Field label="Account #"><Input value={f.accountNumber} onChange={upd("accountNumber")} placeholder="Your acct # with them" /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.is1099} onChange={(e) => setF((s) => ({ ...s, is1099: e.target.checked }))} className="size-4 rounded border-border" />
            1099 contractor (issue a 1099 at year-end)
          </label>
          <Field label="Address"><Input value={f.address} onChange={upd("address")} placeholder="123 Main St" /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="City"><Input value={f.city} onChange={upd("city")} placeholder="Dallas" /></Field>
            <Field label="State"><Input value={f.state} onChange={upd("state")} placeholder="TX" /></Field>
            <Field label="ZIP"><Input value={f.zip} onChange={upd("zip")} placeholder="75201" /></Field>
          </div>
          <Field label="Notes">
            <textarea
              value={f.notes}
              onChange={upd("notes")}
              rows={2}
              placeholder="Payment terms, W-9 on file, etc."
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} {vendor ? "Save" : "Add"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, icon: Icon, tone, accent }: { label: string; value: string; icon: typeof Scale; tone: "emerald" | "red"; accent?: boolean }) {
  const fmt = useFormat();
  return (
    <div className={cn("rounded-xl border bg-card p-4 sm:p-5", accent ? "border-gold/40 bg-gold/[0.04]" : "border-border")}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
        <Icon className={cn("size-4", tone === "emerald" ? "text-emerald-600" : "text-red-600")} />
      </div>
      <div className="mt-1 font-display text-xl font-semibold tabular-nums sm:text-2xl">{value}</div>
    </div>
  );
}

function PnlGroup({ title, rows, total, tone }: { title: string; rows: { name: string; total: number }[]; total: number; tone: "emerald" | "red" }) {
  const fmt = useFormat();
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span>{title}</span>
        <span className={cn("tabular-nums", tone === "emerald" ? "text-emerald-600" : "text-red-600")}>{fmt.money(total)}</span>
      </div>
      <ul className="mt-1.5 space-y-1 text-sm">
        {rows.length === 0 && <li className="text-xs text-muted-foreground">None yet.</li>}
        {rows.map((r) => (
          <li key={r.name} className="flex items-center justify-between">
            <span className="text-muted-foreground">{r.name}</span>
            <span className="tabular-nums">{fmt.money(r.total)}</span>
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
