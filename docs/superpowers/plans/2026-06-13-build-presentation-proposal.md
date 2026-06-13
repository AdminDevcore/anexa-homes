# Build Presentation (Customer-Facing Roofing Proposal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) — implement task-by-task. Steps use `- [ ]` checkboxes.

**Goal:** Replace the deal header's "Build Roof Report" button with "Build Presentation", which builds and shares a modern, customer-facing roofing insurance-restoration proposal (web-first, print-to-PDF, shareable public link).

**Architecture:** New `Proposal` model (lead-scoped, `publicToken` shareable link, editable content in a JSON blob). A multi-step builder page gated on required site/inspection photos. A shared 11-section `presentation-view` renderer used by the authed preview and the public `/present/[token]` route. Public route serializes only customer-safe fields (never cost/profit/commission). Print stylesheet → PDF.

**Tech Stack:** Next.js 16 App Router, Prisma 6, TS strict, Tailwind v4 + shadcn, react-query, existing photo system (FileAsset + PhotoTemplate), existing notifications engine, branding-provider.

**Spec:** `docs/superpowers/specs/2026-06-12-build-presentation-proposal-design.md`

---

## File structure

- `prisma/schema.prisma` — add `enum ProposalStatus`, `model Proposal`, `Claim.dateOfLoss`, Proposal relations on Company/Lead/User.
- `prisma/seed.ts` — Proposal RBAC matrix row + one demo proposal.
- `src/server/rbac/matrix.ts` — add `Proposal` resource.
- `src/lib/proposal.ts` — pure helpers (no DB): `defaultSections()`, `defaultUpgrades()`, `roofingTimeline()`, `defaultFaq()`, `defaultWhyAnexa()`, `computeProposalFinancials()`, `ProposalContent` type, `requiredPhotosMet()`.
- `src/server/modules/proposals/policies.ts` — `canManageProposals`, scope.
- `src/server/modules/proposals/queries.ts` — `getProposalForBuilder`, `getPublicProposal` (customer-safe), `listLeadProposalPhotos`.
- `src/server/modules/proposals/actions.ts` — `ensureProposalAction`, `updateProposalContentAction`, `generateProposalAction`, `requestChangesAction`, `askQuestionAction`.
- `src/components/portal/build-presentation-button.tsx` — header button → builder route.
- `src/components/portal/presentation-builder.tsx` — multi-step builder (client).
- `src/components/portal/photo-checklist.tsx` — extracted reusable checklist (scope = lead or project).
- `src/components/proposal/presentation-view.tsx` — shared 11-section renderer (outside `/portal`).
- `src/components/proposal/presentation-print.css` (or inline `@media print`) — print styles.
- `src/app/portal/leads/[id]/presentation/page.tsx` — authed builder + preview.
- `src/app/present/[token]/page.tsx` — public route (no auth).
- `src/app/present/[token]/actions.ts` or reuse module actions for Request Changes / Ask a Question (token-authed).
- `src/app/portal/leads/[id]/page.tsx` — swap RoofReportButton → BuildPresentationButton; relocate Roof Report to Production tab.
- Tests: `src/lib/proposal.test.ts`, `e2e/build-presentation.spec.ts`.

---

## Phase 1 — Data model + RBAC + pure logic

### Task 1: Prisma model + enum + Claim.dateOfLoss

**Files:** Modify `prisma/schema.prisma`

- [ ] **Step 1: Add enum + model.** Add near other deal models:

```prisma
enum ProposalStatus { draft generated sent viewed signed }

model Proposal {
  id              String         @id @default(cuid())
  companyId       String
  company         Company        @relation(fields: [companyId], references: [id], onDelete: Cascade)
  leadId          String
  lead            Lead           @relation(fields: [leadId], references: [id], onDelete: Cascade)
  projectId       String?
  status          ProposalStatus @default(draft)
  publicToken     String         @unique
  theme           String         @default("anexa")
  customerName    String
  propertyAddress String
  content         Json
  createdById     String
  createdBy       User           @relation("ProposalCreatedBy", fields: [createdById], references: [id])
  viewedAt        DateTime?
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt
  @@index([companyId, leadId])
}
```

- [ ] **Step 2:** Add back-relations: `proposals Proposal[]` on `Company` and `Lead`; `proposalsCreated Proposal[] @relation("ProposalCreatedBy")` on `User`. Add `dateOfLoss DateTime?` to `model Claim`.
- [ ] **Step 3:** Run `pnpm prisma migrate dev --name build_presentation`. Expected: migration applies, client regenerates.
- [ ] **Step 4: Commit** `git add -A && git commit -m "feat(proposal): Proposal model + ProposalStatus + Claim.dateOfLoss"`

