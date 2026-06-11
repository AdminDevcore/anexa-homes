# Scope of Work — Job Profitability Calculator

**Date:** 2026-06-11
**Status:** Approved (user confirmed "That's right — build it")

## Goal
On the spot, once a claim hits **Scope Received**, let staff figure out the real
profit of a job before committing: enter what insurance pays per line vs. what it
costs us per line, and see profit $ and margin % instantly. Also store the carrier
scope PDF on the deal.

## Decisions
- **Layout:** one combined spreadsheet — per line: category, description, qty, unit,
  insurance $/unit, our cost $/unit → per-line insurance/cost/profit + grand totals
  (insurance, cost, profit, margin %).
- **Cost visibility:** management only (super_admin/admin/manager). Cost & profit are
  omitted from the server payload for everyone else — they see the insurance side only.
- **Reuse:** "Import from claim" copies existing `ClaimLineItem` rows in as the
  insurance side (no double entry). Scope is otherwise its own worksheet.
- **Templates:** editable preset of common roofing line items + default cost rates,
  managed in Settings; "Load template" drops them into a scope.
- **PDF:** upload + view (manual line entry). No Xactimate auto-parse in v1.
- **Gating:** Scope of Work tab appears when claimStatus ∈ {scope_received,
  supplement_needed, approved, paid, closed}; hidden before scope is received.
- **Attachment:** 1:1 with Lead/deal (scope known before Project exists).

## Data model (Prisma)
```
model ScopeOfWork {
  id, companyId, leadId @unique, industry
  pdfFileId?   // FileAsset id (plain column, like RoofReport.reportFileId)
  notes?
  lines ScopeLine[]
  createdAt, updatedAt   // @@index([companyId, leadId])
}

model ScopeLine {
  id, companyId, scopeId, position
  category, description
  quantity            Float @default(0)
  unit?               // sq, sq ft, lf, ea
  insuranceUnitPrice  Int @default(0)  // cents
  costUnitPrice       Int @default(0)  // cents
  createdAt           // @@index([scopeId])
}

model ScopeTemplateItem {
  id, companyId, industry, position
  category, description, unit?
  defaultInsuranceUnitPrice Int @default(0)  // cents
  defaultCostUnitPrice      Int @default(0)  // cents
  @@index([companyId, industry])
}
```
Money in cents (matches ClaimLineItem). Per-line totals computed, not stored.

## Pure math — `src/lib/scope.ts`
- `lineInsuranceCents(line)`, `lineCostCents(line)`, `lineProfitCents(line)`
- `rollup(lines)` → `{ insuranceCents, costCents, profitCents, marginPct, byCategory[] }`
Unit-tested independently of DB/UI.

## RBAC — new `Scope` resource
- manage: super_admin, admin, manager
- read + update: sales_rep (own deals via Lead scope)
- read: canvasser, marketing, accounting
- none: installer, customer
- `canSeeScopeCosts(role)` = super_admin | admin | manager — gates cost/profit in BOTH
  the payload and the UI.

## Module / files
- `src/server/modules/scope/{policies,queries,actions}.ts`
  - queries: `getScopeForLead(user, leadId)` (+ canSeeCosts-aware serializer), template list.
  - actions: ensureScope, uploadScopePdf, addLine, updateLine, deleteLine,
    importFromClaim, loadTemplate, + template CRUD (settings).
- `src/lib/scope.ts` — pure math.
- `src/components/portal/scope-of-work-panel.tsx` — the tab UI (PDF zone, toolbar,
  editable grouped spreadsheet, totals).
- `src/app/portal/scope/[id]/pdf/route.ts` — visibility-checked PDF serve.
- `src/components/portal/scope-template-manager.tsx` + `/portal/settings/scope-template`.
- Edits: schema + migration, RBAC matrix, deal-tabs icon (Calculator),
  `leads/[id]/page.tsx` (insert gated Scope tab + panel), settings nav.

## Deal page integration
- `dealTabs`: insert `{ id: "scope", label: "Scope of Work" }` after claim, only when
  claimStatus is scope-received-or-later.
- Render `<ScopeOfWorkPanel>` in a `data-deal-tab="scope"` group; pass `canSeeCosts`,
  `canEdit`, serialized scope (cost fields stripped for non-management), claim line
  count (to enable "Import from claim").

## Seed
- Default roofing `ScopeTemplateItem` set (~10 lines with cost rates).
- A demo `ScopeOfWork` with a few lines on the existing Scope-Received lead.

## Tests (e2e) — `e2e/scope-of-work.spec.ts`
- Manager: Scope tab on a scope-received deal; add line + costs → profit/margin show.
- Import from claim pulls claim line items.
- Sales rep: sees tab + insurance side, NO cost/profit columns.
- Deal not at scope_received: no Scope tab.
