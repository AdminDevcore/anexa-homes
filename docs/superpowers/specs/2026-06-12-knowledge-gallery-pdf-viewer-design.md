# Knowledge Base Gallery + Protected PDF Viewer — Design

**Date:** 2026-06-12
**Route affected:** `/portal/knowledge`
**Type:** Frontend-focused enhancement. No DB schema change, no new storage, no data migration.

## Goal

Two user-requested changes to the Knowledge Base & Training page:

1. **Gallery view** — display training materials as a grid of visual cards instead of plain rows.
2. **Protected PDF viewing** — PDFs (already uploadable today as `type="file"`) should be readable inside the app but not casually downloadable.

## Background (current state)

- Page: `src/app/portal/knowledge/page.tsx` (server) → `src/components/portal/knowledge-client.tsx` (client).
- Data model (unchanged by this work): `KnowledgeCategory` and `KnowledgeItem` in `prisma/schema.prisma`. Item types: `file | video | link | article`.
- Files stream from `src/app/portal/knowledge/items/[id]/file/route.ts` with `Content-Disposition: inline` and a per-request role/visibility auth check.
- A `pdf.js`-based renderer already exists: `src/components/esign/pdf-canvas.tsx` (`PdfCanvas({ url, page, className })`), worker at `/public/pdf.worker.min.mjs`.
- Items currently render as rows with a Read/Open/Watch button. Management roles (`super_admin`, `admin`, `manager`) get inline edit/delete.

## Requirements

### 1. Gallery layout
- Keep each category section exactly as-is at the header level: name, description, role badges, and the Add/edit/delete controls (management only).
- Replace the per-item **row list** inside a category with a **responsive card grid**: ~4 columns desktop, 2 tablet, 1 mobile.
- Each card has:
  - **Thumbnail area (top):**
    - PDF items → first page rendered via `PdfCanvas`, **lazily** (render only when the card scrolls into view, so a category with many PDFs does not mount many canvases at once). Show a lightweight placeholder until rendered.
    - Non-PDF items (`video`, `link`, `article`, and non-PDF `file` types like docx/xlsx/images) → a clean colored cover showing the existing type icon (`TYPE_META`).
  - **Footer (bottom):** title, type badge, short (truncated) description, and the action button.
- Action button per type (behavior preserved except PDFs):
  - PDF file → **View** (opens protected viewer modal, see §2).
  - Non-PDF file → **Open** (current streaming behavior).
  - `video` → **Watch** (current behavior).
  - `link` → **Open** (current external link behavior).
  - `article` → **Read** (current inline article modal).
- Management users keep edit/delete, surfaced on card hover (e.g. top-right overlay).
- Search/filter behavior is preserved; filtering simply changes which cards render.

### 2. Protected PDF viewer
- New full-screen modal viewer component, reusing `PdfCanvas` to render each page to canvas (not the browser's native PDF plugin).
- Features: multi-page (scroll or page nav), basic zoom, page indicator.
- **Download deterrents:**
  - No download button, no print control.
  - Right-click / context menu disabled within the viewer surface.
  - The raw `/portal/knowledge/items/[id]/file` URL is **not** surfaced as a link anywhere in the PDF UI; the viewer fetches bytes through `pdf.js` only.
- **Explicit non-goal / honest caveat:** This is a strong deterrent, **not DRM**. The stream route still exists and re-checks auth per request; a determined user could hit it directly or screenshot. True extraction-proofing (watermarking + DRM) is out of scope per user decision.

### 3. Detecting "is this a PDF"
- An item is treated as a PDF when `type === "file"` and it has a file whose MIME type is `application/pdf` (or `.pdf` extension). The client needs to know the item's MIME type to branch on PDF vs non-PDF.
- The list query/serializer should expose the item's file MIME type (or a boolean `isPdf`) to the client so cards can branch without an extra round trip. (Currently the client only knows `hasFile`, not the MIME type — this is the one small data-shape addition, surfaced from existing `FileAsset.mimeType`; no schema change.)

## Approach decision

**Client-side, lazy PDF thumbnails via the existing `PdfCanvas`** (chosen).
- Pros: no backend changes, no new stored thumbnail files, no migration, no backfill for existing PDFs, reuses proven `pdf.js` setup.
- Cons: thumbnails render in the browser (mitigated by lazy/in-view rendering + placeholders).

Rejected alternative: server-side thumbnail generation on upload. Adds storage, a schema field, an upload-path change, and a backfill for existing items — marginal gain over lazy client rendering.

## Out of scope
- No changes to roles, category visibility, upload limits, or the data model (beyond surfacing existing `mimeType` to the client).
- Non-PDF files, videos, links, and articles keep their current open/watch/read behavior — only their presentation becomes a card.
- No watermarking / DRM.

## Components touched / added
- **Modified:** `src/components/portal/knowledge-client.tsx` — row list → card grid; wire PDF cards to the new viewer.
- **Added:** a lazy PDF-thumbnail card piece (in-view rendering wrapper around `PdfCanvas`).
- **Added:** a protected PDF viewer modal component (reuses `PdfCanvas`).
- **Modified (small):** the knowledge list query/serializer (`src/server/modules/knowledge/queries.ts` and the page's data mapping) to expose file MIME type / `isPdf` per item.

## Testing
- Extend `e2e/knowledge.spec.ts`:
  - Cards render in a grid for a category that has items.
  - A PDF item shows a **View** action and opens the in-app viewer modal; the viewer exposes no download/print control.
  - Non-PDF behaviors (article Read, link Open, video Watch) still work from cards.
  - Role visibility unchanged (existing assertions continue to pass).
- Respect known pre-existing failing e2e specs (do not attribute them to this change).