### Task 2: RBAC resource

**Files:** Modify `src/server/rbac/matrix.ts`, `prisma/seed.ts`

- [ ] **Step 1:** Add `Proposal` to the resource union/list. Permissions: super_admin/admin/manager → manage; sales_rep → create/read/update; office_staff/project_manager → read; others/customer → none. Mirror the `Scope` resource shape exactly.
- [ ] **Step 2:** If RBAC is seeded into DB, add the matrix rows in seed; else matrix.ts is source of truth — verify `can()` resolves.
- [ ] **Step 3: Commit** `git commit -am "feat(proposal): RBAC Proposal resource"`

### Task 3: Pure logic + tests (`src/lib/proposal.ts`)

**Files:** Create `src/lib/proposal.ts`, `src/lib/proposal.test.ts`

- [ ] **Step 1: Write failing tests** for `computeProposalFinancials` and `requiredPhotosMet`:

```ts
import { describe, it, expect } from "vitest";
import { computeProposalFinancials, requiredPhotosMet } from "./proposal";

describe("computeProposalFinancials", () => {
  it("OOP = deductible + uncovered upgrades; total = RCV + supplements + upgrades", () => {
    const r = computeProposalFinancials({
      rcvCents: 1_800_000, acvCents: 1_400_000, deductibleCents: 250_000,
      depreciationCents: 400_000, approvedSupplementsCents: 300_000,
      upgrades: [{ label: "Impact shingles", priceCents: 150_000, selected: true },
                 { label: "Ridge vent", priceCents: 0, selected: true }],
    });
    expect(r.customerUpgradesCents).toBe(150_000);
    expect(r.totalProjectValueCents).toBe(1_800_000 + 300_000 + 150_000);
    expect(r.estimatedOutOfPocketCents).toBe(250_000 + 150_000);
  });
});

describe("requiredPhotosMet", () => {
  it("false until every required slot has a photo", () => {
    const items = [{ id: "a", required: true }, { id: "b", required: false }];
    expect(requiredPhotosMet(items, { a: 0, b: 1 })).toBe(false);
    expect(requiredPhotosMet(items, { a: 2, b: 0 })).toBe(true);
  });
});
```

- [ ] **Step 2:** Run `pnpm vitest run src/lib/proposal.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement** `src/lib/proposal.ts`:

```ts
export type ProposalUpgrade = { label: string; priceCents: number; selected: boolean };

export type ProposalContent = {
  roofType?: string;
  damageSummary?: string;
  recommendedNextStep?: string;
  dateOfLoss?: string | null;
  conditionFlags?: Record<string, boolean>;
  photoCaptions?: Record<string, string>;
  includedPhotoIds?: string[];
  upgrades?: ProposalUpgrade[];
  selectedSections?: { id: string; enabled: boolean; order: number }[];
  faq?: { q: string; a: string }[];
  whyAnexa?: string[];
  financialNote?: string;
};

export function computeProposalFinancials(i: {
  rcvCents: number; acvCents: number; deductibleCents: number;
  depreciationCents: number; approvedSupplementsCents: number;
  upgrades: ProposalUpgrade[];
}) {
  const customerUpgradesCents = i.upgrades.filter(u => u.selected).reduce((s, u) => s + Math.max(0, u.priceCents || 0), 0);
  const totalProjectValueCents = i.rcvCents + i.approvedSupplementsCents + customerUpgradesCents;
  // Upgrades are not covered by insurance → all add to OOP, plus the deductible.
  const estimatedOutOfPocketCents = i.deductibleCents + customerUpgradesCents;
  return { customerUpgradesCents, totalProjectValueCents, estimatedOutOfPocketCents };
}

export function requiredPhotosMet(
  items: { id: string; required: boolean }[],
  counts: Record<string, number>
): boolean {
  return items.filter(it => it.required).every(it => (counts[it.id] ?? 0) > 0);
}

export const PROPOSAL_SECTIONS = [
  "cover","overview","photos","condition","scope","upgrades",
  "timeline","financial","why","faq","signature",
] as const;

export function defaultSections() {
  return PROPOSAL_SECTIONS.map((id, order) => ({ id, enabled: true, order }));
}

export function defaultUpgrades(): ProposalUpgrade[] {
  return [
    "Architectural shingles","Impact-resistant shingles","Synthetic underlayment",
    "Ice & water shield","Ridge ventilation","Gutter replacement","Metal roof option",
  ].map(label => ({ label, priceCents: 0, selected: false }));
}

