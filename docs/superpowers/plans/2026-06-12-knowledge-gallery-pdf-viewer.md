# Knowledge Base Gallery + Protected PDF Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Knowledge Base item list into a card gallery with PDF first-page thumbnails, and let PDFs be read in an in-app viewer that has no download/print controls.

**Architecture:** Frontend-focused. Reuse the existing `pdf.js` renderer (`src/components/esign/pdf-canvas.tsx`) for both lazy thumbnails and a full-screen viewer modal. The only server touch is surfacing each file item's MIME type (already stored on `FileAsset`) so the client can branch PDF vs non-PDF. No schema change, no migration, no new storage.

**Tech Stack:** Next.js (App Router, server components), React client components, Prisma, `pdfjs-dist`, Tailwind, shadcn/radix UI, lucide-react icons, vitest (unit, node env), Playwright (e2e).

---

## File structure

- **Create:** `src/lib/knowledge.ts` — tiny pure helper `isPdfMime(mime)`. One responsibility: decide if a MIME type is a PDF. Unit-testable in node.
- **Create:** `src/lib/__tests__/knowledge.test.ts` — unit tests for `isPdfMime`.
- **Modify:** `src/components/esign/pdf-canvas.tsx` — add optional `hideOpenLink` prop (hide the raw-URL fallback link) and export `getPdfNumPages(url)` (reuses the lazy worker setup).
- **Modify:** `src/server/modules/knowledge/queries.ts` — `listKnowledge` also returns `fileMime` per item (batch `FileAsset` lookup; `fileId` is a plain column, not a relation).
- **Modify:** `src/app/portal/knowledge/page.tsx` — pass a derived `isPdf` boolean to the client per item.
- **Modify:** `src/components/portal/knowledge-client.tsx` — replace the `ItemRow` list with a responsive card grid; add `ItemCard`, `PdfThumb` (lazy/in-view), and `PdfViewerModal`; extend the `Item` type with `isPdf`.
- **Modify:** `e2e/knowledge.spec.ts` — add coverage for the gallery rendering and the article "Read" action from a card.

---

### Task 1: Pure PDF-MIME helper (TDD)

**Files:**
- Create: `src/lib/knowledge.ts`
- Test: `src/lib/__tests__/knowledge.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/knowledge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isPdfMime } from "../knowledge";

describe("isPdfMime", () => {
  it("is true for application/pdf", () => {
    expect(isPdfMime("application/pdf")).toBe(true);
  });

  it("is true with a charset suffix and odd casing", () => {
    expect(isPdfMime("Application/PDF; charset=binary")).toBe(true);
  });

  it("is false for non-pdf types", () => {
    expect(isPdfMime("image/png")).toBe(false);
    expect(isPdfMime("application/vnd.ms-powerpoint")).toBe(false);
  });

  it("is false for null/undefined/empty", () => {
    expect(isPdfMime(null)).toBe(false);
    expect(isPdfMime(undefined)).toBe(false);
    expect(isPdfMime("")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/__tests__/knowledge.test.ts`
