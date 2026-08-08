import * as React from "react";
import { cn } from "@/lib/utils";
import { formatScopeCents } from "@/lib/scope";
import {
  roofingTimeline,
  DAMAGE_TYPE_ITEMS,
  ROOF_CONDITION_ITEMS,
  paymentPlan,
  defaultFaq,
  defaultWhyAnexa,
  PROPOSAL_NAV_PX,
  type ProposalSectionId,
} from "@/lib/proposal";
import type { ProposalView } from "@/server/modules/proposals/queries";
import { NextStepActions } from "./next-step-actions";
import { PaymentOptions } from "./payment-options";
import { ProposalChrome, type ChromeNavItem } from "./proposal-chrome";
import { PhotoCarousel } from "./photo-carousel";

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/** Editorial chapter. `tone="dark"` makes a dramatic full-width dark chapter. */
function Section({
  id, title, eyebrow, children, tone = "light", wide = false,
}: {
  id: string; title?: string; eyebrow?: string; children: React.ReactNode;
  tone?: "light" | "dark"; wide?: boolean;
}) {
  const dark = tone === "dark";
  return (
    <section
      data-section={id}
      data-reveal
      className={cn(
        "relative overflow-hidden px-6 py-20 sm:px-10 sm:py-28 print:py-8",
        dark ? "bg-neutral-950 text-neutral-100" : "bg-transparent text-neutral-900",
      )}
    >
      <div className={cn("relative mx-auto w-full", wide ? "max-w-5xl" : "max-w-3xl")}>
        {eyebrow && (
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-[var(--proposal-accent)]">{eyebrow}</p>
        )}
        {title && (
          <h2 className={cn("mb-10 font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl", dark ? "text-white" : "text-neutral-900")}>
            {title}
          </h2>
        )}
        {children}
      </div>
    </section>
  );
}

function Money({ cents }: { cents: number }) {
  return <span className="tabular-nums">{formatScopeCents(cents)}</span>;
}

