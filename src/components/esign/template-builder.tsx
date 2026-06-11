"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2, Plus, Trash2, Save, PenLine, Type, Calendar, CheckSquare,
  ChevronLeft, ChevronRight, LayoutGrid, ListChecks, Link2, AlertCircle, FileDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { saveTemplateFieldsAction } from "@/server/modules/esign/actions";
import type { CatalogEntry } from "@/server/modules/esign/autofill";
import { PdfCanvas } from "./pdf-canvas";

type FieldType = "text" | "date" | "checkbox" | "signature" | "initials";
type SignerRole = "customer" | "co_customer" | "company_rep" | "witness";
type BField = {
  key: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  type: FieldType;
  signerRole: SignerRole;
  label: string;
  valueToken: string;
  defaultValue: string;
  required: boolean;
};

const FIELD_DEFS: { type: FieldType; label: string; icon: React.ComponentType<{ className?: string }>; w: number; h: number }[] = [
  { type: "signature", label: "Signature", icon: PenLine, w: 180, h: 44 },
  { type: "initials", label: "Initials", icon: PenLine, w: 70, h: 40 },
  { type: "date", label: "Date", icon: Calendar, w: 130, h: 32 },
  { type: "text", label: "Text", icon: Type, w: 160, h: 32 },
  { type: "checkbox", label: "Checkbox", icon: CheckSquare, w: 24, h: 24 },
];

// Field types whose value can be auto-filled from a CRM record.
const FILLABLE: FieldType[] = ["text", "date", "checkbox"];
const isFillable = (t: FieldType) => FILLABLE.includes(t);

