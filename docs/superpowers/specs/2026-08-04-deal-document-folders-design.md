# Deal document folders — roofing + solar

**Date:** 2026-08-04
**Status:** Approved

## Problem

The `Documents & Files` card on a roofing deal is a flat dump: an e-signature
document list, a QC-call slot, and one undifferentiated "Attachments" pile.
Nothing tells a user where a permit, an adjuster scope, or a proof-of-income
belongs, so in practice everything lands in the same heap and nobody can find
anything.

Solar already has the *shape* of an answer — `SolarDocumentFolders` renders a
Pipe-style folder map with counts — but it is read-only. It describes folders
that you cannot open, upload into, or file anything away in.

The target is Pipe's Cloud Storage: a grid of named folders with counts, where
clicking one opens it and uploads land inside it. Roofing and solar both get it.

## Non-goals

- No nested folders. One flat level, same as Pipe.
- No new database table. `FileAsset.category` already stores a free-form string.
- No bulk multi-select move. One file at a time is enough for the volumes here.

## Taxonomy — `src/lib/deal-folders.ts`

Replaces `src/lib/solar-folders.ts`. One module, two folder sets, chosen by the
deal's vertical.

```ts
export type DealFolder = {
  key: string;
  label: string;
  hint: string;
  /** Rendered on the tile and in the open-folder header. */
  icon: IconType;
  /** Opens an existing specialised UI instead of the generic file list. */
  special?: "photos" | "calls";
  /** This folder also lists the deal's e-signature packages, above its files. */
  hostsPackages?: boolean;
};

export function foldersFor(vertical: string): DealFolder[];
export function folderKeyFor(vertical: string, category: string | null): string;
export function folderLabel(vertical: string, key: string | null): string;
```

### Roofing — 11 folders

| key | label | hint |
|---|---|---|
| `contract` | Contract | Proposals sent for signature, the signed agreement, change orders — **hosts the e-sign packages** |
| `insurance_docs` | Insurance Documents | Policy, declarations page, carrier correspondence |
| `adjuster_scope` | Adjuster Scope | Carrier scope, estimate, supplements |
| `survey` | Survey Photos | Roof, elevations, damage — the inspection set |
| `install` | Install Photos | Progress and completion |
| `materials` | Materials | Shingle spec, colour selection, material orders |
| `permits` | Permits | Applications, corrections, approvals |
| `personal_files` | Personal Files | ID, mortgage docs, W-9 |
| `invoices` | Invoices & Payments | Certificate of completion, depreciation invoice, receipts |
| `qc_call` | Call Recordings | QC call audio |
| `other` | Other | Anything that does not fit above |

### Solar — 10

The keys from `solar-folders.ts` move across verbatim: `contract`,
`utility_bill`, `personal_files`, `materials`, `survey_photos`, `engineering`,
`permits`, `interconnection`, `install_photos`, `other`. Its `internal` folder
is dropped for the reason below.

### Why these exact keys

`survey`, `install` and `qc_call` are **not new keys**. They are the category
values the photo checklists and the QC-call slot already write today. Reusing
them means every photo and recording already on a deal appears in the correct
folder the moment this ships — no backfill, no migration, no orphans.

Solar's `survey_photos` / `install_photos` keys are likewise left alone for the
same reason. The two verticals disagree on the spelling; that is fine, because
`foldersFor` never mixes the sets.

The solar folder set marks `survey_photos` / `install_photos` with
`special: "photos"` only if a solar deal actually drives the roofing photo
checklists. It does not — so on solar those two stay generic folders, and only
roofing's `survey` / `install` carry `special: "photos"`. Roofing's `qc_call`
carries `special: "calls"`.

## Component — `src/components/portal/deal-folders.tsx`

A client component with exactly two states.

### Grid state

Pipe's layout: a responsive grid of folder tiles, each showing icon, label, file
count badge and the one-line hint. Every tile looks the same — there is no
privileged or dashed-out folder. Clicking a tile opens it.

### Open state

A back control, the folder name and its hint, then content chosen by `special`:

- **generic** — photos as a thumbnail grid, documents as rows. An `Upload here`
  button posts `category=<folder key>`. Per-file delete and a **Move to…**
  picker.
- **`special: "photos"`** — the existing photo-checklist body, so slot-by-slot
  capture and *Compile PDF* survive intact.
- **`special: "calls"`** — the existing `DealCallRecordings` slot UI.

### Header upload

The card header keeps an `Upload` button. Because a file must now land
*somewhere*, it opens a small dialog with a folder `<select>` (defaulting to
**Other**) plus the file picker. This preserves the existing one-click path from
anywhere on the page without letting files escape the taxonomy.

## Filing what already exists

Every deal in production has uncategorised files. Two rules keep them reachable:

1. **Fallback.** A file whose `category` is `null`, or is not a key in this
   vertical's set, is counted and listed under **Other**. Nothing is ever
   invisible — a file is always in exactly one folder.
2. **Move.** Each file row gets a *Move to…* picker backed by a new
   `moveFileAction(fileId, category)` server action, so misfiled and legacy
   files can be put away.

`moveFileAction` mirrors `deleteFileAction`'s authorisation exactly: customers
are refused outright; a user needs `update` or `create` on `File`; and without
`update` they may only move their own uploads. It validates the target key
against `foldersFor(<the lead's vertical>)` so an arbitrary category string
cannot be injected, then revalidates the lead and project paths.

## Deal page wiring — `src/app/portal/leads/[id]/page.tsx`

The `FilesSection` invocation is replaced by a `Card` containing `<DealFolders>`,
and nothing else — no sub-headings, no second list.