export function PresentationView({
  data,
  mode,
  chromeOffset = 0,
}: {
  data: ProposalView;
  mode: "public" | "preview";
  /** Pixels of surrounding app chrome already pinned above the proposal's own
   *  nav. The embedder owns this number — the document knows nothing about the
   *  portal it may be previewed inside. */
  chromeOffset?: number;
}) {
  const c = data.content;
  const sections = (c.selectedSections && c.selectedSections.length > 0
    ? [...c.selectedSections].sort((a, b) => a.order - b.order)
    : []
  ).filter((s) => s.enabled);
  const enabled = (id: ProposalSectionId) =>
    sections.length === 0 ? true : sections.some((s) => s.id === id);

  const faq = c.faq && c.faq.length > 0 ? c.faq : defaultFaq(data.financials.dealType);
  const why = c.whyAnexa && c.whyAnexa.length > 0 ? c.whyAnexa : defaultWhyAnexa(data.financials.dealType);
  const conditionFlags = c.conditionFlags ?? {};
  const activeDamageTypes = DAMAGE_TYPE_ITEMS.filter((i) => conditionFlags[i.key]);
  const activeConditions = [...activeDamageTypes, ...ROOF_CONDITION_ITEMS.filter((i) => conditionFlags[i.key])];
  const upgrades = (c.upgrades ?? []).filter((u) => u.selected);
  const fin = data.financials;
  const cashDeal = fin.dealType === "cash";
  const plan = paymentPlan({ outOfPocketCents: fin.estimatedOutOfPocketCents, financing: c.financing });

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
      className="min-h-screen bg-[#f6f3ee] text-neutral-900"
      style={{
        ["--proposal-accent" as string]: data.branding.accentColor || "#F4631E",
        // Everything pinned above a chapter, so a jump link lands the chapter
        // below the chrome instead of behind it. Just this document's nav on the
        // customer's page; the portal shell and the builder toolbar as well when
        // a rep is previewing it inside the CRM.
        ["--proposal-chrome-h" as string]: `${chromeOffset + PROPOSAL_NAV_PX}px`,
      }}
    >
      <ProposalChrome
        companyName={data.branding.companyName}
        logoUrl={data.branding.logoUrl}
        navItems={navItems}
        offsetTop={chromeOffset}
      />

      {/* COVER — full-bleed editorial hero on the customer's house. On paper it
          owns its page: tall enough to fill a Letter sheet inside the @page
          margins, never so tall it spills onto a second. */}
      {enabled("cover") && (
        <section data-section="cover" className="relative flex min-h-[100svh] flex-col justify-end overflow-hidden bg-neutral-950 px-6 py-14 text-white sm:px-10 print:min-h-[9.5in] print:py-16">
          {/* ANEXA brand cover — the same striking, on-brand opener on every proposal */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/anexa-proposal-cover.png" alt={data.branding.companyName} className="absolute inset-0 h-full w-full object-cover [print-color-adjust:exact] [-webkit-print-color-adjust:exact]" />
          <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/80 to-neutral-950/20" />
          <div className="reveal-up relative mx-auto w-full max-w-5xl">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-[var(--proposal-accent)]">{data.projectType}</p>
            <h1 className="mt-4 font-display text-5xl font-bold leading-[0.95] tracking-tight sm:text-7xl lg:text-8xl">
              Your new roof,<br />done right.
            </h1>
            <div className="mt-8 space-y-1 text-lg text-neutral-200">
              <p className="text-2xl font-semibold text-white sm:text-3xl">{data.customerName}</p>
              <p className="text-neutral-300">{data.propertyAddress}</p>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-8 gap-y-2 text-sm text-neutral-300">
              {data.repName && <span>Prepared by <strong className="text-white">{data.repName}</strong></span>}
              <span>{fmtDate(data.createdAt)}</span>
            </div>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center print:hidden">
            <span className="flex flex-col items-center gap-1 text-[11px] uppercase tracking-[0.3em] text-neutral-400">
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
          <dl className="grid grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-2">
            {(cashDeal
              ? ([
                  ["Project type", data.projectType],
                  ["Roof type", data.claim.roofType],
                ] as [string, string | null][])
              : ([
                  ["Claim status", data.claim.status],
                  ["Insurance carrier", data.claim.carrier],
                  ["Claim number", data.claim.claimNumber],
                  ["Date of loss", data.claim.lossDate ? fmtDate(data.claim.lossDate) : null],
                  ["Roof type", data.claim.roofType],
                ] as [string, string | null][])
            ).filter(([, v]) => v).map(([k, v], idx) => (
              <div key={k as string} data-stagger style={{ ["--i" as string]: idx } as React.CSSProperties}>
                <dt className="text-xs font-semibold uppercase tracking-[0.15em] text-neutral-400">{k}</dt>
                <dd className="mt-1.5 text-xl font-medium capitalize text-neutral-900">{String(v).replace(/_/g, " ")}</dd>
              </div>
            ))}
          </dl>
          {c.damageSummary && (
            <div className="mt-10 border-l-2 border-[var(--proposal-accent)] pl-5">
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-neutral-400">Damage summary</p>
              <p className="mt-2 text-lg leading-relaxed text-neutral-700">{c.damageSummary}</p>
            </div>
          )}
          {c.recommendedNextStep && (
            <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-neutral-200/60">
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--proposal-accent)]">Recommended next step</p>
              <p className="mt-1.5 text-lg font-medium text-neutral-900">{c.recommendedNextStep}</p>
            </div>
          )}
        </Section>
      )}

      {/* INSPECTION PHOTOS — dark chapter, swipeable carousels */}
      {enabled("photos") && data.photoGroups.length > 0 && (
        <Section id="photos" eyebrow="The Damage" title="What we documented" tone="dark" wide>
          <div className="space-y-14">
            {data.photoGroups.map((g) => (
              <div key={g.category} data-stagger style={{ ["--i" as string]: 0 } as React.CSSProperties}>
                <h3 className="mb-5 text-sm font-semibold uppercase tracking-[0.2em] text-neutral-400">{g.category}</h3>
                <PhotoCarousel photos={g.photos.map((p) => ({ id: p.id, url: p.url, caption: p.caption }))} label={g.category} />
              </div>
            ))}
          </div>
          <p className="mt-12 text-sm text-neutral-500 print:hidden">Tap any photo to view it full screen.</p>
        </Section>
      )}

      {/* ROOF CONDITION SUMMARY */}
      {enabled("condition") && (activeConditions.length > 0 || c.conditionNarrative) && (
        <Section id="condition" eyebrow="Roof Condition" title="What storm damage looks like">
          {c.conditionNarrative && <p className="mb-8 text-lg leading-relaxed text-neutral-700">{c.conditionNarrative}</p>}
          {activeConditions.length > 0 && (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {activeConditions.map((i, idx) => (
                <li
                  key={i.key}
                  data-stagger
                  style={{ ["--i" as string]: idx } as React.CSSProperties}
                  className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-5 py-4 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-[var(--proposal-accent)]/40 hover:shadow-lg"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--proposal-accent)] text-xs font-bold text-white">✓</span>
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
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-neutral-200/60">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-[0.1em] text-neutral-500">
                <tr>
                  <th className="px-5 py-4 font-semibold">Item</th>
                  <th className="px-5 py-4 text-right font-semibold">Qty</th>
                  <th className="px-5 py-4 font-semibold">Unit</th>
                  <th className="px-5 py-4 text-right font-semibold">Covered (RCV)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {data.scopeLines.map((l, i) => (
                  <tr key={i} className="break-inside-avoid transition-colors hover:bg-neutral-50">
                    <td className="px-5 py-3.5 text-neutral-800">{l.description}</td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-neutral-600">{l.quantity}</td>
                    <td className="px-5 py-3.5 uppercase text-neutral-500">{l.unit}</td>
                    <td className="px-5 py-3.5 text-right font-medium"><Money cents={l.rcvCents} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs text-neutral-400">Figures reflect the insurance scope. ACV and depreciation are summarized in the Financial Summary.</p>
        </Section>
      )}

      {/* UPGRADES */}
      {enabled("upgrades") && upgrades.length > 0 && (
        <Section id="upgrades" eyebrow="Upgrades & Recommendations" title="Optional upgrades">
          <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-neutral-200/60">
            {upgrades.map((u, i) => (
              <li
                key={u.label}
                data-stagger
                style={{ ["--i" as string]: i } as React.CSSProperties}
                className="flex items-center justify-between px-5 py-5 transition-colors hover:bg-neutral-50"
              >
                <span className="font-medium text-neutral-800">{u.label}</span>
                <span className="text-neutral-600">{u.priceCents > 0 ? <Money cents={u.priceCents} /> : "Included / quoted"}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* TIMELINE — animated numbered stepper */}
      {enabled("timeline") && (
        <Section id="timeline" eyebrow="Timeline" title="How your project flows">
          <ol className="relative space-y-1">
            <span
              className="pointer-events-none absolute bottom-6 left-[24px] top-6 w-0.5 bg-gradient-to-b from-[var(--proposal-accent)] via-[var(--proposal-accent)]/60 to-[var(--proposal-accent)]/15 print:hidden"
              aria-hidden
            />
            {roofingTimeline(fin.dealType).map((step, i) => (
              <li
                key={i}
                data-stagger
                style={{ ["--i" as string]: i } as React.CSSProperties}
                className="group relative flex items-center gap-5 rounded-xl px-3 py-2.5 transition-colors hover:bg-white"
              >
                <span className="relative z-10 flex size-12 shrink-0 items-center justify-center rounded-full bg-[var(--proposal-accent)] text-lg font-bold text-white shadow-md ring-4 ring-[#f6f3ee] transition-transform duration-300 group-hover:scale-110 group-hover:ring-white">
                  {i + 1}
                </span>
                <span className="text-lg font-medium text-neutral-800 transition-colors group-hover:text-neutral-950">{step}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {/* FINANCIAL SUMMARY — dark chapter with the out-of-pocket as the hero number */}
      {enabled("financial") && (
        <Section id="financial" eyebrow="Your Investment" title="What this project costs you" tone="dark">
          <div className="break-inside-avoid rounded-3xl bg-[var(--proposal-accent)] p-8 text-white sm:p-10">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-white/80">{cashDeal ? "Your project total" : "Your estimated out-of-pocket"}</p>
            <p className="mt-3 font-display text-6xl font-bold leading-none tracking-tight sm:text-8xl"><Money cents={fin.estimatedOutOfPocketCents} /></p>
            {/* Only promise monthly payments when the rep actually offered them. */}
            <p className="mt-4 max-w-md text-white/85">
              {cashDeal
                ? plan.financeOptions.length > 0
                  ? "That’s your all-in price. Pay in full, or spread it into easy monthly payments below."
                  : "That’s your all-in price for the scope shown."
                : plan.financeOptions.length > 0
                  ? "That’s your deductible — the rest of the project is covered by your insurance claim. Pay it in full, or monthly."
                  : "That’s your deductible — the rest of the project is covered by your insurance claim."}
            </p>
          </div>

          <dl className="mt-8 break-inside-avoid divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
            {(cashDeal
              ? ([
                  ["Project price", fin.projectPriceCents],
                  ["Upgrades", fin.customerUpgradesCents],
                ] as [string, number][])
              : ([
                  ["Insurance RCV", fin.rcvCents],
                  ["Actual cash value (ACV)", fin.acvCents],
                  ["Recoverable depreciation", fin.depreciationCents],
                  ["Approved supplements", fin.approvedSupplementsCents],
                  ["Customer upgrades", fin.customerUpgradesCents],
                ] as [string, number][])
            ).filter(([, v]) => v > 0).map(([k, v], idx) => (
              <div key={k} data-stagger style={{ ["--i" as string]: idx } as React.CSSProperties} className="flex items-center justify-between px-5 py-3.5">
                <dt className="text-neutral-300">{k}</dt>
                <dd className="font-medium text-white"><Money cents={v} /></dd>
              </div>
            ))}
            <div className="flex items-center justify-between bg-white/[0.06] px-5 py-4">
              <dt className="font-semibold text-white">Total project value</dt>
              <dd className="text-lg font-bold text-white"><Money cents={fin.totalProjectValueCents} /></dd>
            </div>
            {!cashDeal && (
              <div className="flex items-center justify-between px-5 py-3.5">
                <dt className="font-semibold text-white">Your deductible</dt>
                <dd className="font-medium text-white"><Money cents={fin.deductibleCents} /></dd>
              </div>
            )}
            {fin.projectDiscountCents > 0 && (
              <div className="flex items-center justify-between px-5 py-3.5">
                <dt className="font-semibold text-emerald-300">{cashDeal ? "Discount" : "Project discount"}</dt>
                <dd className="font-medium text-emerald-300">−<Money cents={fin.projectDiscountCents} /></dd>
              </div>
            )}
            <div className="flex items-center justify-between bg-white/[0.06] px-5 py-4">
              <dt className="font-semibold text-white">{cashDeal ? "Your total" : "Your out-of-pocket"}</dt>
              <dd className="text-lg font-bold text-white"><Money cents={fin.estimatedOutOfPocketCents} /></dd>
            </div>
          </dl>

          {plan.totalCents > 0 && (
            <PaymentOptions
              token={data.token}
              mode={mode}
              plan={plan}
              selected={c.selectedPayment}
              cashLabel="Pay in full"
              cashCaption={
                cashDeal
                  ? "Your all-in price, due on completion."
                  : "Your deductible, due on completion. Your carrier covers the rest."
              }
            />
          )}

          {!cashDeal && (
            <p className="mt-6 break-inside-avoid rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-200">
              <strong className="text-amber-100">Texas law:</strong> your insurance deductible is your responsibility and cannot be waived, rebated, or absorbed by the contractor. Recoverable depreciation is released by your carrier after the work is completed.
            </p>
          )}
          {c.financialNote && <p className="mt-3 text-sm text-neutral-400">{c.financialNote}</p>}
        </Section>
      )}

      {/* WHY ANEXA */}
      {enabled("why") && (
        <Section id="why" eyebrow={`Why ${data.branding.companyName}`} title="You're in good hands">
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {why.map((w, i) => (
              <li
                key={i}
                data-stagger
                style={{ ["--i" as string]: i } as React.CSSProperties}
                className="flex items-center gap-3 rounded-xl bg-white px-5 py-4 shadow-sm ring-1 ring-neutral-200/60 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-xs font-bold text-white">✓</span>
                <span className="font-medium text-neutral-800">{w}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* FAQ */}
      {enabled("faq") && (
        <Section id="faq" eyebrow="FAQ" title="Common questions">
          <div className="space-y-6">
            {faq.map((f, i) => (
              <div
                key={i}
                data-stagger
                style={{ ["--i" as string]: i } as React.CSSProperties}
                className="break-inside-avoid rounded-2xl bg-white p-6 shadow-sm ring-1 ring-neutral-200/60"
              >
                <p className="font-display text-xl font-semibold text-neutral-900">{f.q}</p>
                <p className="mt-2 leading-relaxed text-neutral-600">{f.a}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* SIGNATURE / NEXT STEP */}
      {enabled("signature") && (
        <section data-section="signature" className="relative overflow-hidden bg-neutral-950 px-6 py-24 text-center text-white sm:px-10">
          <div className="mx-auto w-full max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.25em] text-[var(--proposal-accent)]">Let&rsquo;s get started</p>
            <h2 className="mt-3 font-display text-4xl font-bold leading-tight sm:text-6xl">Ready for the next step?</h2>
            <p className="mx-auto mt-4 max-w-md text-lg text-neutral-300">Review and sign your documents, request a change, or ask us anything.</p>
            <div className="mt-10">
              <NextStepActions token={data.token} mode={mode} signUrl={data.signUrl} />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
