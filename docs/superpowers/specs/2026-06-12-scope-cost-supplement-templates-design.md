# Scope of Work — Cost & Supplement Templates (Sub-project 1)

**Date:** 2026-06-12
**Status:** Approved (design)
**Area:** `/portal/settings/scope-*`, `src/server/modules/scope`, `prisma/schema.prisma`

## Context

The scope system now separates concerns:
- **Master catalog** (`ScopeCatalogItem`, existing): the company-wide list of insurance-restoration line items — **no pricing** (category, subcategory, description, unit, trade, flags, isActive).
- **This sub-project** adds **versioned price lists** that reference the catalog: **Cost Templates** (cost per unit) and **Supplement Templates** (expected supplement price per unit + reason/evidence/notes).

Editing a template's prices must **never** mutate the master catalog. Templates are keyed by `catalogItemId` so the Project → Scope of Work integration (sub-project 2) can look up a line's price by its catalog item.

This is the **first of three sub-projects**: (1) Templates [this], (2) Project integration + calculations, (3) comparison view.

## Decisions (confirmed with user)

| Decision | Choice |
|---|---|
| Build order | Templates first; then project integration; then comparison |
| Catalog → existing templates when a catalog item is added later | **Manual "Add missing items"** button (templates are fixed snapshots otherwise) |
| Project line ↔ catalog (sub-project 2) | Project scope lines will **pick from the catalog** and pull cost/supplement from the selected templates (insurance price stays per-project). Confirms template items are keyed by `catalogItemId`. |

## Data model (4 new models — money in integer cents, all `companyId`-scoped)

```
model ScopeCostTemplate {
  id            String  @id @default(uuid())
  companyId     String
  company       Company @relation(...)
  name          String
  description   String?
  effectiveDate DateTime @default(now())
  isActive      Boolean  @default(true)
  items         ScopeCostTemplateItem[]
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@index([companyId])
}

model ScopeCostTemplateItem {
  id              String @id @default(uuid())
  companyId       String
  templateId      String
  template        ScopeCostTemplate @relation(..., onDelete: Cascade)
  catalogItemId   String
  catalogItem     ScopeCatalogItem  @relation(..., onDelete: Cascade)
  costPerUnitCents Int   @default(0)
  createdAt       DateTime @default(now())
  @@unique([templateId, catalogItemId])
  @@index([templateId])
}

model ScopeSupplementTemplate {
  id, companyId, company, name, description?, effectiveDate, isActive,
  items ScopeSupplementTemplateItem[], createdAt, updatedAt
  @@index([companyId])
}

model ScopeSupplementTemplateItem {
  id, companyId, templateId (-> ScopeSupplementTemplate, onDelete Cascade),
  catalogItemId (-> ScopeCatalogItem, onDelete Cascade),
  supplementPerUnitCents Int @default(0),
  reason String?, requiredEvidence String?, notes String?,
  createdAt
  @@unique([templateId, catalogItemId])
  @@index([templateId])
}
```

`ScopeCatalogItem` gains back-relations: `costTemplateItems ScopeCostTemplateItem[]`, `supplementTemplateItems ScopeSupplementTemplateItem[]`. `Company` gains `scopeCostTemplates`, `scopeSupplementTemplates`.

Additive Prisma migration; no change to existing models/data.

## Routes & flow

1. **Catalog page** `/portal/settings/scope-template` — add two top-right buttons: **Cost Templates** → `/portal/settings/scope-cost-templates`, **Supplement Templates** → `/portal/settings/scope-supplement-templates`. (Place them next to the existing `PageHeader`, matching the Anexa header-action style.)

2. **Cost Templates list** `/portal/settings/scope-cost-templates`:
   - Back link + `PageHeader`.
   - Table: **Name · Effective Date · Status (Active/Inactive badge) · Items (count) · Open**. Each row links to the editor.
   - **Create New Cost Template** button → dialog (Name [required], Description, Effective Date [date], Status [active default]). On submit: create the template, **snapshot every `isActive` catalog item** into `ScopeCostTemplateItem` at `costPerUnitCents = 0`, then redirect to the editor.

3. **Cost Template editor** `/portal/settings/scope-cost-templates/[id]`:
   - Editable metadata card (Name, Description, Effective Date, Active toggle).
   - Catalog table grouped/ordered by category → subcategory: read-only **Category · Subcategory · Description · Unit** (from the catalog) + an editable **Cost Per Unit** ($) column. Blur-to-save per cell (same pattern as `scope-catalog-manager` / scope tables).
   - **"Add missing items"** button: inserts `ScopeCostTemplateItem` rows (at 0) for any active catalog item not already in this template.
   - Delete template (with confirm) from the editor header.

4. **Supplement Templates** `/portal/settings/scope-supplement-templates` (+ `/[id]`): mirrors the cost flow, with an **Expected Supplement Price Per Unit** column plus optional **Reason**, **Required Evidence**, **Notes** text columns per line.

## Server module (`src/server/modules/scope`)

New `template-actions.ts` (or extend the existing scope actions), all gated by `can(user, "update", "Settings")` and tenant-scoped:
- `createCostTemplateAction({ name, description, effectiveDate, isActive })` → creates template + snapshots active catalog items → returns `{ ok, id }`.
- `updateCostTemplateAction({ id, name?, description?, effectiveDate?, isActive? })`.
- `deleteCostTemplateAction(id)`.
- `updateCostTemplateItemAction({ id, costPerUnitCents })`.
- `addMissingCostTemplateItemsAction(templateId)`.
- Symmetric set for supplement templates (`updateSupplementTemplateItemAction` also accepts `reason/requiredEvidence/notes`).

New queries in `queries.ts`:
- `listCostTemplates(companyId)` (with item counts), `getCostTemplate(companyId, id)` (template + items joined to catalog, ordered).
- Symmetric for supplement.

## UI components
- `scope-cost-templates-list.tsx` / `scope-supplement-templates-list.tsx` (client; create dialog + table).
- `scope-cost-template-editor.tsx` / `scope-supplement-template-editor.tsx` (client; metadata + priced catalog table + add-missing).
- Shared small helper for the catalog table layout if it keeps both DRY (optional; don't over-abstract).

## Out of scope (later sub-projects)
- Project → Scope of Work template dropdowns and the RCV/cost/profit/supplement calculations (**sub-project 2**) — that also reworks `ScopeLine` to reference catalog items.
- The two-template comparison view (**sub-project 3**).
- Retiring the legacy `ScopeTemplateItem` model (note it as dead; clean up in #2).

## Testing
- Unit: none required (CRUD + DB); the pricing math lives in sub-project 2.
- E2E (`e2e/scope-templates.spec.ts`, new): admin creates a cost template (snapshots catalog items), edits a Cost Per Unit, reloads → price persists; the master catalog is unchanged; "Add missing items" adds a newly-added catalog row; a supplement template saves reason/evidence/notes. Respect the known pre-existing failing e2e baseline.

## Acceptance criteria
- Two buttons on the catalog page open the two new pages.
- Creating a template loads the current active catalog items as priced rows (starting at $0); editing prices persists and does **not** change the master catalog.
- Templates carry Name, Description, Effective Date, and Active/Inactive status.
- Supplement template lines additionally store Reason, Required Evidence, Notes.
- "Add missing items" tops up a template with catalog items added after it was created.
