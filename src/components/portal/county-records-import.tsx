"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Upload, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Hint, Panel } from "@/components/portal/settings-kit";
import { importOwnerRecordsAction } from "@/server/modules/canvassing/actions";

// Read just the header row + a sample of a CSV client-side (files can be large).
function headersOf(text: string): string[] {
  const firstLine = text.slice(0, text.indexOf("\n") >= 0 ? text.indexOf("\n") : text.length);
  // Naive split is fine for the header (CAD headers rarely contain quoted commas).
  return firstLine.replace(/\r$/, "").split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
}

export function CountyRecordsImport() {
  const router = useRouter();
  const [text, setText] = React.useState<string | null>(null);
  const [fileName, setFileName] = React.useState("");
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [map, setMap] = React.useState({ owner: "", address: "", value: "" });
  const [busy, setBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  function guess(cands: string[], headers: string[]): string {
    const lower = headers.map((h) => h.toLowerCase());
    for (const c of cands) {
      const i = lower.findIndex((h) => h.includes(c));
      if (i >= 0) return headers[i];
    }
    return "";
  }

  async function onFile(file: File | null) {
    if (!file) return;
    setFileName(file.name);
    const t = await file.text();
    const h = headersOf(t);
    setText(t);
    setHeaders(h);
    setMap({
      owner: guess(["owner", "name"], h),
      address: guess(["situs", "property addr", "prop addr", "site addr", "address", "addr"], h),
      value: guess(["market", "appraised", "total val", "value", "assessed"], h),
    });
  }

  async function run() {
    if (!text) return toast.error("Choose a CSV file.");
    if (!map.owner || !map.address) return toast.error("Map the Owner name and Address columns.");
    setBusy(true);
    const res = await importOwnerRecordsAction({ csvText: text, mapping: { owner: map.owner, address: map.address, value: map.value || undefined } });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    const r = res.result;
    toast.success(`Matched ${r.matched.toLocaleString()} houses — filled ${r.filledNames.toLocaleString()} owner names, ${r.filledValues.toLocaleString()} values.`);
    setText(null); setFileName(""); setHeaders([]);
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  return (
    <Panel
      title="Import a county appraisal roll"
      description="Free, and the cheapest owner data there is. Download your county's public roll (Collin CAD, DCAD, Denton CAD, TAD…), upload the CSV, and match its columns — it fills the owner name and appraised value on every matching house at no per-lookup cost. County data carries no phone or email; those need a paid provider."
    >

      <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => fileRef.current?.click()}>
        <Upload className="size-4" /> {fileName ? "Choose a different file" : "Choose CSV file"}
      </Button>
      {fileName && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FileSpreadsheet className="size-3.5" /> {fileName} · {headers.length} columns
        </div>
      )}

      {headers.length > 0 && (
        <div className="space-y-2.5 rounded-lg border border-border bg-background p-3">
          <p className="text-xs font-medium">Map columns</p>
          <ColMap label="Owner name" value={map.owner} headers={headers} onChange={(v) => setMap((m) => ({ ...m, owner: v }))} required />
          <ColMap label="Property (situs) address" value={map.address} headers={headers} onChange={(v) => setMap((m) => ({ ...m, address: v }))} required />
          <ColMap label="Appraised value (optional)" value={map.value} headers={headers} onChange={(v) => setMap((m) => ({ ...m, value: v }))} />
          <Button onClick={run} disabled={busy} className="mt-1">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Import & match
          </Button>
        </div>
      )}
      <Hint>
        On a big county, filter the export down to your ZIPs or city before uploading. Re-import
        after each new roll to refresh the owners.
      </Hint>
    </Panel>
  );
}

function ColMap({ label, value, headers, onChange, required }: { label: string; value: string; headers: string[]; onChange: (v: string) => void; required?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className="text-xs">{label}{required && <span className="text-destructive"> *</span>}</Label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-8 max-w-[55%] rounded-md border border-border bg-background px-2 text-xs">
        <option value="">— none —</option>
        {headers.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
    </div>
  );
}
