# Call recording slots — Design

**Date:** 2026-06-14

> **Superseded in part (2026-08-01):** the Welcome Call slot was removed along
> with the rest of the welcome-call feature. Only the **QC Call** slot ships
> today; everything below describing a Welcome Call slot is historical.

## Problem

On the lead/appointment detail page's **Documents** tab, users need dedicated,
labeled places to upload a **Welcome Call** recording and a **QC Call** recording
for the customer — separate from generic document/photo attachments.

## Decisions (from brainstorming)

- **File type:** audio only (MP3 / M4A / WAV / etc.).
- **Cardinality:** one recording per slot, replaceable (re-upload swaps it).
- **Size cap:** up to ~100 MB per recording (vs. the 30 MB cap for other uploads).
- **Placement:** a new "Call Recordings" section inside the existing
  "Documents & Files" panel; download-only filters not relevant here.

## Approach

Mirror the existing Survey/Install **photo group** pattern, which tags files via
`FileAsset.category` and renders dedicated buttons. No schema/migration change —
`FileAsset.category` is already a free-text string and `leadId` already exists.

### 1. Config — `src/lib/call-groups.ts` (new)
```ts
export type CallGroup = "welcome_call" | "qc_call";
export const CALL_GROUPS: Record<CallGroup, { label: string }> = {
  welcome_call: { label: "Welcome Call" },
  qc_call: { label: "QC Call" },
};
export const CALL_GROUP_KEYS: CallGroup[] = ["welcome_call", "qc_call"];
```

### 2. Upload action — `src/server/modules/files/actions.ts`
- Detect call-slot uploads (`category` ∈ call groups).
- For those: allow audio mime types and raise the cap to 100 MB. All other
  uploads keep the existing images+PDF / 30 MB rules. Audio skips image
  compression (already gated to images).
- **Replace:** before creating a call-slot file, `deleteMany` any existing
  `FileAsset` with the same `companyId + leadId + category` so each slot holds
  exactly one recording. (DB-row delete, matching existing `deleteFileAction`
  behavior, which does not remove storage objects.)
- Fix the stale "max 15MB" error message to reflect the real limit.

### 3. UI — `src/components/portal/deal-call-recordings.tsx` (new)
- Renders two slots (Welcome Call, QC Call).
- Empty slot → "Upload recording" button (file picker `accept="audio/*"`).
- Filled slot → inline `<audio controls>` (served via `/portal/files/{id}`),
  file name, and Replace / Delete actions.
- Uploads via `uploadFileAction` with the slot's `category`; `router.refresh()`
  after success. Gated by `canUpload` / `canDelete`.

### 4. Wiring — `src/app/portal/leads/[id]/page.tsx`
- Extend the attachments filter to also exclude `CALL_GROUP_KEYS`, so call
  recordings don't appear in the generic Attachments list.
- Render `<DealCallRecordings>` inside the `FilesSection` (as part of its
  children, between Documents and Attachments), passing the filtered call files.

## Permissions

Unchanged — upload/replace/delete gated by `can(user, "create"/"update", "File")`
and the existing lead-scope visibility check in `uploadFileAction`.

## Out of scope

Multi-file per slot, video, transcription, on-screen attachment filtering.

## Files touched

- `src/lib/call-groups.ts` (new)
- `src/components/portal/deal-call-recordings.tsx` (new)
- `src/server/modules/files/actions.ts` (mime/size/replace)
- `src/app/portal/leads/[id]/page.tsx` (filter + render)