export function roofingTimeline() {
  return ["Inspection completed","Claim filed","Adjuster meeting","Scope review",
    "Supplement request (if needed)","Material selection","Production scheduled",
    "Roof installation","Final inspection","Depreciation request","Final closeout"];
}

export function defaultFaq() {
  return [
    { q: "Do I have to pay my deductible?", a: "Yes. In Texas your insurance deductible is your responsibility and by law cannot be waived, rebated, or absorbed by the contractor." },
    { q: "What happens if insurance missed items?", a: "We document everything with photos and file a supplement to your carrier for missed or underpaid items." },
    { q: "How long does a roof replacement take?", a: "Most residential roofs are installed in 1–2 days once materials are delivered and production is scheduled." },
    { q: "What happens if the decking is bad?", a: "Damaged or rotten decking found during tear-off is documented and supplemented to your carrier; we replace it to code." },
    { q: "When is depreciation released?", a: "Recoverable depreciation is released by your carrier after the work is completed and final invoices/photos are submitted." },
    { q: "Can I upgrade materials?", a: "Yes. You can select upgrades (e.g. impact-resistant shingles); the upgrade cost above the insurance scope is your out-of-pocket." },
    { q: "What if more damage is found during production?", a: "We pause, document it, and supplement your claim before proceeding so nothing is missed." },
  ];
}

export function defaultWhyAnexa() {
  return ["Licensed & insured", "Full insurance-restoration support", "Complete photo documentation",
    "Dedicated production coordination", "Clean closeout package", "Workmanship warranty support"];
}
```

- [ ] **Step 4:** Run `pnpm vitest run src/lib/proposal.test.ts` — expect PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(proposal): pure logic + financial math + defaults (tested)"`

---

## Phase 2 — Server module (queries, actions, policies)

### Task 4: policies + queries

**Files:** Create `src/server/modules/proposals/{policies,queries}.ts`