Expected: FAIL — cannot find module `../knowledge` (or `isPdfMime` is not a function).

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/knowledge.ts`:

```ts
/** True when a stored file's MIME type is a PDF. Tolerates casing and `; charset=…` suffixes. */
export function isPdfMime(mime: string | null | undefined): boolean {
  return (mime ?? "").trim().toLowerCase().startsWith("application/pdf");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/__tests__/knowledge.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/knowledge.ts src/lib/__tests__/knowledge.test.ts
git commit -m "feat(knowledge): add isPdfMime helper with tests"
```

---

### Task 2: Surface file MIME type from the list query

**Files:**
- Modify: `src/server/modules/knowledge/queries.ts:7-15`

`fileId` is a plain column (no Prisma relation), so we resolve MIME types in one batched `FileAsset` query and attach `fileMime` to each item.

- [ ] **Step 1: Replace the `listKnowledge` function body**

Replace the whole `listKnowledge` function (currently lines 7-15) with:

```ts
/** Categories (with items) visible to `user` in the active `industry` workspace. */
export async function listKnowledge(user: AccessUser, industry: Industry) {
  const categories = await prisma.knowledgeCategory.findMany({
    where: categoryScope(user, industry),
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: {
      items: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
    },
  });

  // fileId is a plain column (no relation), so resolve MIME types in one batch.
  const fileIds = categories.flatMap((c) =>
    c.items.map((i) => i.fileId).filter((id): id is string => !!id)
  );
  const files = fileIds.length
    ? await prisma.fileAsset.findMany({
        where: { id: { in: fileIds }, companyId: user.companyId },
        select: { id: true, mimeType: true },
      })
    : [];
  const mimeById = new Map(files.map((f) => [f.id, f.mimeType] as const));

  return categories.map((c) => ({
    ...c,
    items: c.items.map((i) => ({
      ...i,
      fileMime: i.fileId ? mimeById.get(i.fileId) ?? null : null,
    })),
  }));
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run typecheck`
Expected: PASS (no new errors). `page.tsx` still compiles because it reads only existing fields for now.

- [ ] **Step 3: Commit**

```bash
git add src/server/modules/knowledge/queries.ts
git commit -m "feat(knowledge): include file MIME type in listKnowledge"
```

---

### Task 3: Pass `isPdf` to the client

**Files:**
- Modify: `src/app/portal/knowledge/page.tsx:7` (imports) and `:39-47` (item map)

- [ ] **Step 1: Add the helper import**

After the existing `import { roleLabel } from "@/lib/roles";` line (line 7), add:

```ts
import { isPdfMime } from "@/lib/knowledge";
```

- [ ] **Step 2: Add `isPdf` to the mapped item**

In the `items: c.items.map((i) => ({ ... }))` block, add an `isPdf` field after `hasFile`:

```ts
          items: c.items.map((i) => ({
            id: i.id,
            type: i.type,
            title: i.title,
            description: i.description,
            url: i.url,
            body: i.body,
            hasFile: !!i.fileId,
            isPdf: i.type === "file" && isPdfMime(i.fileMime),
          })),
```

- [ ] **Step 3: Verify it type-checks**

Run: `npm run typecheck`
Expected: One error in `knowledge-client.tsx` is acceptable ONLY if it relates to the `isPdf` prop not yet existing on the `Item` type — that is fixed in Task 5. If you prefer a green checkpoint, do Task 5 before re-running. Otherwise expect PASS for `page.tsx` itself.

- [ ] **Step 4: Commit**

```bash
git add src/app/portal/knowledge/page.tsx
git commit -m "feat(knowledge): pass isPdf flag to the gallery client"
```

---

### Task 4: Extend `PdfCanvas` for the protected viewer

**Files:**
- Modify: `src/components/esign/pdf-canvas.tsx`

Add a `hideOpenLink` prop (so thumbnails and the protected viewer never surface the raw file URL) and export `getPdfNumPages` (so the viewer can render every page).

- [ ] **Step 1: Add `getPdfNumPages` export**

Immediately after the `loadPdfjs()` function (after its closing `}` on line 20), add:

```ts
/** Loads a PDF (reusing the lazy worker setup) and returns its page count. */
export async function getPdfNumPages(url: string): Promise<number> {
  const pdfjsLib = await loadPdfjs();
  const pdf = await pdfjsLib.getDocument({ url }).promise;
  return pdf.numPages;
}
```

- [ ] **Step 2: Add the `hideOpenLink` prop to the signature**

Change the component signature (line 23) from:

```ts
export function PdfCanvas({ url, page, className }: { url: string; page: number; className?: string }) {
```

to:

```ts
export function PdfCanvas({
  url,
  page,
  className,
  hideOpenLink = false,
}: {
  url: string;
  page: number;
  className?: string;
  hideOpenLink?: boolean;
}) {
```

- [ ] **Step 3: Gate the fallback "Open the PDF" link**

In the error branch of the render (the `<>...</>` containing `Open the PDF`), wrap the anchor so it is hidden when `hideOpenLink` is set. Replace:

```tsx
              <AlertCircle className="size-5 text-destructive" />
              <span>Couldn&rsquo;t render the PDF preview.</span>
              <a href={url} target="_blank" rel="noreferrer" className="text-gold-muted underline">
                Open the PDF
              </a>
```

with:

```tsx
              <AlertCircle className="size-5 text-destructive" />
              <span>Couldn&rsquo;t render the PDF preview.</span>
              {!hideOpenLink && (
                <a href={url} target="_blank" rel="noreferrer" className="text-gold-muted underline">
                  Open the PDF
                </a>
              )}
```

- [ ] **Step 4: Verify it type-checks**

Run: `npm run typecheck`
Expected: PASS for this file (existing `PdfCanvas` callers omit `hideOpenLink`, which is optional).

- [ ] **Step 5: Commit**

```bash
git add src/components/esign/pdf-canvas.tsx
git commit -m "feat(pdf): add hideOpenLink prop and getPdfNumPages helper"
```

---

### Task 5: Gallery cards + protected PDF viewer in the client

**Files:**
- Modify: `src/components/portal/knowledge-client.tsx`

This is the main task. We: (a) extend imports and the `Item` type, (b) switch the category body to a card grid, (c) add `PdfThumb`, `ItemCard`, and `PdfViewerModal`, and (d) delete the old `ItemRow`.

- [ ] **Step 1: Update imports**

Replace the lucide-react import block (lines 6-19) with this (adds `Eye`; `PdfCanvas`/`getPdfNumPages` are imported separately below). The viewer's close button comes from `DialogContent` itself, so no extra icon is needed:

```tsx
import {
  Plus,
  Search,
  FileText,
  PlayCircle,
  Link2,
  BookOpen,
  Pencil,
  Trash2,
  Loader2,
  Download,
  ExternalLink,
  GraduationCap,
  Eye,
} from "lucide-react";
```

Then, immediately after the existing `import { EmptyState } from "@/components/portal/ui";` line, add:

```tsx
import { PdfCanvas, getPdfNumPages } from "@/components/esign/pdf-canvas";
```

- [ ] **Step 2: Add `isPdf` to the `Item` type**

Change the `Item` type (lines 52-60) to include `isPdf`:

```tsx
type Item = {
  id: string;
  type: ItemType;
  title: string;
  description: string | null;
  url: string | null;
  body: string | null;
  hasFile?: boolean;
  isPdf?: boolean;
};
```

- [ ] **Step 3: Switch the category body to a card grid**

In `CategoryCard`, replace the items container (currently lines 230-238, the `<div className="divide-y divide-border/60">…</div>` block) with:

```tsx
      <div className="p-4">
        {category.items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No materials in this category yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {category.items.map((item) => (
              <ItemCard key={item.id} item={item} canManage={canManage} />
            ))}
          </div>
        )}
      </div>
```

- [ ] **Step 4: Replace `ItemRow` with `ItemCard` + `PdfThumb` + `PdfViewerModal`**

Delete the entire `ItemRow` function (currently lines 255-345) and replace it with the following three components:

```tsx
/** Lazily renders the first page of a PDF as a cover thumbnail once scrolled into view. */
function PdfThumb({ url }: { url: string }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  return (
    <div
      ref={ref}
      className="relative aspect-[4/3] w-full overflow-hidden border-b border-border bg-muted"
    >
      {visible ? (
        <PdfCanvas url={url} page={1} className="block w-full" hideOpenLink />
      ) : (
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <FileText className="size-8" />
        </div>
      )}
    </div>
  );
}

/** Full-screen, read-only PDF viewer. No download/print; right-click and selection disabled. */
function PdfViewerModal({
  open,
  onOpenChange,
  url,
  title,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  url: string;
  title: string;
}) {
  const [numPages, setNumPages] = React.useState(0);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setNumPages(0);
    getPdfNumPages(url)
      .then((n) => {
        if (!cancelled) setNumPages(n);
      })
      .catch(() => {
        /* PdfCanvas shows its own error state */
      });
    return () => {
      cancelled = true;
    };
  }, [open, url]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-4xl"
        onContextMenu={(e) => e.preventDefault()}
      >
        <DialogHeader className="border-b border-border px-5 py-3">
          <DialogTitle className="truncate pr-8">{title}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[calc(92vh-3.5rem)] select-none space-y-4 overflow-y-auto bg-muted/40 p-4">
          {numPages === 0 ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
            </div>
          ) : (
            Array.from({ length: numPages }, (_, i) => (
              <div
                key={i}
                className="relative mx-auto aspect-[8.5/11] w-full max-w-3xl bg-white shadow-sm"
              >
                <PdfCanvas url={url} page={i + 1} className="block w-full" hideOpenLink />
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ItemCard({ item, canManage }: { item: Item; canManage: boolean }) {
  const router = useRouter();
  const [editOpen, setEditOpen] = React.useState(false);
  const [articleOpen, setArticleOpen] = React.useState(false);
  const [pdfOpen, setPdfOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const Meta = TYPE_META[item.type];
  const fileHref = `/portal/knowledge/items/${item.id}/file`;
  const isPdf = item.type === "file" && !!item.isPdf;

  async function remove() {
    if (!confirm(`Delete “${item.title}”?`)) return;
    setBusy(true);
    const res = await deleteItemAction(item.id);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Item deleted.");
    router.refresh();
  }

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-sm">
      {/* Thumbnail */}
      {isPdf ? (
        <PdfThumb url={fileHref} />
      ) : (
        <div className="flex aspect-[4/3] w-full items-center justify-center border-b border-border bg-muted text-muted-foreground">
          <Meta.icon className="size-10" />
        </div>
      )}

      {/* Management controls, on hover */}
      {canManage && (
        <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <Button size="icon" variant="secondary" onClick={() => setEditOpen(true)} aria-label="Edit item">
            <Pencil className="size-4" />
          </Button>
          <Button size="icon" variant="secondary" onClick={remove} disabled={busy} aria-label="Delete item">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          </Button>
        </div>
      )}

      {/* Footer */}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 font-medium leading-tight">{item.title}</h3>
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {Meta.label}
          </Badge>
        </div>
        {item.description && (
          <p className="line-clamp-2 text-sm text-muted-foreground">{item.description}</p>
        )}

        <div className="mt-auto pt-1">
          {isPdf && (
            <Button size="sm" variant="outline" className="w-full" onClick={() => setPdfOpen(true)}>
              <Eye className="size-4" /> View
            </Button>
          )}
          {item.type === "file" && !isPdf && (
            <Button asChild size="sm" variant="outline" className="w-full">
              <a href={fileHref} target="_blank" rel="noopener noreferrer">
                <Download className="size-4" /> Open
              </a>
            </Button>
          )}
          {item.type === "video" && (item.url || item.hasFile) && (
            <Button asChild size="sm" variant="outline" className="w-full">
              <a href={item.url || fileHref} target="_blank" rel="noopener noreferrer">
                {item.url ? <ExternalLink className="size-4" /> : <PlayCircle className="size-4" />} Watch
              </a>
            </Button>
          )}
          {item.type === "link" && item.url && (
            <Button asChild size="sm" variant="outline" className="w-full">
              <a href={item.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" /> Open
              </a>
            </Button>
          )}
          {item.type === "article" && (
            <Button size="sm" variant="outline" className="w-full" onClick={() => setArticleOpen(true)}>
              <BookOpen className="size-4" /> Read
            </Button>
          )}
        </div>
      </div>

      {/* Modals */}
      {item.type === "article" && (
        <Dialog open={articleOpen} onOpenChange={setArticleOpen}>
          <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{item.title}</DialogTitle>
              {item.description && <DialogDescription>{item.description}</DialogDescription>}
            </DialogHeader>
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{item.body}</div>
          </DialogContent>
        </Dialog>
      )}
      {isPdf && (
        <PdfViewerModal open={pdfOpen} onOpenChange={setPdfOpen} url={fileHref} title={item.title} />
      )}
      {canManage && <ItemDialog open={editOpen} onOpenChange={setEditOpen} item={item} />}
    </div>
  );
}
```

- [ ] **Step 5: Verify it type-checks and lints**

Run: `npm run typecheck && npm run lint`
Expected: PASS. If lint flags an unused import, remove only the genuinely unused one (all of `FileText`, `Download`, `Eye`, `ExternalLink`, `PlayCircle`, `BookOpen` are used by `ItemCard`/`PdfThumb`/`TYPE_META`).

- [ ] **Step 6: Commit**

```bash
git add src/components/portal/knowledge-client.tsx
git commit -m "feat(knowledge): gallery cards with PDF thumbnails and protected viewer"
```

---

### Task 6: E2E coverage for the gallery

**Files:**
- Modify: `e2e/knowledge.spec.ts`

The seed has no PDF item, so we cannot e2e the PDF viewer end-to-end without new seed data. We DO assert the gallery renders and the article "Read" action works from a card. (Manual PDF verification is Task 7.)

- [ ] **Step 1: Add a gallery rendering + article-read test**

Append this test to the end of `e2e/knowledge.spec.ts` (before the final newline):

```ts
test("sales rep can read an article from its gallery card", async ({ page }) => {
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/knowledge");

  // The article appears as a card with a Read action.
  await expect(page.getByText("Door Approach Script")).toBeVisible();
  const card = page
    .locator("div")
    .filter({ hasText: "Door Approach Script" })
    .filter({ has: page.getByRole("button", { name: "Read" }) })
    .last();
  await card.getByRole("button", { name: "Read" }).click();

  // The article dialog opens with its body text.
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Door Approach Script" })).toBeVisible();
  await expect(dialog.getByText(/free 15-minute inspection/i)).toBeVisible();

  await page.context().clearCookies();
});
```

- [ ] **Step 2: Run the knowledge e2e suite**

Run: `npm run e2e -- knowledge`
Expected: The three original tests still pass (text-based assertions survive the card refactor) plus the new test passes. If the local DB/app is not running, start it per the project's e2e setup first; do not count environment-setup failures as test failures.

- [ ] **Step 3: Commit**

```bash
git add e2e/knowledge.spec.ts
git commit -m "test(knowledge): gallery card render + article read e2e"
```

---

### Task 7: Full verification + manual PDF check

**Files:** none (verification only)

- [ ] **Step 1: Run the full static gate**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: All PASS.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Manual PDF verification (use the `verify` / webapp-testing skill)**

Start the dev server, log in as `admin@anexahomes.com`, go to `/portal/knowledge`. Then:
1. Add a new `File` item with a real `.pdf` to any category.
2. Confirm its card shows a **first-page thumbnail** and a **View** button (not "Open"/"Download").
3. Click **View** → the in-app viewer opens, renders all pages, and has **no download or print button**; right-click inside it shows no browser context menu.
4. Confirm non-PDF items (article "Read", link "Open") still behave as before.

Capture a screenshot of the gallery and the open viewer as evidence.

- [ ] **Step 4: Finish the branch**

Use the superpowers:finishing-a-development-branch skill to decide how to integrate (the work is on `feat/white-label-brand-identity`).

---

## Notes / known tradeoffs

- **Deterrent, not DRM (by design):** PDFs render to canvas and no UI links the raw `/portal/knowledge/items/[id]/file` stream, but that auth-checked route still exists. A determined user could call it directly or screenshot. This matches the agreed scope; true extraction-proofing (watermark + DRM) is explicitly out of scope.
- **Viewer reloads the document per page** via `PdfCanvas` (plus one `getPdfNumPages` call). The file route sets `Cache-Control: private, max-age=60`, so refetches hit the browser cache; parsing repeats but is fine for typical training PDFs. If a very large/long PDF becomes a problem later, make `PdfViewerModal` mount pages lazily with the same `IntersectionObserver` pattern as `PdfThumb`.
- **No schema/migration:** `fileMime` is derived at query time from the existing `FileAsset.mimeType`; nothing is persisted.
