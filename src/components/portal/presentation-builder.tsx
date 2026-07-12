"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Camera, Check, ExternalLink, Eye, Share2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  requiredPhotosMet,
  DAMAGE_TYPE_ITEMS,
  ROOF_CONDITION_ITEMS,
  SECTION_LABELS,
  FINANCING_TERMS,
  financingOptions,
  type ProposalContent,
  type ProposalSectionId,
} from "@/lib/proposal";
import { uploadFileAction, deleteFileAction } from "@/server/modules/files/actions";
import { updateProposalContentAction, generateProposalAction } from "@/server/modules/proposals/actions";
import { setDealTypeAction } from "@/server/modules/leads/manage";
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
  // Photos are OPTIONAL for cash bids — a cash customer may already have their
  // own inspection and just wants a price, so we never block generating on
  // required photos for cash. (An empty photos section is hidden in the view.)
  const photosOk = data.proposal.dealType === "cash" || (checklist ? requiredPhotosMet(checklist.items, counts) : true);

  function patch(p: Partial<ProposalContent>) {
    setContent((c) => ({ ...c, ...p }));
  }

  const dealType = data.proposal.dealType;
  const isCash = dealType === "cash";

  async function switchDealType(next: "cash" | "insurance") {
    if (next === dealType) return;
    setBusy(true);
    // Persist any in-progress edits first so they survive the refresh.
    await updateProposalContentAction({ proposalId: data.proposal.id, content: content as Record<string, unknown> });
    const res = await setDealTypeAction({ leadId, dealType: next });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(next === "cash" ? "Now a cash deal" : "Now an insurance claim");
    router.refresh();
  }

  // Live out-of-pocket preview for the financing calculator. Mirrors
  // computeProposalFinancials: cash base = project price; insurance base = deductible
  // (content override, else the saved claim value) + selected upgrades − discount.
  const liveDeductibleCents = content.deductibleCents ?? data.proposal.financials.deductibleCents;
  const liveBaseCents = isCash ? Math.max(0, content.projectPriceCents || 0) : liveDeductibleCents;
  const liveUpgradesCents = (content.upgrades ?? [])
    .filter((u) => u.selected)
    .reduce((s, u) => s + Math.max(0, u.priceCents || 0), 0);
  const liveDiscountCents = Math.max(0, content.projectDiscountCents || 0);
  const liveOutOfPocketCents = Math.max(0, liveBaseCents + liveUpgradesCents - liveDiscountCents);
  const financingEnabled = content.financing?.enabled ?? false;
  const selectedTerms = content.financing?.termsMonths ?? [];

  function toggleTerm(months: number, on: boolean) {
    const next = on
      ? Array.from(new Set([...selectedTerms, months]))
      : selectedTerms.filter((m) => m !== months);
    patch({ financing: { enabled: financingEnabled, termsMonths: next } });
  }

  const fmtMoney = (cents: number) =>
    (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

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
      {/* Deal type — drives the whole proposal: cash (project price) vs insurance (claim). */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-2.5">
        <div className="text-sm">
          <span className="font-medium">Deal type:</span>{" "}
          <span className="text-muted-foreground">{isCash ? "Cash — customer pays out of pocket / financing (no insurance)." : "Insurance claim — deductible, depreciation, scope."}</span>
        </div>
        <div className="inline-flex overflow-hidden rounded-lg border border-border text-sm font-medium">
          {(["insurance", "cash"] as const).map((t) => (
            <button
              key={t}
              type="button"
              disabled={busy}
              onClick={() => switchDealType(t)}
              className={`px-3 py-1 transition-colors disabled:opacity-60 ${dealType === t ? "bg-neutral-900 text-white" : "hover:bg-muted"}`}
            >
              {t === "insurance" ? "Insurance" : "Cash"}
            </button>
          ))}
        </div>
      </div>

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
            <h3 className="font-semibold">Site / Inspection Photos{isCash ? " (optional)" : ""}</h3>
            <span
              className={`text-sm ${
                isCash ? "text-muted-foreground" : photosOk ? "text-emerald-600" : "text-amber-600"
              }`}
            >
              {isCash
                ? "Optional for cash bids"
                : photosOk
                  ? "All required photos uploaded ✓"
                  : "Required photos missing"}
            </span>
          </div>
          {isCash && (
            <p className="rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground">
              Cash bid — photos are optional. If the customer already has their own inspection and just wants a price,
              skip this step; no inspection or empty photo section will appear on the presentation.
            </p>
          )}
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
          {isCash ? (
            <Field label="Project price ($)">
              <Input
                key="cash-price"
                inputMode="decimal"
                defaultValue={content.projectPriceCents != null ? String(content.projectPriceCents / 100) : ""}
                placeholder="e.g. 18000"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  patch({ projectPriceCents: v === "" ? undefined : Math.round((Number(v) || 0) * 100) });
                }}
              />
              <p className="text-xs text-muted-foreground">The total cash price the customer pays. Their total = project price + upgrades − discount (optionally financed).</p>
            </Field>
          ) : (
            <Field label="Deductible ($)">
              <Input
                key="ins-deductible"
                inputMode="decimal"
                defaultValue={content.deductibleCents != null ? String(content.deductibleCents / 100) : ""}
                placeholder="e.g. 2500"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  patch({ deductibleCents: v === "" ? undefined : Math.round((Number(v) || 0) * 100) });
                }}
              />
              <p className="text-xs text-muted-foreground">Customer&rsquo;s out-of-pocket deductible. Leave blank to use the claim&rsquo;s deductible.</p>
            </Field>
          )}
          <Field label="Project discount ($)">
            <Input
              inputMode="decimal"
              defaultValue={content.projectDiscountCents != null ? String(content.projectDiscountCents / 100) : ""}
              placeholder="e.g. 2000"
              onBlur={(e) => {
                const v = e.target.value.trim();
                patch({ projectDiscountCents: v === "" ? undefined : Math.round((Number(v) || 0) * 100) });
              }}
            />
            <p className="text-xs text-muted-foreground">
              {isCash
                ? "A discount on the cash price — lowers the customer's total."
                : "A general discount on the project — lowers the customer's out-of-pocket. This is not a deductible rebate; the deductible is still shown in full (Texas law prohibits waiving or rebating it)."}
            </p>
          </Field>
          <Field label="Damage summary">
            <textarea className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm" defaultValue={content.damageSummary ?? ""} placeholder="Hail and wind damage on the north and west slopes…" onBlur={(e) => patch({ damageSummary: e.target.value })} />
          </Field>
          <Field label="Recommended next step"><Input defaultValue={content.recommendedNextStep ?? ""} placeholder="Schedule the adjuster meeting" onBlur={(e) => patch({ recommendedNextStep: e.target.value })} /></Field>
          <Field label="Roof condition explanation">
            <textarea className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm" defaultValue={content.conditionNarrative ?? ""} placeholder="Explain hail/wind damage in plain language…" onBlur={(e) => patch({ conditionNarrative: e.target.value })} />
          </Field>
          <Field label="Damage type">
            <div className="grid grid-cols-2 gap-2">
              {DAMAGE_TYPE_ITEMS.map((i) => {
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
          {/* FINANCING — optional 0% monthly options on the out-of-pocket */}
          <div className="space-y-3 rounded-lg border border-border p-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={financingEnabled}
                onChange={(e) =>
                  patch({
                    financing: {
                      enabled: e.target.checked,
                      termsMonths: selectedTerms.length > 0 ? selectedTerms : [...FINANCING_TERMS],
                    },
                  })
                }
              />
              Offer 0% financing on the out-of-pocket
            </label>
            <p className="text-xs text-muted-foreground">
              Optional. Splits the {fmtMoney(liveOutOfPocketCents)} out-of-pocket into interest-free monthly payments
              (max 60 months). Pick the terms to show the customer.
            </p>
            {financingEnabled && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {FINANCING_TERMS.map((m) => {
                    const on = selectedTerms.includes(m);
                    const [opt] = financingOptions(liveOutOfPocketCents, [m]);
                    return (
                      <label
                        key={m}
                        className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${on ? "border-[#F4631E] bg-[#F4631E]/5" : "border-border"}`}
                      >
                        <span className="flex items-center gap-2">
                          <input type="checkbox" checked={on} onChange={(e) => toggleTerm(m, e.target.checked)} />
                          {m} mo
                        </span>
                        <span className="font-medium tabular-nums">{fmtMoney(opt.monthlyCents)}/mo</span>
                      </label>
                    );
                  })}
                </div>
                {selectedTerms.length === 0 && (
                  <p className="text-xs text-amber-600">Select at least one term, or the financing section won&rsquo;t show.</p>
                )}
              </div>
            )}
          </div>
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