- [ ] **Step 1:** `policies.ts` — `canManageProposals(role)`, `proposalScope(user)` mirroring `scope/policies.ts`.
- [ ] **Step 2:** `queries.ts`:
  - `getProposalForBuilder(companyId, leadId)` — proposal (or null) + lead (customer, address, assignedRep) + claim (carrier/claim#/dateOfLoss/status/rcv/acv/deductible/depreciation) + project (supplementCents, id) + scope lines (description/qty/unit/insuranceUnitPrice/RCV only — NO cost) + the site/inspection PhotoTemplate items + lead-scoped photos grouped by category.
  - `getPublicProposal(token)` — by `publicToken`; returns a **customer-safe** DTO: company branding, lead customer fields, claim customer fields, scope lines WITHOUT cost/supplement-margin, financial summary via `computeProposalFinancials`, photos+captions, content. **Never select cost/profit/commission columns.**
- [ ] **Step 3: Commit** `git commit -am "feat(proposal): policies + builder/public queries"`

### Task 5: actions

**Files:** Create `src/server/modules/proposals/actions.ts`

- [ ] **Step 1:** `ensureProposalAction(leadId)` — get-or-create draft (mint `publicToken` via `crypto.randomUUID()` server-side or cuid; snapshot customerName/address; seed content from defaults). Guard `can(create|update, Proposal)` + scope.
- [ ] **Step 2:** `updateProposalContentAction({ proposalId, content })` — merge-validate content (zod), persist.
- [ ] **Step 3:** `generateProposalAction(proposalId)` — require `requiredPhotosMet`; set status=generated; return `{ token }`.
- [ ] **Step 4:** `requestChangesAction({ token, message })` + `askQuestionAction({ token, message })` — token-resolved; create a `Note` on the lead (context "proposal") + `fireEvent` notification to assigned rep. No auth required (public), but rate-limit by token.
- [ ] **Step 5: Commit** `git commit -am "feat(proposal): ensure/update/generate + customer reply actions"`

---

## Phase 3 — Photo checklist reuse + builder

### Task 6: extract reusable photo checklist

**Files:** Create `src/components/portal/photo-checklist.tsx`; refactor `project-photos.tsx` to use it (keep behavior identical).

- [ ] **Step 1:** Extract a `<PhotoChecklist scope={{leadId}|{projectId}} templateKind="site" />` that renders slots, upload buttons (reusing `uploadFileAction`), thumbnails, required badges, progress X/N. Lead-scope uploads pass `leadId` + `photoTemplateItemId` + `category`.
- [ ] **Step 2:** Point `project-photos.tsx` Site/Install tabs at the shared component (projectId scope). Verify existing CompanyCam E2E still passes: `pnpm playwright test e2e/...photos...`.
- [ ] **Step 3: Commit** `git commit -am "refactor(photos): extract reusable PhotoChecklist (lead|project scope)"`

### Task 7: builder page + button

**Files:** Create `presentation-builder.tsx`, `build-presentation-button.tsx`, `app/portal/leads/[id]/presentation/page.tsx`; modify `leads/[id]/page.tsx`.

- [ ] **Step 1:** `build-presentation-button.tsx` — links to `/portal/leads/[id]/presentation`. In `leads/[id]/page.tsx` replace `<RoofReportButton>` in the header with it; move `<RoofReportButton>` into the Production tab section.
- [ ] **Step 2:** `presentation/page.tsx` (server) — auth + scope; `ensureProposalAction` on load (or button); fetch `getProposalForBuilder`; render `<PresentationBuilder>`.
- [ ] **Step 3:** `presentation-builder.tsx` (client) — steps: Photos (PhotoChecklist, gate) → Content (fields prefilled, captions, condition flags) → Upgrades (list + price) → Sections (toggle/reorder) → Preview & Generate. Autosave via `updateProposalContentAction` (debounced/onBlur, like claim-info-card). Generate disabled until `requiredPhotosMet`; on success show shareable link + Open + Download PDF.
- [ ] **Step 4: Commit** `git commit -am "feat(proposal): builder page + header button (Roof Report relocated)"`

---

## Phase 4 — Renderer + public route + PDF

### Task 8: shared presentation renderer

**Files:** Create `src/components/proposal/presentation-view.tsx` (+ print styles)

- [ ] **Step 1:** `<PresentationView data={PublicProposalDTO} mode="preview"|"public" />` rendering all 11 sections per spec, responsive, white/black/orange, Anexa logo from branding data passed in (no session dependency). Hero = front-of-house photo. Photo gallery grouped by category with captions. Scope table customer-safe. Financial summary via the DTO's computed numbers + Texas note. Timeline styled. FAQ/Why from content or defaults.
- [ ] **Step 2:** Print CSS (`@media print`): hide nav/buttons, page-break per section, full-width.
- [ ] **Step 3: Commit** `git commit -am "feat(proposal): shared 11-section PresentationView + print styles"`

### Task 9: public route + preview wiring

**Files:** Create `app/present/[token]/page.tsx`; wire preview in builder.

- [ ] **Step 1:** `present/[token]/page.tsx` (server, public) — `getPublicProposal(token)`; 404 if missing; render `<PresentationView mode="public">`; set `viewedAt`/status=viewed if first view (cheap). "Download PDF" triggers `window.print()`. Next-step buttons call the token actions; "Review & Sign" deep-links to the lead's latest sent signing link or shows "your rep will send documents".
- [ ] **Step 2:** Builder preview reuses `<PresentationView mode="preview">` with live content.
- [ ] **Step 3: Commit** `git commit -am "feat(proposal): public /present/[token] route + builder preview"`

---

## Phase 5 — Tests + verify

### Task 10: E2E + security

**Files:** Create `e2e/build-presentation.spec.ts`

- [ ] **Step 1:** Tests: (a) header shows "Build Presentation"; (b) Generate blocked until required photos uploaded, then enabled; (c) public `/present/[token]` renders enabled sections; (d) **public HTML contains no cost/profit/commission strings** even when a scope with cost exists; (e) Request Changes posts a note + notifies rep.
- [ ] **Step 2:** Run `pnpm playwright test e2e/build-presentation.spec.ts`. Fix until green.
- [ ] **Step 3:** Full check: `pnpm build` green; `rm -rf .next` before next `pnpm dev` (Turbopack stale-route gotcha).
- [ ] **Step 4: Commit** `git commit -am "test(proposal): e2e + cost-leak security test"`

---

## Self-review notes
- Spec coverage: all 11 sections (Task 8), photo gate (Tasks 3,7), data model fields (Task 1), public link + status (Tasks 1,5,9), upgrades priced (Tasks 3,7,8), Texas note (Tasks 3,8), customer-safe (Tasks 4,8,10), Roof Report relocation (Task 7). Deferred per spec: email/SMS, view analytics beyond `viewedAt`, server PDF, upgrade catalog, multi-theme.
- Type consistency: `ProposalContent` (Task 3) is the single content shape used by builder/queries/view.
- Open spec question (relocate vs delete Roof Report): plan relocates (Task 7) — confirm with owner.
