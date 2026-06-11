# Knowledge Base / Training — Design

**Date:** 2026-06-11
**Status:** Approved (user: "surprise me" — open decisions resolved by author)

## Goal
Add a **Knowledge Base / Training** section to the portal sidebar where Admins and
Managers upload training materials (PDFs, videos, links, articles) and organize them
into categories whose visibility is gated **by role** — so Sales Reps see only Sales
Rep training, Installers see only Installer training, etc.

## Decisions
- **Visibility model:** per-category, by role. Each category carries a `visibleRoles`
  array; a non-management user sees a category only if their role is listed.
- **Content types:** file upload (PDF/doc/image), video (embed URL), external link,
  rich-text article.
- **Who manages:** `super_admin`, `admin`, `manager` (full manage). Everyone else is
  read-only.
- **Tracking:** none for now — simple library (views/acknowledgement deferred).
- **Audience:** staff only. Customers are excluded entirely (no RBAC grant).
- **Management visibility:** management roles see/manage **all** categories regardless
  of `visibleRoles`.
- **Industry scoping:** categories belong to an `industry` workspace (roofing/solar/
  water), consistent with every other module; the list is filtered to the active
  workspace.

## Data model (Prisma)
```
enum KnowledgeItemType { file video link article }

model KnowledgeCategory {
  id, companyId, industry, name, description?, position
  visibleRoles  Role[]
  items         KnowledgeItem[]
  createdAt, updatedAt        // @@index([companyId, industry])
}

model KnowledgeItem {
  id, companyId, categoryId, position
  type      KnowledgeItemType
  title, description?
  fileId?   -> FileAsset      // type=file
  url?                        // type=video (embed) | link
  body?     @db.Text          // type=article
  createdById, createdAt, updatedAt   // @@index([companyId, categoryId])
}
```
Uploaded files reuse `FileAsset` (kind=document) + existing storage/compression.

## Visibility enforcement (server-side)
- `knowledge/policies.ts` `categoryScope(user)`:
  - management roles → `{ companyId, industry }` (all categories)
  - other staff → `{ companyId, industry, visibleRoles: { has: role } }`
- **File bytes** are served by a dedicated route `/portal/knowledge/items/[id]/file`
  that re-checks the item's category against `categoryScope` before streaming — a rep
  cannot fetch installer-only training even with a guessed ID.

## RBAC
New `Knowledge` resource. `manage` → super_admin/admin/manager. `read` →
sales_rep/canvasser/marketing/installer/accounting. none → customer.

## UI
- Sidebar item **"Knowledge Base"** (BookOpen icon) → `/portal/knowledge`
  (between Documents and Commissions), shown via `can(read, Knowledge)`.
- Page: visible categories as sections; items render per type (file → view link,
  video → iframe embed, link → external anchor, article → readable text). A search
  box filters items client-side.
- Managers/admins get: New Category (name + description + role multi-select), Add Item
  (type picker, with file upload / URL / article body), edit & delete.

## Module / files
- `src/server/modules/knowledge/{policies,queries,actions}.ts`
- `src/app/portal/knowledge/page.tsx` + `components/portal/knowledge-client.tsx`
- `src/app/portal/knowledge/items/[id]/file/route.ts`
- nav + matrix + schema edits; seed categories; e2e spec.

## Seed
- "Sales Rep Training" (visibleRoles=[sales_rep]) with an article + link + sample item.
- "Installer Training" (visibleRoles=[installer]).
- "Company-Wide" (all staff roles).
Makes role-gating demonstrable and testable.

## Tests (e2e)
- A sales rep sees "Sales Rep Training" and "Company-Wide" but NOT "Installer Training".
- An admin sees all categories and can create a new one.
