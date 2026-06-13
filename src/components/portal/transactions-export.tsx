"use client";

import * as React from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

type Cat = { id: string; name: string };

/** Flexible CSV export of BOOKED transactions: date range + category + income/expense. */
export function TransactionsExport({ categories }: { categories: Cat[] }) {
  const [open, setOpen] = React.useState(false);
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [category, setCategory] = React.useState("all");
  const [direction, setDirection] = React.useState("all");

  function download() {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (category !== "all") p.set("category", category);
    if (direction !== "all") p.set("direction", direction);
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
              Type
              <select value={direction} onChange={(e) => setDirection(e.target.value)} className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground">
                <option value="all">Income &amp; expenses</option>
                <option value="in">Income only</option>
                <option value="out">Expenses only</option>
              </select>
            </label>

            <p className="text-[11px] text-muted-foreground">Leave dates blank to export all booked transactions.</p>

            <Button size="sm" className="w-full" onClick={download}>
              <Download className="size-4" /> Download CSV
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
