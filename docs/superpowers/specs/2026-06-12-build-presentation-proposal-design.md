# Build Presentation — Customer-Facing Roofing Proposal

**Date:** 2026-06-12
**Status:** Approved (brainstorm), pending implementation plan
**Area:** Lead/deal detail → new "Build Presentation" flow

## Goal

Replace the deal header's **"Build Roof Report"** button with **"Build
Presentation"**, which opens a builder that produces a modern, customer-facing
roofing **insurance-restoration** proposal — a responsive web presentation at a
shareable link, used by the rep to sit with the homeowner and walk through
damage photos, scope, upgrades, timeline, financials, and next steps. Modeled on
the uploaded solar "Energy Savings Proposal" flow, rebranded Anexa + roofing.

**Not a basic PDF report.** Primary artifact = the web presentation.

## Decisions (brainstorm)

1. **Web-first + print-to-PDF.** Primary = responsive web presentation at the
   shareable link. "Download PDF" = print-optimized stylesheet (browser print).
   No headless-browser / server-PDF infra in MVP.
2. **Upgrades = per-proposal, pick-from-list + optional price.** Default roofing
   upgrade list; checked upgrades with a price sum into "Customer upgrades." No
   new settings page.
3. **Standalone photo step.** The builder reuses the SAME site/inspection
   checklist labels (required/optional), but stores photos **lead-scoped** so a
   presentation works before production starts. If a Project exists, the
   project's photos are read in too.
4. **MVP first.** Build: builder (photo gating + content + upgrades + section
   selection + captions), the 11-section web presentation, preview, shareable
   link, print-to-PDF. **Deferred:** send by email/SMS, viewed analytics,
   server-rendered PDF.

## Data model

```prisma
enum ProposalStatus { draft generated sent viewed signed }

model Proposal {
  id              String   @id @default(cuid())
  companyId       String
  company         Company  @relation(...)
  leadId          String
  lead            Lead     @relation(...)
  projectId       String?  // if production started
  status          ProposalStatus @default(draft)
  publicToken     String   @unique // unguessable; the shareable link
  theme           String   @default("anexa")
  customerName    String   // snapshot at create
  propertyAddress String   // snapshot at create
  // All editable copy + selections in one JSON blob (keeps migration small,
  // builder flexible): roofType, damageSummary, recommendedNextStep, dateOfLoss,
  // selectedSections[] (id+order+enabled), upgrades[] ({label, priceCents?,
  // selected}), photoCaptions {fileAssetId: caption}, conditionFlags{},
  // includedPhotoIds[], faqOverrides?, whyAnexaOverrides?, financialNote?.
  content         Json
  createdById     String
  createdBy       User     @relation(...)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([companyId, leadId])
}
```