export function TemplateBuilder({
  templateId,
  templateName,
  body,
  initialFields,
  pages,
  pdfUrl,
  catalog,
}: {
  templateId: string;
  templateName: string;
  body: { page: number; type: string; text: string; x: number; y: number }[];
  initialFields: Omit<BField, "key">[];
  pages: { width: number; height: number }[];
  pdfUrl?: string;
  catalog: CatalogEntry[];
}) {
  const router = useRouter();
  const canvasRef = React.useRef<HTMLDivElement | null>(null);
  const [fields, setFields] = React.useState<BField[]>(
    initialFields.map((f, i) => ({ ...f, key: `f${i}` }))
  );
  const [selected, setSelected] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [view, setView] = React.useState<"editor" | "mapping">("editor");
  const drag = React.useRef<{ key: string; startX: number; startY: number; origX: number; origY: number } | null>(null);

  const pageList = pages.length > 0 ? pages : [{ width: 612, height: 792 }];
  const cur = pageList[currentPage - 1] ?? pageList[0];
  const PW = cur.width;
  const PH = cur.height;

  // token -> friendly label, and grouped entries for the picker.
  const labelMap = React.useMemo(
    () => Object.fromEntries(catalog.map((e) => [e.token, `${e.group} · ${e.label}`])),
    [catalog]
  );
  const groups = React.useMemo(() => {
    const m = new Map<string, CatalogEntry[]>();
    for (const e of catalog) {
      const arr = m.get(e.group) ?? [];
      arr.push(e);
      m.set(e.group, arr);
    }
    return [...m.entries()];
  }, [catalog]);

  const fillable = fields.filter((f) => isFillable(f.type));
  const mappedCount = fillable.filter((f) => f.valueToken).length;
  const unmappedCount = fillable.length - mappedCount;

  function addField(type: FieldType) {
    const def = FIELD_DEFS.find((d) => d.type === type)!;
    const key = `f${Date.now()}`;
    setFields((s) => [
      ...s,
      { key, page: currentPage, x: 60, y: PH - 200, width: def.w, height: def.h, type, signerRole: "customer", label: def.label, valueToken: "", defaultValue: "", required: true },
    ]);
    setSelected(key);
  }
  function updateField(key: string, patch: Partial<BField>) {
    setFields((s) => s.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  }
  function removeField(key: string) {
    setFields((s) => s.filter((f) => f.key !== key));
    if (selected === key) setSelected(null);
  }
  function jumpTo(f: BField) {
    setCurrentPage(f.page);
    setSelected(f.key);
    setView("editor");
  }

  function onPointerDown(e: React.PointerEvent, f: BField) {
    e.preventDefault();
    setSelected(f.key);
    drag.current = { key: f.key, startX: e.clientX, startY: e.clientY, origX: f.x, origY: f.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const dxPt = ((e.clientX - drag.current.startX) / rect.width) * PW;
    const dyPt = ((e.clientY - drag.current.startY) / rect.height) * PH;
    const f = fields.find((x) => x.key === drag.current!.key);
    if (!f) return;
    const nx = Math.max(0, Math.min(PW - f.width, drag.current.origX + dxPt));
    const ny = Math.max(0, Math.min(PH - f.height, drag.current.origY - dyPt));
    updateField(drag.current.key, { x: Math.round(nx), y: Math.round(ny) });
  }
  function onPointerUp() {
    drag.current = null;
  }

  async function save() {
    setPending(true);
    const res = await saveTemplateFieldsAction({
      templateId,
      fields: fields.map(({ key: _key, ...f }) => f),
    });
    setPending(false);
    if (res.ok) {
      toast.success("Template saved");
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  // Save the current fields, then open a filled sample PDF so you can see how the
  // finished, auto-filled contract will look.
  async function previewPdf() {
    setPending(true);
    const res = await saveTemplateFieldsAction({ templateId, fields: fields.map(({ key: _key, ...f }) => f) });
    setPending(false);
    if (!res.ok) return toast.error(res.error);
    window.open(`/portal/documents/templates/${templateId}/preview`, "_blank", "noopener,noreferrer");
  }

  const sel = fields.find((f) => f.key === selected) ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      {/* Canvas / Mapping */}
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-border">
            <button
              onClick={() => setView("editor")}
              className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium", view === "editor" ? "bg-foreground text-background" : "hover:bg-muted")}
            >
              <LayoutGrid className="size-4" /> Editor
            </button>
            <button
              onClick={() => setView("mapping")}
              className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium", view === "mapping" ? "bg-foreground text-background" : "hover:bg-muted")}
            >
              <ListChecks className="size-4" /> Mapping{unmappedCount > 0 ? ` (${unmappedCount})` : ""}
            </button>
          </div>
          {view === "editor" && FIELD_DEFS.map((d) => (
            <Button key={d.type} variant="outline" size="sm" onClick={() => addField(d.type)}>
              <Plus className="size-3.5" /> <d.icon className="size-3.5" /> {d.label}
            </Button>
          ))}
          {view === "editor" && pageList.length > 1 && (
            <div className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="icon" disabled={currentPage === 1} onClick={() => setCurrentPage((p) => p - 1)}>
                <ChevronLeft className="size-4" />
              </Button>
              <span className="text-xs text-muted-foreground">Page {currentPage} / {pageList.length}</span>
              <Button variant="ghost" size="icon" disabled={currentPage === pageList.length} onClick={() => setCurrentPage((p) => p + 1)}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </div>

        {view === "mapping" ? (
          <MappingOverview fields={fields} labelMap={labelMap} onPick={jumpTo} />
        ) : (
          <>
            <div
              ref={canvasRef}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              className="relative mx-auto w-full max-w-[640px] overflow-hidden rounded-lg border border-border bg-white shadow-sm"
              style={{ aspectRatio: `${PW} / ${PH}` }}
            >
              {pdfUrl ? (
                <PdfCanvas url={pdfUrl} page={currentPage} className="block w-full" />
              ) : (
                body.filter((b) => (b.page ?? 1) === currentPage).map((b, i) => (
                  <div
                    key={i}
                    className={cn("absolute text-black", b.type === "heading" && "font-display font-semibold")}
                    style={{
                      left: `${(b.x / PW) * 100}%`,
                      top: `${((PH - b.y) / PH) * 100}%`,
                      fontSize: b.type === "heading" ? "min(2.4vw,18px)" : "min(1.5vw,11px)",
                      transform: "translateY(-100%)",
                    }}
                  >
                    {b.text}
                  </div>
                ))
              )}

              {fields.filter((f) => f.page === currentPage).map((f) => {
                const bound = f.valueToken ? labelMap[f.valueToken] ?? f.valueToken : null;
                return (
                  <div
                    key={f.key}
                    onPointerDown={(e) => onPointerDown(e, f)}
                    className={cn(
                      "absolute cursor-move rounded border-2 text-[9px] font-medium flex items-center justify-center select-none touch-none",
                      selected === f.key ? "border-gold bg-gold/30" : "border-gold/60 bg-gold/15",
                      "text-gold-muted"
                    )}
                    style={{
                      left: `${(f.x / PW) * 100}%`,
                      top: `${((PH - f.y - f.height) / PH) * 100}%`,
                      width: `${(f.width / PW) * 100}%`,
                      height: `${(f.height / PH) * 100}%`,
                    }}
                  >
                    {f.label || f.type}
                    {bound && (
                      <span className="pointer-events-none absolute -top-4 left-0 flex max-w-[160px] items-center gap-0.5 truncate rounded bg-foreground px-1 py-0.5 text-[8px] font-medium text-background">
                        <Link2 className="size-2.5 shrink-0" /> {bound}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              {pdfUrl ? "Drag fields onto your PDF. " : "Drag fields to position them. "}
              Mapped fields show a → binding tag. Coordinates are saved in PDF points.
            </p>
          </>
        )}
      </div>

      {/* Inspector */}
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="truncate font-semibold">{templateName}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {fields.length} field{fields.length === 1 ? "" : "s"} · {mappedCount} auto-fill mapped
            {unmappedCount > 0 && <span className="text-amber-600"> · {unmappedCount} unmapped</span>}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={previewPdf} disabled={pending} className="flex-1" title="Save & preview the filled PDF">
              <FileDown className="size-4" /> Generate PDF
            </Button>
            <Button size="sm" onClick={save} disabled={pending} className="flex-1 bg-gold text-gold-foreground hover:bg-gold/90">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save
            </Button>
          </div>
        </div>

        {sel ? (
          <div className="space-y-3 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium capitalize">{sel.type} field</span>
              <Button variant="ghost" size="icon" onClick={() => removeField(sel.key)}>
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Label</Label>
              <Input value={sel.label} onChange={(e) => updateField(sel.key, { label: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Signer</Label>
              <Select value={sel.signerRole} onValueChange={(v) => updateField(sel.key, { signerRole: v as SignerRole })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="customer">Customer</SelectItem>
                  <SelectItem value="co_customer">Co-Customer</SelectItem>
                  <SelectItem value="company_rep">Company Rep</SelectItem>
                  <SelectItem value="witness">Witness</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isFillable(sel.type) ? (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">Map to CRM field (auto-fill)</Label>
                  <Select
                    value={sel.valueToken || "none"}
                    onValueChange={(v) => updateField(sel.key, { valueToken: v === "none" ? "" : v })}
                  >
                    <SelectTrigger className="w-full"><SelectValue placeholder="None (signer fills)" /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value="none">None (signer fills)</SelectItem>
                      {groups.map(([group, entries]) => (
                        <SelectGroup key={group}>
                          <SelectLabel>{group}</SelectLabel>
                          {entries.map((e) => (
                            <SelectItem key={e.token} value={e.token}>
                              {e.label} <span className="text-muted-foreground">· {e.sample}</span>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                  {sel.valueToken && (
                    <p className="text-[11px] text-muted-foreground">Auto-fills from <code>{sel.valueToken}</code></p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Default / fallback value</Label>
                  <Input
                    value={sel.defaultValue}
                    placeholder={sel.valueToken ? "Used if the CRM field is empty" : "Optional preset value"}
                    onChange={(e) => updateField(sel.key, { defaultValue: e.target.value })}
                  />
                </div>
              </>
            ) : (
              <p className="rounded-md bg-muted/50 px-2.5 py-2 text-[11px] text-muted-foreground">
                {sel.type === "signature" || sel.type === "initials"
                  ? "Filled by the signer at signing time — not auto-filled from the CRM."
                  : null}
              </p>
            )}

            <label className="flex items-center gap-2 pt-1 text-sm">
              <Checkbox checked={sel.required} onCheckedChange={(v) => updateField(sel.key, { required: v === true })} />
              Required
            </label>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Width</Label>
                <Input type="number" value={sel.width} onChange={(e) => updateField(sel.key, { width: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Height</Label>
                <Input type="number" value={sel.height} onChange={(e) => updateField(sel.key, { height: Number(e.target.value) })} />
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
            Add a field or select one to edit its properties and map it to a CRM field.
          </div>
        )}
      </div>
    </div>
  );
}

function MappingOverview({
  fields,
  labelMap,
  onPick,
}: {
  fields: BField[];
  labelMap: Record<string, string>;
  onPick: (f: BField) => void;
}) {
  if (fields.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        No fields placed yet. Switch to the Editor to add fields.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="grid grid-cols-[auto_1fr_1fr_1.4fr_auto] gap-2 border-b border-border bg-muted/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Pg</span><span>Type</span><span>Signer</span><span>CRM binding</span><span>Req</span>
      </div>
      <ul className="divide-y divide-border">
        {fields.map((f) => {
          const fillable = ["text", "date", "checkbox"].includes(f.type);
          const bound = f.valueToken ? labelMap[f.valueToken] ?? f.valueToken : null;
          const unmapped = fillable && !bound && !f.defaultValue;
          return (
            <li key={f.key}>
              <button
                onClick={() => onPick(f)}
                className="grid w-full grid-cols-[auto_1fr_1fr_1.4fr_auto] items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted/50"
              >
                <span className="text-xs text-muted-foreground tabular-nums">{f.page}</span>
                <span className="capitalize">{f.label || f.type}<span className="block text-[10px] text-muted-foreground">{f.type}</span></span>
                <span className="text-xs capitalize text-muted-foreground">{f.signerRole.replace(/_/g, " ")}</span>
                <span className="min-w-0 truncate text-xs">
                  {bound ? (
                    <span className="inline-flex items-center gap-1 text-foreground"><Link2 className="size-3 text-gold" /> {bound}</span>
                  ) : f.defaultValue ? (
                    <span className="text-muted-foreground">Default: {f.defaultValue}</span>
                  ) : fillable ? (
                    <span className="inline-flex items-center gap-1 text-amber-600"><AlertCircle className="size-3" /> Unmapped</span>
                  ) : (
                    <span className="text-muted-foreground">Signer fills</span>
                  )}
                </span>
                <span className={cn("text-xs", f.required ? "text-foreground" : "text-muted-foreground")}>{f.required ? "Yes" : "No"}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
