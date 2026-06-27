"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { importStormCsvAction } from "@/server/modules/storm/actions";

export function StormImportDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [source, setSource] = React.useState("noaa");
  const [spcKind, setSpcKind] = React.useState("hail");
  const [reportDate, setReportDate] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  async function submit() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error("Choose a CSV file.");
      return;
    }
    const fd = new FormData();
    fd.set("file", file);
    fd.set("source", source);
    if (source === "spc") {
      fd.set("spcKind", spcKind);
      if (reportDate) fd.set("reportDate", reportDate);
    }
    setBusy(true);
    const res = await importStormCsvAction(fd);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    const imported = res.results.reduce((n, r) => n + r.imported, 0);
    toast.success(`Imported ${imported} storm reports.`);
    setOpen(false);
    if (fileRef.current) fileRef.current.value = "";
    qc.invalidateQueries({ queryKey: ["storm-events"] });
    qc.invalidateQueries({ queryKey: ["storm-matches"] });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Upload className="size-4" /> Import data
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import storm data</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Source</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="noaa">NOAA Storm Events (details CSV)</SelectItem>
                <SelectItem value="spc">SPC daily report (one kind)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {source === "spc" ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Report type</Label>
                <Select value={spcKind} onValueChange={setSpcKind}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hail">Hail</SelectItem>
                    <SelectItem value="wind">Wind</SelectItem>
                    <SelectItem value="torn">Tornado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Report date</Label>
                <Input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
              </div>
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">CSV file</Label>
            <Input ref={fileRef} type="file" accept=".csv,text/csv" />
          </div>
          <p className="text-xs text-muted-foreground">
            Only hail / wind / tornado events within the search region are kept. Scores recompute automatically.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy} className="gap-1.5">
            {busy ? <Loader2 className="size-4 animate-spin" /> : null} Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