- Add **`Claim.dateOfLoss DateTime?`** (currently absent; spec lists "date of
  loss if available").
- `proposal_url` = derived from `publicToken` (`/present/{token}`), not stored.
  `pdf_url` dropped (print-to-PDF is client-side).
- Photos are existing **FileAsset** rows (kind=photo, leadId-scoped, `category` =
  checklist slot, `photoTemplateItemId` link) — not duplicated on Proposal.

## RBAC

New **`Proposal`** resource: super_admin/admin/manager `manage`; sales_rep
`create`/`read`/`update` on own leads (Lead scope); others none. The **public
`/present/[token]` route bypasses auth via the token** and serializes only
**customer-safe** fields — never cost, profit, commission, supplement margin, or
internal scope cost columns.

## Surfaces / components

- `prisma/schema.prisma` — Proposal + ProposalStatus + Claim.dateOfLoss; seed a
  Proposal RBAC row + a demo proposal.
- `src/lib/proposal.ts` — pure helpers: financial-summary math, default section
  list, default upgrade list, roofing timeline steps, default FAQ + Why-Anexa
  copy. No cost/commission math leaks to customer output.
- `src/server/modules/proposals/{policies,queries,actions}.ts` —
  create/update/generate (mint token, status→generated), `getProposalForBuilder`
  (authed, full), `getPublicProposal(token)` (customer-safe serializer),
  `requestChangesAction` / `askQuestionAction` (post a Note + fire notification
  to the assigned rep via the notifications engine).
- `src/components/portal/presentation-builder.tsx` + route
  `src/app/portal/leads/[id]/presentation/page.tsx` — multi-step builder (full
  page, more room than a modal).
- `src/components/proposal/presentation-view.tsx` — **shared 11-section
  renderer** (lives outside `/portal` so the public route can import it);
  responsive, white/black/orange, Anexa branding; print stylesheet.
- `src/app/present/[token]/page.tsx` — public route (no auth); fetches by token,
  renders `presentation-view`, includes "Download PDF" (print) + the three
  next-step buttons.
- Extract a reusable **photo checklist** from `project-photos.tsx` that takes a
  scope (`leadId` or `projectId`) so the builder and Production share it.
- `src/app/portal/leads/[id]/page.tsx` — swap `RoofReportButton` for
  `BuildPresentationButton` in the header (see open question on Roof Report).

## Builder flow (gated)

1. **Photos** — render the site/inspection checklist (required vs optional);
   uploads are lead-scoped FileAssets. **"Generate" disabled until every required
   slot has ≥1 photo.**
2. **Content** — overview fields prefilled from Claim/Lead (carrier, claim #,
   date of loss, status, roof type), damage summary, recommended next step,
   per-photo captions, roof-condition flags (missing/creased/lifted shingles,
   soft metals, gutters, screens).
3. **Upgrades** — check from the default list, optional price each.
4. **Sections** — toggle/reorder which of the 11 sections show.
5. **Preview & Generate** — preview the live presentation; Generate mints the
   token (if absent), sets status=generated, reveals the shareable link +
   "Open presentation" + "Download PDF".

## The 11 sections (data sources)

1. **Cover** — branding, customerName, address, "Roofing / Insurance
   Restoration", assigned rep (`lead.assignedRep`), date, hero = front-of-house
   photo.
2. **Project Overview** — Claim status/carrier/claim#/date-of-loss (if present),
   roof type, damage summary, recommended next step.
3. **Inspection Photos** — gallery grouped by `FileAsset.category`, captions from
   `content.photoCaptions`; damage callouts where a caption exists.
4. **Roof Condition Summary** — hail/wind explanation (editable) + affected-area
   flags.
5. **Scope of Work Summary** — from ScopeOfWork/ScopeLine: description, qty, unit,
   insurance unit price, RCV; ACV + depreciation at claim level. **Customer-safe:
   no cost/profit/supplement-margin columns.**
6. **Upgrades** — selected upgrades + optional prices.
7. **Timeline** — roofing milestones: inspection completed · claim filed ·
   adjuster meeting · scope review · supplement request (if needed) · material
   selection · production scheduled · installation · final inspection ·
   depreciation request · final closeout. Completed state derived from claim
   status / pipeline stage where possible.
8. **Financial Summary** — Insurance RCV, ACV, deductible, recoverable
   depreciation, approved supplements (`Project.supplementCents`), customer
   upgrades (sum of priced upgrades), total project value, **estimated
   out-of-pocket** (= deductible + non-covered upgrades). **Include the Texas
   note: the deductible cannot legally be waived.**
9. **Why Anexa Homes** — licensed/insured, restoration support, photo
   documentation, production coordination, clean closeout, warranty (editable
   defaults).
10. **FAQ** — the 7 roofing FAQs (deductible, missed items, duration, bad
    decking, depreciation release, upgrades, more damage found) — editable
    defaults.
11. **Signature / Next Step** — **Review & Sign Documents** (deep-link to the
    existing esign flow for this lead's latest sent DocumentPackage; if none,
    prompt the rep), **Request Changes**, **Ask a Question** (both post a Note +
    notify the rep).

## Financial-summary math (`src/lib/proposal.ts`, customer-safe)

```
customerUpgradesCents = Σ selected upgrades with a price
totalProjectValueCents = RCV + approvedSupplements + customerUpgrades
estimatedOutOfPocketCents = deductible + (upgrades not covered by insurance)
// recoverable depreciation is released after completion — shown, noted, not OOP
```

No internal cost, margin, PA fee, or commission ever reaches the customer view.

## Testing

- Unit (`src/lib/proposal`): financial summary (OOP = deductible + uncovered
  upgrades; totals); default sections/upgrades/timeline.
- E2E: required-photo gate blocks Generate until filled; Generate mints a token
  and the public `/present/[token]` renders all enabled sections; public view
  shows **no** cost/profit/commission; Request Changes posts a note + notifies
  the rep; print stylesheet present.
- Security test: public serializer omits cost fields even when a scope with cost
  exists.

## Open question for spec review

**Build Roof Report** currently lives in that exact header slot and feeds roof
measurements into Scope. The request says "replace" it. Recommend: put **Build
Presentation** in the header slot and **relocate Build Roof Report** into a
secondary spot (Production tab or a kebab menu) so the measurement tool isn't
lost — rather than deleting it. Confirm during review.

## Out of scope (deferred per owner)

- Send by email/SMS; viewed analytics; server-rendered/pixel PDF; company-level
  upgrade catalog (per-proposal list for now); multi-theme (single Anexa theme).
