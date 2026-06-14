import * as React from "react";
import { formatScopeCents } from "@/lib/scope";
import {
  roofingTimeline,
  ROOF_CONDITION_ITEMS,
  defaultFaq,
  defaultWhyAnexa,
  type ProposalSectionId,
} from "@/lib/proposal";
import type { ProposalView } from "@/server/modules/proposals/queries";
import { NextStepActions } from "./next-step-actions";
import { ProposalChrome, type ChromeNavItem } from "./proposal-chrome";

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function Section({ id, title, eyebrow, children }: { id: string; title?: string; eyebrow?: string; children: React.ReactNode }) {
  return (
    <section data-section={id} data-reveal className="break-inside-avoid border-b border-neutral-100 px-6 py-14 sm:px-10 print:py-8">
      <div className="mx-auto w-full max-w-3xl">
        {eyebrow && <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-[var(--proposal-accent)]">{eyebrow}</p>}
        {title && <h2 className="mb-6 font-serif text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl">{title}</h2>}
        {children}
      </div>
    </section>
  );
}

function Money({ cents }: { cents: number }) {
  return <span className="tabular-nums">{formatScopeCents(cents)}</span>;
}

export function PresentationView({ data, mode }: { data: ProposalView; mode: "public" | "preview" }) {
  const c = data.content;
  const sections = (c.selectedSections && c.selectedSections.length > 0
    ? [...c.selectedSections].sort((a, b) => a.order - b.order)
    : []
  ).filter((s) => s.enabled);
  const enabled = (id: ProposalSectionId) =>
    sections.length === 0 ? true : sections.some((s) => s.id === id);

  const faq = c.faq && c.faq.length > 0 ? c.faq : defaultFaq();
  const why = c.whyAnexa && c.whyAnexa.length > 0 ? c.whyAnexa : defaultWhyAnexa();
  const conditionFlags = c.conditionFlags ?? {};
  const activeConditions = ROOF_CONDITION_ITEMS.filter((i) => conditionFlags[i.key]);
  const upgrades = (c.upgrades ?? []).filter((u) => u.selected);
  const fin = data.financials;

  // Wayfinding: one nav entry per section that actually renders (skip cover).
  const navItems: ChromeNavItem[] = (
    [
      ["overview", "Overview", enabled("overview")],
      ["photos", "Photos", enabled("photos") && data.photoGroups.length > 0],
      ["condition", "Damage", enabled("condition") && (activeConditions.length > 0 || !!c.conditionNarrative)],
      ["scope", "Scope", enabled("scope") && data.scopeLines.length > 0],
      ["upgrades", "Upgrades", enabled("upgrades") && upgrades.length > 0],
      ["timeline", "Timeline", enabled("timeline")],
      ["financial", "Your cost", enabled("financial")],
      ["why", "Why us", enabled("why")],
      ["faq", "FAQ", enabled("faq")],
      ["signature", "Sign", enabled("signature")],
    ] as [string, string, boolean][]
  )
    .filter(([, , show]) => show)
    .map(([id, label]) => ({ id, label }));

  return (
    <div
      id="proposal-root"
      className="min-h-screen bg-white text-neutral-900"
      style={{ ["--proposal-accent" as string]: data.branding.accentColor || "#F4631E" }}
    >
      <ProposalChrome
        companyName={data.branding.companyName}
        logoUrl={data.branding.logoUrl}
        navItems={navItems}
        hasSignature={enabled("signature")}
      />
      {/* COVER */}
      {enabled("cover") && (
        <section data-section="cover" className="relative flex min-h-screen flex-col justify-end overflow-hidden bg-neutral-950 px-6 py-12 text-white sm:px-10 print:min-h-0 print:py-16">
          {data.heroPhotoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.heroPhotoUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-50" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/70 to-neutral-950/20" />
          <div className="reveal-up relative mx-auto w-full max-w-3xl">
            {data.branding.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.branding.logoUrl} alt={data.branding.companyName} className="mb-8 h-10 w-auto object-contain" />
            ) : (
              <p className="mb-8 font-serif text-2xl font-bold">{data.branding.companyName}</p>
            )}
            <p className="text-sm font-semibold uppercase tracking-widest text-[var(--proposal-accent)]">{data.projectType}</p>
            <h1 className="mt-3 font-serif text-4xl font-bold leading-tight sm:text-6xl">Your Roofing Proposal</h1>
            <div className="mt-6 space-y-1 text-lg text-neutral-200">
              <p className="text-2xl font-semibold text-white">{data.customerName}</p>
              <p>{data.propertyAddress}</p>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-8 gap-y-2 text-sm text-neutral-300">
              {data.repName && <span>Prepared by <strong className="text-white">{data.repName}</strong></span>}
              <span>{fmtDate(data.createdAt)}</span>
            </div>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center print:hidden">
            <span className="flex flex-col items-center gap-1 text-[11px] uppercase tracking-widest text-neutral-400">
              Scroll
              <svg className="size-4 animate-bounce" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
        </section>
      )}

      {/* PROJECT OVERVIEW */}
      {enabled("overview") && (
        <Section id="overview" eyebrow="Project Overview" title="Where things stand">
          <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
            {[
              ["Claim status", data.claim.status],
              ["Insurance carrier", data.claim.carrier],
              ["Claim number", data.claim.claimNumber],
              ["Date of loss", data.claim.lossDate ? fmtDate(data.claim.lossDate) : null],
              ["Roof type", data.claim.roofType],
            ].filter(([, v]) => v).map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-xs font-semibold uppercase tracking-wide text-neutral-400">{k}</dt>
                <dd className="mt-1 text-lg font-medium capitalize text-neutral-900">{String(v).replace(/_/g, " ")}</dd>
              </div>
            ))}
          </dl>
          {c.damageSummary && (
            <div className="mt-8">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Damage summary</p>
              <p className="mt-2 text-neutral-700">{c.damageSummary}</p>
            </div>
          )}
          {c.recommendedNextStep && (
            <div className="mt-6 rounded-xl bg-neutral-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--proposal-accent)]">Recommended next step</p>
              <p className="mt-1 font-medium text-neutral-900">{c.recommendedNextStep}</p>
            </div>
          )}
        </Section>
      )}

      {/* INSPECTION PHOTOS */}
      {enabled("photos") && data.photoGroups.length > 0 && (
        <Section id="photos" eyebrow="Inspection Photos" title="What we documented">
          <div className="space-y-10">
            {data.photoGroups.map((g) => (
              <div key={g.category}>
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">{g.category}</h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {g.photos.map((p) => (
                    <figure key={p.id} className="break-inside-avoid overflow-hidden rounded-lg border border-neutral-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt={p.caption || g.category} className="aspect-[4/3] w-full object-cover" />
                      {p.caption && <figcaption className="bg-white px-2 py-1.5 text-xs text-neutral-600">{p.caption}</figcaption>}
                    </figure>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ROOF CONDITION SUMMARY */}
      {enabled("condition") && (activeConditions.length > 0 || c.conditionNarrative) && (
        <Section id="condition" eyebrow="Roof Condition" title="What storm damage looks like">
          {c.conditionNarrative && <p className="mb-6 text-neutral-700">{c.conditionNarrative}</p>}
          {activeConditions.length > 0 && (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {activeConditions.map((i) => (
                <li key={i.key} className="flex items-center gap-3 rounded-lg border border-neutral-200 px-4 py-3">
                  <span className="flex size-6 items-center justify-center rounded-full bg-[var(--proposal-accent)] text-xs font-bold text-white">✓</span>
                  <span className="font-medium text-neutral-800">{i.label}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {/* SCOPE OF WORK */}
      {enabled("scope") && data.scopeLines.length > 0 && (
        <Section id="scope" eyebrow="Scope of Work" title="The work your claim covers">
          <div className="overflow-hidden rounded-xl border border-neutral-200">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Item</th>
                  <th className="px-4 py-3 text-right font-semibold">Qty</th>
                  <th className="px-4 py-3 font-semibold">Unit</th>
                  <th className="px-4 py-3 text-right font-semibold">Covered (RCV)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {data.scopeLines.map((l, i) => (
                  <tr key={i} className="break-inside-avoid">
                    <td className="px-4 py-3 text-neutral-800">{l.description}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-neutral-600">{l.quantity}</td>
                    <td className="px-4 py-3 uppercase text-neutral-500">{l.unit}</td>
                    <td className="px-4 py-3 text-right font-medium"><Money cents={l.rcvCents} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-neutral-400">Figures reflect the insurance scope. ACV and depreciation are summarized in the Financial Summary.</p>
        </Section>
      )}

      {/* UPGRADES */}
      {enabled("upgrades") && upgrades.length > 0 && (
        <Section id="upgrades" eyebrow="Upgrades & Recommendations" title="Optional upgrades">
          <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200">
            {upgrades.map((u) => (
              <li key={u.label} className="flex items-center justify-between px-4 py-4">
                <span className="font-medium text-neutral-800">{u.label}</span>
                <span className="text-neutral-600">{u.priceCents > 0 ? <Money cents={u.priceCents} /> : "Included / quoted"}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* TIMELINE */}
      {enabled("timeline") && (
        <Section id="timeline" eyebrow="Timeline" title="How your project flows">
          <ol className="relative ml-3 border-l-2 border-neutral-200">
            {roofingTimeline().map((step, i) => (
              <li key={i} className="mb-5 break-inside-avoid pl-6">
                <span className="absolute -left-[9px] mt-1 size-4 rounded-full border-2 border-white bg-[var(--proposal-accent)]" />
                <span className="font-medium text-neutral-800">{step}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {/* FINANCIAL SUMMARY */}
      {enabled("financial") && (
        <Section id="financial" eyebrow="Financial Summary" title="What this project costs you">
          <dl className="divide-y divide-neutral-100 rounded-xl border border-neutral-200">
            {[
              ["Insurance RCV", fin.rcvCents],
              ["Actual cash value (ACV)", fin.acvCents],
              ["Recoverable depreciation", fin.depreciationCents],
              ["Approved supplements", fin.approvedSupplementsCents],
              ["Customer upgrades", fin.customerUpgradesCents],
            ].filter(([, v]) => (v as number) > 0).map(([k, v]) => (
              <div key={k as string} className="flex items-center justify-between px-4 py-3">
                <dt className="text-neutral-600">{k}</dt>
                <dd className="font-medium"><Money cents={v as number} /></dd>
              </div>
            ))}
            <div className="flex items-center justify-between bg-neutral-50 px-4 py-3">
              <dt className="font-semibold text-neutral-900">Total project value</dt>
              <dd className="font-bold"><Money cents={fin.totalProjectValueCents} /></dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="font-semibold text-neutral-900">Your deductible</dt>
              <dd className="font-medium"><Money cents={fin.deductibleCents} /></dd>
            </div>
            <div className="flex items-center justify-between bg-[var(--proposal-accent)]/10 px-4 py-4">
              <dt className="font-bold text-neutral-900">Estimated out-of-pocket</dt>
              <dd className="text-lg font-bold text-[var(--proposal-accent)]"><Money cents={fin.estimatedOutOfPocketCents} /></dd>
            </div>
          </dl>
          <p className="mt-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
            <strong>Texas law:</strong> your insurance deductible is your responsibility and cannot be waived, rebated, or absorbed by the contractor. Recoverable depreciation is released by your carrier after the work is completed.
          </p>
          {c.financialNote && <p className="mt-3 text-sm text-neutral-500">{c.financialNote}</p>}
        </Section>
      )}

      {/* WHY ANEXA */}
      {enabled("why") && (
        <Section id="why" eyebrow={`Why ${data.branding.companyName}`} title="You're in good hands">
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {why.map((w, i) => (
              <li key={i} className="flex items-center gap-3 rounded-lg bg-neutral-50 px-4 py-3">
                <span className="flex size-6 items-center justify-center rounded-full bg-neutral-900 text-xs font-bold text-white">✓</span>
                <span className="font-medium text-neutral-800">{w}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* FAQ */}
      {enabled("faq") && (
        <Section id="faq" eyebrow="FAQ" title="Common questions">
          <div className="space-y-5">
            {faq.map((f, i) => (
              <div key={i} className="break-inside-avoid">
                <p className="font-semibold text-neutral-900">{f.q}</p>
                <p className="mt-1 text-neutral-600">{f.a}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* SIGNATURE / NEXT STEP */}
      {enabled("signature") && (
        <section data-section="signature" className="bg-neutral-950 px-6 py-16 text-center text-white sm:px-10">
          <div className="mx-auto w-full max-w-3xl">
            <h2 className="font-serif text-3xl font-bold sm:text-4xl">Ready for the next step?</h2>
            <p className="mx-auto mt-3 max-w-md text-neutral-300">Review and sign your documents, request a change, or ask us anything.</p>
            <div className="mt-8">
              <NextStepActions token={data.token} mode={mode} signUrl={data.signUrl} />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
