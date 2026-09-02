"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2, Plus, Trash2, Save, PenLine, Type, Calendar, CheckSquare,
  ChevronLeft, ChevronRight, LayoutGrid, ListChecks, Link2, AlertCircle, FileDown,
  ArrowLeft, ArrowRight, Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  saveTemplateFieldsAction,
  addTemplateDocumentAction,
  renameTemplateDocumentAction,
  deleteTemplateDocumentAction,
  reorderTemplateDocumentsAction,
} from "@/server/modules/esign/actions";
import type { CatalogEntry } from "@/server/modules/esign/autofill";
import { PdfCanvas } from "./pdf-canvas";
import { TemplatePdfUploader } from "./template-pdf-uploader";

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
  /** The PDF in the bundle this field sits on. "" = the template's own PDF. */
  documentId: string;
};

/**
 * One PDF in the template's bundle. A template that has never had a second
 * document added still gets exactly one slot here, with an empty id — that is
 * the template's own `sourcePdfKey`, and it is what every existing template
 * looks like.
 */
export type DocumentSlot = {
  id: string;
  name: string;
  order: number;
  pages: { width: number; height: number }[];
  pdfUrl?: string;
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

/**
 * Whether leaving this field unmapped would actually print a blank.
 *
 * The company's own date field would not: the send stamps the day the company
 * signature was applied. Counting it as unmapped would warn about the one thing
 * authorised signers exist to fix, and a warning that cannot be cleared is a
 * warning everybody learns to ignore.
 *
 * Signature and initials were never counted — they are not FILLABLE — so the
 * company's marks need no special case here.
 */
const needsMapping = (f: { type: FieldType; signerRole: SignerRole }) =>
  isFillable(f.type) && !(f.signerRole === "company_rep" && f.type === "date");

/** How each role reads in the mapping table. "company rep" said nothing useful. */
const ROLE_LABEL: Record<SignerRole, string> = {
  customer: "Customer",
  co_customer: "Co-Owner",
  company_rep: "Company",
  witness: "Witness",
};

export function TemplateBuilder({
  templateId,
  templateName,
  body,
  initialFields,
  documents,
  catalog,
}: {
  templateId: string;
  templateName: string;
  body: { page: number; type: string; text: string; x: number; y: number }[];
  initialFields: Omit<BField, "key">[];
  /** The bundle, in order. Always at least one entry. */
  documents: DocumentSlot[];
  catalog: CatalogEntry[];
}) {
  const router = useRouter();
  const canvasRef = React.useRef<HTMLDivElement | null>(null);
  const [fields, setFields] = React.useState<BField[]>(
    initialFields.map((f, i) => ({ ...f, key: `f${i}` }))
  );
  const [selected, setSelected] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [docPending, setDocPending] = React.useState(false);
  // Page position is remembered PER DOCUMENT: switching tabs must not carry you
  // to page 7 of a two-page warranty, and coming back should land where you left.
  const [pageByDoc, setPageByDoc] = React.useState<Record<string, number>>({});
  const [view, setView] = React.useState<"editor" | "mapping">("editor");
  const [activeDocId, setActiveDocId] = React.useState(documents[0]?.id ?? "");
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const [renameText, setRenameText] = React.useState("");
  const drag = React.useRef<{ key: string; startX: number; startY: number; origX: number; origY: number } | null>(null);

  const multiDoc = documents.length > 1;
  const firstDocId = documents[0]?.id ?? "";
  // A field written before its template gained a second document has no
  // documentId; it belongs to what is now document 1.
  const docIdOf = React.useCallback((f: BField) => f.documentId || firstDocId, [firstDocId]);

  const activeDoc = documents.find((d) => d.id === activeDocId) ?? documents[0];
  // A freshly added document has no PDF yet, so fall back to a blank US Letter
  // page — fields can still be placed and the upload replaces the artwork.
  const pageList = activeDoc?.pages?.length ? activeDoc.pages : [{ width: 612, height: 792 }];
  const pdfUrl = activeDoc?.pdfUrl;
  const currentPage = Math.min(pageByDoc[activeDocId] ?? 1, pageList.length);
  const cur = pageList[currentPage - 1] ?? pageList[0];
  const PW = cur.width;
  const PH = cur.height;

  const goToPage = (docId: string, page: number) => setPageByDoc((s) => ({ ...s, [docId]: page }));

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

  // Counts and the canvas are per document — the mapping table stays whole, so
  // an unmapped field on document 2 is still visible from document 1.
  const docFields = fields.filter((f) => docIdOf(f) === activeDocId);
  const fillable = fields.filter(needsMapping);
  const mappedCount = fillable.filter((f) => f.valueToken).length;
  const unmappedCount = fillable.length - mappedCount;

  function addField(type: FieldType) {
    const def = FIELD_DEFS.find((d) => d.type === type)!;
    const key = `f${Date.now()}`;
    setFields((s) => [
      ...s,
      { key, page: currentPage, x: 60, y: PH - 200, width: def.w, height: def.h, type, signerRole: "customer", label: def.label, valueToken: "", defaultValue: "", required: true, documentId: activeDocId },
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
    setActiveDocId(docIdOf(f));
    goToPage(docIdOf(f), f.page);
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

  // "" is the legacy single-PDF slot, which the column stores as NULL. A field
  // placed BEFORE the template was split still carries "" in state, and the
  // canvas has been showing it on document 1 — so that is what gets written,
  // rather than an unassigned field the envelope would have nowhere to put.
  const payload = () =>
    fields.map(({ key: _key, documentId, ...f }) => ({ ...f, documentId: documentId || firstDocId || null }));

  async function save() {
    setPending(true);
    const res = await saveTemplateFieldsAction({ templateId, fields: payload() });
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
    const res = await saveTemplateFieldsAction({ templateId, fields: payload() });
    setPending(false);
    if (!res.ok) return toast.error(res.error);
    window.open(`/portal/documents/templates/${templateId}/preview`, "_blank", "noopener,noreferrer");
  }

  /**
   * Add a PDF to the bundle.
   *
   * Fields are saved FIRST. The server materialises a legacy template's PDF as
   * document 1 and adopts its NULL-documentId fields; anything unsaved on the
   * canvas would be wiped by the refresh that follows, so it has to be on disk
   * before that happens.
   */
  async function addDocument() {
    setDocPending(true);
    const saved = await saveTemplateFieldsAction({ templateId, fields: payload() });
    if (!saved.ok) {
      setDocPending(false);
      return toast.error(saved.error);
    }
    const res = await addTemplateDocumentAction({ templateId });
    setDocPending(false);
    if (!res.ok) return toast.error(res.error);
    setActiveDocId(res.id);
    toast.success("Document added — upload its PDF");
    router.refresh();
  }

  async function commitRename(docId: string) {
    const name = renameText.trim();
    const current = documents.find((d) => d.id === docId)?.name;
    setRenaming(null);
    if (!name || name === current) return;
    const res = await renameTemplateDocumentAction({ documentId: docId, name });
    if (!res.ok) return toast.error(res.error);
    router.refresh();
  }

  async function removeDocument(docId: string) {
    const doc = documents.find((d) => d.id === docId);
    if (!confirm(`Delete "${doc?.name ?? "this document"}"? The fields placed on it are deleted too.`)) return;
    setDocPending(true);
    // Drop its fields locally first, so the save that follows a refresh cannot
    // resurrect them against a document that no longer exists.
    const kept = fields.filter((f) => docIdOf(f) !== docId);
    const res = await deleteTemplateDocumentAction({ documentId: docId });
    setDocPending(false);
    if (!res.ok) return toast.error(res.error);
    setFields(kept);
    if (docId === activeDocId) setActiveDocId(documents.find((d) => d.id !== docId)?.id ?? "");
    toast.success("Document deleted");
    router.refresh();
  }

  async function moveDocument(docId: string, delta: -1 | 1) {
    const idx = documents.findIndex((d) => d.id === docId);
    const to = idx + delta;
    if (idx < 0 || to < 0 || to >= documents.length) return;
    const ids = documents.map((d) => d.id);
    [ids[idx], ids[to]] = [ids[to], ids[idx]];
    setDocPending(true);
    const res = await reorderTemplateDocumentsAction({ templateId, orderedIds: ids });
    setDocPending(false);
    if (!res.ok) return toast.error(res.error);
    router.refresh();
  }

  const sel = fields.find((f) => f.key === selected) ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      {/* Canvas / Mapping */}
      <div>
        {/* The bundle. One send, one signing link, one signed PDF — the tabs
            choose which of its documents you are placing fields on. */}
        <div className="mb-3 overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center gap-1 border-b border-border bg-muted/30 px-2 py-2">
            {documents.map((d, i) => {
              const count = fields.filter((f) => docIdOf(f) === d.id).length;
              const active = d.id === activeDocId;
              return renaming === d.id ? (
                <Input
                  key={d.id}
                  autoFocus
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  onBlur={() => commitRename(d.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  className="h-8 w-44"
                />
              ) : (
                <button
                  key={d.id}
                  onClick={() => setActiveDocId(d.id)}
                  onDoubleClick={() => {
                    // Renaming needs a document row; the legacy slot has none.
                    if (!d.id) return;
                    setRenameText(d.name);
                    setRenaming(d.id);
                  }}
                  title={d.id ? "Double-click to rename" : undefined}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                    active ? "bg-foreground text-background" : "hover:bg-muted"
                  )}
                >
                  <span className={cn("text-[10px] tabular-nums", active ? "opacity-70" : "text-muted-foreground")}>
                    {i + 1}
                  </span>
                  <span className="max-w-[180px] truncate">{d.name}</span>
                  {!d.pages?.length && (
                    <span className={cn("text-[10px]", active ? "opacity-70" : "text-amber-600")}>no PDF</span>
                  )}
                  {count > 0 && (
                    <span className={cn("text-[10px] tabular-nums", active ? "opacity-70" : "text-muted-foreground")}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
            <Button variant="outline" size="sm" className="ml-1" onClick={addDocument} disabled={docPending || pending}>
              {docPending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Add document
            </Button>
            {multiDoc && activeDoc?.id && (
              <div className="ml-auto flex items-center gap-1">
                <Button variant="ghost" size="icon" title="Move earlier" disabled={docPending || documents[0]?.id === activeDoc.id} onClick={() => moveDocument(activeDoc.id, -1)}>
                  <ArrowLeft className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" title="Move later" disabled={docPending || documents[documents.length - 1]?.id === activeDoc.id} onClick={() => moveDocument(activeDoc.id, 1)}>
                  <ArrowRight className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" title="Rename" disabled={docPending} onClick={() => { setRenameText(activeDoc.name); setRenaming(activeDoc.id); }}>
                  <Pencil className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" title="Delete document" disabled={docPending} onClick={() => removeDocument(activeDoc.id)}>
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            )}
          </div>
          <div className="p-3">
            <TemplatePdfUploader
              templateId={templateId}
              documentId={activeDoc?.id || undefined}
              hasPdf={!!pdfUrl}
            />
            {multiDoc && (
              <p className="mt-2 px-1 text-xs text-muted-foreground">
                These {documents.length} documents go out as <strong>one envelope</strong> — one signing link, and one
                signed PDF filed on the deal, in the order shown above.
              </p>
            )}
          </div>
        </div>

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
              <Button variant="ghost" size="icon" disabled={currentPage === 1} onClick={() => goToPage(activeDocId, currentPage - 1)}>
                <ChevronLeft className="size-4" />
              </Button>
              <span className="text-xs text-muted-foreground">Page {currentPage} / {pageList.length}</span>
              <Button variant="ghost" size="icon" disabled={currentPage === pageList.length} onClick={() => goToPage(activeDocId, currentPage + 1)}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </div>

        {unmappedCount > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            <AlertCircle className="size-4 shrink-0" />
            <span>
              <strong>{unmappedCount}</strong> of {fillable.length} fillable field{fillable.length === 1 ? "" : "s"} {unmappedCount === 1 ? "isn't" : "aren't"} mapped to CRM data — {unmappedCount === 1 ? "it" : "they"} will print <strong>blank</strong> unless the signer fills {unmappedCount === 1 ? "it" : "them"} in.
            </span>
            <button
              onClick={() => setView("mapping")}
              className="ml-auto inline-flex items-center gap-1 rounded-md border border-amber-400 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
            >
              <ListChecks className="size-3.5" /> Map fields
            </button>
          </div>
        )}

        {view === "mapping" ? (
          <MappingOverview
            fields={fields}
            labelMap={labelMap}
            onPick={jumpTo}
            docNames={multiDoc ? Object.fromEntries(documents.map((d, i) => [d.id, `${i + 1}. ${d.name}`])) : null}
            docIdOf={docIdOf}
          />
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
                (activeDocId === firstDocId ? body : []).filter((b) => (b.page ?? 1) === currentPage).map((b, i) => (
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

              {docFields.filter((f) => f.page === currentPage).map((f) => {
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
                  <SelectItem value="co_customer">Co-Owner</SelectItem>
                  <SelectItem value="company_rep">Company (auto-signed)</SelectItem>
                  <SelectItem value="witness">Witness</SelectItem>
                </SelectContent>
              </Select>
              {sel.signerRole === "company_rep" && (
                <p className="text-xs text-muted-foreground">
                  Filled automatically when the document is sent, from the authorised signer in
                  Settings. Nobody is emailed a link for this one.
                </p>
              )}
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
  docNames,
  docIdOf,
}: {
  fields: BField[];
  labelMap: Record<string, string>;
  onPick: (f: BField) => void;
  /** Null for a single-PDF template — there is nothing to disambiguate. */
  docNames: Record<string, string> | null;
  docIdOf: (f: BField) => string;
}) {
  if (fields.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        No fields placed yet. Switch to the Editor to add fields.
      </div>
    );
  }
  const cols = docNames
    ? "grid-cols-[1fr_auto_1fr_1fr_1.4fr_auto]"
    : "grid-cols-[auto_1fr_1fr_1.4fr_auto]";
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className={cn("grid gap-2 border-b border-border bg-muted/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground", cols)}>
        {docNames && <span>Document</span>}
        <span>Pg</span><span>Type</span><span>Signer</span><span>CRM binding</span><span>Req</span>
      </div>
      <ul className="divide-y divide-border">
        {fields.map((f) => {
          const bound = f.valueToken ? labelMap[f.valueToken] ?? f.valueToken : null;
          const unmapped = needsMapping(f) && !bound && !f.defaultValue;
          return (
            <li key={f.key}>
              <button
                onClick={() => onPick(f)}
                className={cn("grid w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted/50", cols)}
              >
                {docNames && (
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    {docNames[docIdOf(f)] ?? "—"}
                  </span>
                )}
                <span className="text-xs text-muted-foreground tabular-nums">{f.page}</span>
                <span className="capitalize">{f.label || f.type}<span className="block text-[10px] text-muted-foreground">{f.type}</span></span>
                <span className="text-xs text-muted-foreground">{ROLE_LABEL[f.signerRole]}</span>
                <span className="min-w-0 truncate text-xs">
                  {bound ? (
                    <span className="inline-flex items-center gap-1 text-foreground"><Link2 className="size-3 text-gold" /> {bound}</span>
                  ) : f.defaultValue ? (
                    <span className="text-muted-foreground">Default: {f.defaultValue}</span>
                  ) : unmapped ? (
                    <span className="inline-flex items-center gap-1 text-amber-600"><AlertCircle className="size-3" /> Unmapped</span>
                  ) : f.signerRole === "company_rep" ? (
                    // Not "Signer fills": nobody fills it. The company's mark
                    // and the date it was applied are stamped at send.
                    <span className="text-muted-foreground">Auto-signed</span>
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
