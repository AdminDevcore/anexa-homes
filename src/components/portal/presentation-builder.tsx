"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Camera, Check, ExternalLink, Eye, Share2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  requiredPhotosMet,
  ROOF_CONDITION_ITEMS,
  SECTION_LABELS,
  type ProposalContent,
  type ProposalSectionId,
} from "@/lib/proposal";
import { uploadFileAction, deleteFileAction } from "@/server/modules/files/actions";
import { updateProposalContentAction, generateProposalAction } from "@/server/modules/proposals/actions";
import type { ProposalBuilderData } from "@/server/modules/proposals/queries";
import { PresentationView } from "@/components/proposal/presentation-view";

type Step = "photos" | "details" | "upgrades" | "sections" | "share";

const STEPS: { id: Step; label: string }[] = [
  { id: "photos", label: "1 · Photos" },
  { id: "details", label: "2 · Details" },
  { id: "upgrades", label: "3 · Upgrades" },
  { id: "sections", label: "4 · Sections" },
  { id: "share", label: "5 · Preview & Share" },
];

export function PresentationBuilder({ data, leadId }: { data: ProposalBuilderData; leadId: string }) {
  const router = useRouter();
  const [step, setStep] = React.useState<Step>("photos");
  const [busy, setBusy] = React.useState(false);
  const [preview, setPreview] = React.useState(false);
  const [content, setContent] = React.useState<ProposalContent>(data.proposal.content);
  const [shareToken, setShareToken] = React.useState<string | null>(
    data.proposal.status !== "draft" ? data.proposal.token : null,
  );

  const checklist = data.checklist;
  const counts: Record<string, number> = {};
  for (const it of checklist?.items ?? []) counts[it.id] = it.count;
  const photosOk = checklist ? requiredPhotosMet(checklist.items, counts) : true;

  function patch(p: Partial<ProposalContent>) {
    setContent((c) => ({ ...c, ...p }));
  }

  async function save(): Promise<boolean> {
    setBusy(true);
    const res = await updateProposalContentAction({ proposalId: data.proposal.id, content: content as Record<string, unknown> });
    setBusy(false);
    if (!res.ok) { toast.error(res.error); return false; }
    return true;
  }

  async function saveAndRefresh() {
    if (await save()) { toast.success("Saved"); router.refresh(); }
  }

  async function onFiles(itemId: string, label: string, files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    let failed = 0;
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("leadId", leadId);
      fd.set("photoTemplateItemId", itemId);
      fd.set("category", label);
      const res = await uploadFileAction(fd);
      if (!res.ok) failed += 1;
    }
    setBusy(false);
    if (failed) toast.error(`${failed} photo(s) failed.`);
    else toast.success("Photo added");
    router.refresh();
  }

  async function deletePhoto(id: string) {
    if (!confirm("Delete this photo? This can't be undone.")) return;
    setBusy(true);
    const res = await deleteFileAction(id);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Photo deleted");
    router.refresh();
  }

  async function generate() {
    if (!(await save())) return;
    setBusy(true);
    const res = await generateProposalAction(data.proposal.id);
    setBusy(false);
    if (!res.ok) { toast.error(res.error); return; }
    setShareToken(res.token);
    toast.success("Presentation generated");
    router.refresh();
  }

  const shareUrl = shareToken ? `${typeof window !== "undefined" ? window.location.origin : ""}/present/${shareToken}` : null;

  if (preview) {
    return (
      <div>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-4 py-2">
          <span className="text-sm font-medium text-muted-foreground">Preview (customer view)</span>
          <Button size="sm" variant="outline" onClick={() => setPreview(false)}>Back to builder</Button>
        </div>
        <PresentationView data={{ ...data.proposal, content }} mode="preview" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Step nav */}
      <div className="flex flex-wrap gap-2">
        {STEPS.map((s) => (
          <button
            key={s.id}
            onClick={() => setStep(s.id)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${step === s.id ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* PHOTOS */}
      {step === "photos" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Site / Inspection Photos</h3>
            <span className={`text-sm ${photosOk ? "text-emerald-600" : "text-amber-600"}`}>
              {photosOk ? "All required photos uploaded ✓" : "Required photos missing"}
            </span>
          </div>
          {!checklist && <p className="text-sm text-muted-foreground">No site photo template configured. Add one in Settings → Photo templates.</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {checklist?.items.map((it) => {
              const has = (counts[it.id] ?? 0) > 0;
              return (
                <label
                  key={it.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${it.required && !has ? "border-amber-300 bg-amber-50" : has ? "border-emerald-200 bg-emerald-50/40" : "border-border"}`}
                >
                  <span className={`flex size-9 shrink-0 items-center justify-center rounded-full ${has ? "bg-emerald-500 text-white" : "bg-neutral-200 text-neutral-500"}`}>
                    {has ? <Check className="size-4" /> : <Camera className="size-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{it.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {it.required ? "Required" : "Optional"}{has ? ` · ${counts[it.id]} photo(s)` : ""}
                    </span>
                  </span>
                  <input type="file" accept="image/*" capture="environment" multiple className="hidden" disabled={busy} onChange={(e) => onFiles(it.id, it.label, e.target.files)} />
                </label>
              );
            })}
          </div>
          {/* Uploaded photos — caption or delete each */}
          {data.proposal.photoGroups.length > 0 && (
            <div className="space-y-2 pt-2">
              <h4 className="text-sm font-medium">Uploaded photos</h4>
              <p className="text-xs text-muted-foreground">Add a caption, or delete a photo to replace it (re-upload from its tile above).</p>
              {data.proposal.photoGroups.flatMap((g) => g.photos).map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" className="size-12 shrink-0 rounded object-cover" />
                  <Input
                    defaultValue={content.photoCaptions?.[p.id] ?? ""}
                    placeholder={`Caption for ${p.category}`}
                    onBlur={(e) => patch({ photoCaptions: { ...(content.photoCaptions ?? {}), [p.id]: e.target.value } })}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => deletePhoto(p.id)}
                    aria-label="Delete photo"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={() => setStep("details")}>Next: Details</Button>
          </div>
        </div>
      )}

      {/* DETAILS */}
      {step === "details" && (
        <div className="space-y-4">
          <Field label="Roof type"><Input defaultValue={content.roofType ?? ""} placeholder="e.g. Asphalt shingle" onBlur={(e) => patch({ roofType: e.target.value })} /></Field>
          <Field label="Damage summary">
            <textarea className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm" defaultValue={content.damageSummary ?? ""} placeholder="Hail and wind damage on the north and west slopes…" onBlur={(e) => patch({ damageSummary: e.target.value })} />
          </Field>
          <Field label="Recommended next step"><Input defaultValue={content.recommendedNextStep ?? ""} placeholder="Schedule the adjuster meeting" onBlur={(e) => patch({ recommendedNextStep: e.target.value })} /></Field>
          <Field label="Roof condition explanation">
            <textarea className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm" defaultValue={content.conditionNarrative ?? ""} placeholder="Explain hail/wind damage in plain language…" onBlur={(e) => patch({ conditionNarrative: e.target.value })} />
          </Field>
          <Field label="Affected areas">
            <div className="grid grid-cols-2 gap-2">
              {ROOF_CONDITION_ITEMS.map((i) => {
                const on = content.conditionFlags?.[i.key] ?? false;
                return (
                  <label key={i.key} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={on} onChange={(e) => patch({ conditionFlags: { ...(content.conditionFlags ?? {}), [i.key]: e.target.checked } })} />
                    {i.label}
                  </label>
                );
              })}
            </div>
          </Field>
          <div className="flex justify-between"><Button variant="outline" onClick={saveAndRefresh} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} Save</Button><Button onClick={() => setStep("upgrades")}>Next: Upgrades</Button></div>
        </div>
      )}

      {/* UPGRADES */}
      {step === "upgrades" && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Check the upgrades to recommend; add a price to include it in the customer&rsquo;s out-of-pocket.</p>
          {(content.upgrades ?? []).map((u, idx) => (
            <div key={u.label} className="flex items-center gap-3 rounded-lg border border-border p-3">
              <input type="checkbox" checked={u.selected} onChange={(e) => { const next = [...(content.upgrades ?? [])]; next[idx] = { ...u, selected: e.target.checked }; patch({ upgrades: next }); }} />
              <span className="flex-1 text-sm font-medium">{u.label}</span>
              <div className="flex items-center gap-1">
                <span className="text-sm text-muted-foreground">$</span>
                <Input className="w-28" inputMode="decimal" defaultValue={u.priceCents ? String(u.priceCents / 100) : ""} placeholder="0" onBlur={(e) => { const next = [...(content.upgrades ?? [])]; next[idx] = { ...u, priceCents: Math.round((Number(e.target.value) || 0) * 100) }; patch({ upgrades: next }); }} />
              </div>
            </div>
          ))}
          <div className="flex justify-between"><Button variant="outline" onClick={saveAndRefresh} disabled={busy}>Save</Button><Button onClick={() => setStep("sections")}>Next: Sections</Button></div>
        </div>
      )}

      {/* SECTIONS */}
      {step === "sections" && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Toggle the sections that appear in the presentation.</p>
          {(content.selectedSections ?? []).map((s, idx) => (
            <label key={s.id} className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm">
              <input type="checkbox" checked={s.enabled} disabled={s.id === "cover"} onChange={(e) => { const next = [...(content.selectedSections ?? [])]; next[idx] = { ...s, enabled: e.target.checked }; patch({ selectedSections: next }); }} />
              <span className="font-medium">{SECTION_LABELS[s.id as ProposalSectionId] ?? s.id}</span>
              {s.id === "cover" && <span className="text-xs text-muted-foreground">(always shown)</span>}
            </label>
          ))}
          <div className="flex justify-between"><Button variant="outline" onClick={saveAndRefresh} disabled={busy}>Save</Button><Button onClick={() => setStep("share")}>Next: Preview &amp; Share</Button></div>
        </div>
      )}

      {/* SHARE */}
      {step === "share" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={async () => { if (await save()) setPreview(true); }}><Eye className="size-4" /> Preview</Button>
            <Button onClick={generate} disabled={busy || !photosOk} title={!photosOk ? "Upload all required photos first" : undefined} className="bg-[#F4631E] text-white hover:bg-[#F4631E]/90">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Share2 className="size-4" />} {shareToken ? "Re-generate" : "Generate presentation"}
            </Button>
          </div>
          {!photosOk && <p className="text-sm text-amber-600">Upload all required photos in step 1 before generating.</p>}
          {shareUrl && (
            <div className="rounded-lg border border-border p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Shareable customer link</p>
              <div className="mt-2 flex items-center gap-2">
                <Input readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} />
                <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(shareUrl); toast.success("Link copied"); }}>Copy</Button>
                <a href={shareUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-[#F4631E]"><ExternalLink className="size-4" /> Open</a>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}
