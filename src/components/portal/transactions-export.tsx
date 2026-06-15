"use client";

import * as React from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

type Cat = { id: string; name: string };
type Vendor = { id: string; name: string };

/** Flexible export of BOOKED transactions: date range + category + vendor + income/expense, as CSV or PDF. */
export function TransactionsExport({ categories, vendors = [] }: { categories: Cat[]; vendors?: Vendor[] }) {
  const [open, setOpen] = React.useState(false);
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [category, setCategory] = React.useState("all");
  const [vendor, setVendor] = React.useState("all");
  const [direction, setDirection] = React.useState("all");
  const [format, setFormat] = React.useState<"csv" | "pdf">("csv");

  function download() {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (category !== "all") p.set("category", category);
    if (vendor !== "all") p.set("vendor", vendor);
    if (direction !== "all") p.set("direction", direction);
    if (format !== "csv") p.set("format", format);
    window.location.href = `/portal/bookkeeping/export?${p.toString()}`;
    setOpen(false);
  }

  return (
    <div className="relative">
      <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>
        <Download className="size-4" /> Export CSV
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 w-72 space-y-3 rounded-xl border border-border bg-card p-4 shadow-lg">
            <p className="text-sm font-semibold">Export booked transactions</p>

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs text-muted-foreground">
                From
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground" />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                To
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground" />
              </label>
            </div>

            <label className="block space-y-1 text-xs text-muted-foreground">
              Category
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground">
                <option value="all">All categories</option>
                <option value="uncategorized">Uncategorized</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>

            <label className="block space-y-1 text-xs text-muted-foreground">
              Vendor
              <select value={vendor} onChange={(e) => setVendor(e.target.value)} className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground">
                <option value="all">All vendors</option>
                {vendors.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
              </select>
            </label>

            <label className="block space-y-1 text-xs text-muted-foreground">
              Type
              <select value={direction} onChange={(e) => setDirection(e.target.value)} className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground">
                <option value="all">Income &amp; expenses</option>
                <option value="in">Income only</option>
                <option value="out">Expenses only</option>
              </select>
            </label>

            <label className="block space-y-1 text-xs text-muted-foreground">
              Format
              <select value={format} onChange={(e) => setFormat(e.target.value as "csv" | "pdf")} className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground">
                <option value="csv">CSV (spreadsheet)</option>
                <option value="pdf">PDF (printable)</option>
              </select>
            </label>

            <p className="text-[11px] text-muted-foreground">Leave dates blank to export all booked transactions.</p>

            <Button size="sm" className="w-full" onClick={download}>
              <Download className="size-4" /> Download {format.toUpperCase()}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