- The e-signature `documentPackages` render **inside the Contract folder**,
  above its uploads, and count toward its badge. They are `DocumentPackage`
  rows with their own status and route, so they keep their own row treatment —
  but a proposal sent for signature and the countersigned PDF that comes back
  are the same thing to whoever is hunting for one, and a "Documents" heading
  sitting above a grid of document folders only ever raised the question of
  which of the two was meant.
- The `DealPhotos` header buttons are removed; the Survey and Install Photos
  folders are now their entry point.
- The solar-only `Document folders` count-card is removed; the grid replaces it.
- `solarFolderCounts` and the `SOLAR_FOLDER_KEYS` import are removed — the
  component derives its own counts from the file list.

`Card` takes `tone={isSolarDeal ? "solar" : "brand"}` so each vertical keeps its
existing visual treatment.

## Refactors

- `GroupDialog`'s body in `deal-photos.tsx` is extracted into an exported
  `PhotoGroupBody` with an `inline` flag that drops the modal-fitting scroll
  caps. `DealPhotos` and `GroupDialog` themselves are **deleted**: with the
  header buttons gone the deal page was their only consumer, so keeping the
  modal wrapper would have left dead code behind the folder it replaced.
- `DealCallRecordings` drops its own "Call Recordings" heading — the folder
  header already says so — and renders just the slot grid.
- `src/lib/solar-folders.ts` is deleted; `solar-cockpit.tsx` drops the now-unused
  `SolarDocumentFolders` export and its `SOLAR_FOLDERS` import.
- `src/components/portal/files-section.tsx` is deleted. The deal page was its
  only consumer.
- `DealFolders` carries `data-testid="deal-folders"` in both states. The deal
  page has several hidden file inputs, so an unscoped
  `input[type=file].first()` in a test grabs whichever happens to come first —
  this gives the folder card a stable anchor, matching the `data-testid`
  convention already used by the pipeline board and stage bar.

## No customer-visibility concept

There is **no `internal` folder and no customer-visibility flag**, and no folder
hint mentions a customer.

The first draft carried an "Internal Documents · Never shown to the customer"
folder, on the assumption that a customer portal would arrive later. That
assumption was wrong in a way worth recording: the `customer` role cannot even
sign in — `src/server/auth/config.ts` rejects it alongside `disabled` and
`suspended`, and `session.ts` does the same — and no `/portal/customer` route
exists. So there is no customer-facing surface anywhere in the app.

Which makes the label actively misleading rather than merely premature: marking
one folder "internal" implies the other ten are visible to a homeowner, and
none of them are. Every folder is staff-only. A unit test asserts no folder key,
label, or hint contains "customer" or "internal" so the idea cannot creep back
without a decision.

The two vestigial `revalidatePath("/portal/customer")` calls in the file actions
are removed for the same reason — they revalidated a route that does not exist.

If a customer portal is ever built, per-folder visibility is a real design
question to answer then, against a surface that actually exists.

File *access* is unchanged: `/portal/files/[id]` already enforces company scope,
vertical isolation and per-role deal scope, and folders do not touch it.

## Testing

**Unit — `src/lib/__tests__/deal-folders.test.ts`**
- `foldersFor("roofing")` and `foldersFor("solar")` return their sets, and the
  sets have disjoint responsibilities where they overlap in label.
- Both sets contain an `other` key — the fallback is a structural guarantee.
- No folder key, label, or hint mentions "customer" or "internal".
- Exactly one folder per set hosts the e-sign packages.
- Folder keys within a set are unique.
- `folderLabel` returns `Other` for `null` and for an unknown key.

**E2E — `e2e/documents-folders.spec.ts` (new)**
- A roofing deal renders the folder grid with the roofing labels.
- Clicking `Other` opens it; uploading a PDF there lands it in that folder and
  the count increments.
- Moving that file to `Contract` empties `Other` and fills `Contract`.

**E2E — updates to existing specs**
- `e2e/photos.spec.ts` — the Survey/Install entry point is now a folder tile,
  not a header button. The spec navigates through the tile and the capture and
  *Compile PDF* assertions still hold, which is what proves the extraction
  preserved behaviour. Two assertions were loosened for a reason that predates
  this work: whether the checklist or the bulk uploader renders depends on
  whether the deal reached production, and the deal this spec picks is not
  fixed across runs. It now accepts either path's toast and either route's
  group parameter (`site` for the checklist, `survey` for bulk) rather than
  hard-coding the one the seed happened to produce. This test was already
  failing on the baseline for exactly that reason; it passes now.
- `e2e/appointment-form.spec.ts` — the staged attachment is uncategorised, so it
  now lands in **Other**. The spec opens that folder before asserting the
  filename is visible.
- `e2e/crm-ops.spec.ts` — `openProductionDeal` looked for "Start production"
  while the Claim Info slide was showing. That button lives *inside* the Field
  Production slide, so `isVisible()` always answered false and the helper never
  actually started production. The test still passed because its
  page-wide `input[type=file].first()` was landing on the old Documents & Files
  header input, not on the photo checklist its own comment describes. With that
  input gone the accident stopped working, so the helper now opens the slide
  first and the upload is scoped to `[data-deal-slide="field"]`.

## Risks

- **Everything starts in Other.** On day one every existing deal shows its whole
  file list under one folder. This is the honest outcome of introducing a
  taxonomy retroactively; the *Move to…* picker is the remedy, and new uploads
  file themselves correctly from the start.
- **Photo checklist regression.** Extracting `PhotoGroupBody` is the only change
  touching working production code paths. The unchanged `photos.spec.ts`
  assertions are the guard.
