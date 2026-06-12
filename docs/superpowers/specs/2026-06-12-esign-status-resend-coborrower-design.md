# E-Signature: Status Visibility, Resend, and Co-Borrower Sending

**Date:** 2026-06-12
**Status:** Approved (pending spec review)
**Area:** `src/app/portal/documents`, `src/components/esign`, `src/server/modules/esign`

## Problem

On `/portal/documents`, staff sending contracts for signature cannot tell what
state a contract is in. Three concrete gaps:

1. **No status visibility on the list.** Each "Sent for Signature" row shows a
   single grey package-level badge (e.g. "Sent") and a signer count. There is no
   way to see, at a glance, who has viewed, who has signed, or whether a
   co-borrower has acted — you must open each document's detail page.
2. **No resend.** There is no way to re-send a signing request/reminder. The
   backend has the pieces (`reminder_sent` audit event type, token re-issue
   logic in `getSigningLinkForUser`) but no action or button exists.
3. **Co-borrower cannot actually be added.** The Send dialog
   (`send-document-dialog.tsx`) hardcodes exactly one signer
   (`role: "customer", order: 1`). The schema/service fully support multiple
   signers with roles and ordering, but the UI never exposes them — so the
   co-borrower status the user wants to see can't be produced today.

Additionally, signing links are **never auto-emailed** to signers. The
notification engine (`fireEvent`) only notifies internal staff; the customer's
link is shown to staff to copy/paste manually.

## Goals

- See real signing status (overall + per-signer) directly on the documents list.
- Add a **Resend** action that re-issues a fresh link, emails it to each
  not-yet-signed signer, and records an audit event.
- Let staff add a **co-borrower** and an optional **company rep** when sending.
- **Auto-email** signing links on the initial send (in addition to showing
  copyable links).

## Non-Goals (explicit)

- SMS reminders.
- Scheduled / automatic reminder cadence (resend is manual, on-demand).
- Decline-reason capture UI.
- Changing the audit-trail / PDF / finalization logic.

## Decisions (confirmed with user)

| Decision | Choice |
| --- | --- |
| Resend delivery | Email the link **and** show copyable links in a dialog |
| Resend link security | **Replace** — issue a fresh token, invalidate the old link |
| List status detail | **Per-signer chips + "signed X of N" summary** |
| Co-borrower in Send dialog | **In scope now** (co-borrower + optional company rep) |
| Initial send email | **Auto-email** signers on send too (plus copyable links) |
| Signing order | Customer + co-borrower may sign in **either order**; company rep counter-signs **last** |

## Design

### Component 1 — Multi-signer Send dialog
**File:** `src/components/esign/send-document-dialog.tsx`

- Keep the primary **customer** signer (prefilled from the selected lead).
- Add **"+ Add co-borrower"** → second signer (name + email), `role: "co_customer"`.
- Add **"+ Add company rep"** → optional signer (name + email), `role: "company_rep"`.
- Each added signer is removable before sending.
- **Order assignment** (computed at submit):
  - `customer` → `order: 1`
  - `co_customer` → `order: 1` (parallel — does not block the customer)
  - `company_rep` → `order: 2` (counter-signs after both customers)
- Submit passes the full `signers[]` array to `sendDocumentAction` (already
  accepts an array; only the dialog hardcodes one entry today).
- Confirmation view lists **one copyable link per signer** (existing pattern),
  and notes which were emailed.

The existing send `actions.ts` / `service.ts` already validate and persist a
`signers[]` array, so no schema change is needed here.

### Component 2 — Status on the documents list
**Files:** `src/app/portal/documents/page.tsx`, new
`src/components/esign/signature-status-badge.tsx`

- Extract a shared **`SignatureStatusBadge`** (client-free, pure) mapping a
  status string → label + color classes. Reused by the list and the detail page.
  - `completed`, `signed` → green
  - `partially_signed`, `viewed` → amber / blue
  - `sent`, `pending` → grey
  - `voided`, `declined`, `expired` → red
- Each list row (`page.tsx` already includes `signers`) renders:
  - The color-coded **overall** package badge.
  - A **"signed X of N"** summary derived from
    `signers.filter(s => s.status === "signed").length` / `signers.length`.
  - **Per-signer chips**: `name` + role label (e.g. "co-borrower") + per-signer
    status badge. Long signer lists wrap.
- `data-search-text` on the row is extended to include signer names/statuses so
  the existing `ListFilter` search still matches.
- The detail page (`[id]/page.tsx`) swaps its inline badges for the shared
  `SignatureStatusBadge` for consistency (no behavior change).

### Component 3 — Resend action
**Files:** `src/server/modules/esign/service.ts` (new `resendSignatureRequest`),
`src/server/modules/esign/actions.ts` (new `resendDocumentAction`),
new `src/components/esign/resend-button.tsx` (client).

`resendSignatureRequest(user, packageId)`:
1. `requireCan(user, "create", "Document")` — same permission as sending.
2. Load the package scoped to `user.companyId` with its signers + lead/company.
3. Reject if `status` is `completed` or `voided` (nothing to resend).
4. For each signer with `status !== "signed"` and `status !== "declined"`:
   - Generate a new token (`generateSignerToken`), update `tokenHash`
     (invalidates the old link).
   - If the signer has an email, send via existing `sendEmail` helper —
     subject *"Reminder: please sign {title}"*, body containing the fresh
     `/sign/{token}` link, `fromName` = company name.
   - Append a **`reminder_sent`** `DocumentEvent` (via `appendDocumentEvent`,
     preserving the hash chain), `signerId` set, `actor` = staff user.
5. Return `{ links: [{ name, url }] }` for the not-yet-signed signers.

`resendDocumentAction(packageId)`:
- Thin server action wrapper; `revalidatePath("/portal/documents")` and the
  detail path; returns `{ ok, links }` or `{ ok: false, error }`.

`ResendButton` (client):
- Shown on list rows and the detail header **only** when status ∈
  {`sent`, `viewed`, `partially_signed`}.
- On click → calls the action → opens a dialog with the fresh copyable links
  (reusing the send-dialog copy pattern) and a "Reminder emailed" toast.

### Component 4 — Auto-email on initial send
**File:** `src/server/modules/esign/service.ts` (`sendForSignature`)

- After the package + signers are created, for each signer **with an email**,
  send the signing-link email via `sendEmail` (same helper/content shape as
  resend, subject *"Please sign {title}"*).
- Still return the `links[]` to the dialog (staff can also copy/text them).
- Email sending is **best-effort**: a failed email must not roll back the send
  (wrap per-signer sends so one failure doesn't abort the rest). In dev with no
  `RESEND_API_KEY`, the existing helper logs to console.

## Data Model

No Prisma schema changes. All required fields already exist:
- `DocumentSigner.role` (`customer | co_customer | company_rep | witness`),
  `.order`, `.status`, `.tokenHash`, `.email`.
- `DocumentEventType` already includes `reminder_sent`.

## Error Handling

- Resend on a completed/voided package → action returns a friendly error; the
  button is not shown for those states anyway (defense in depth).
- Email failures during send/resend are caught per-signer and logged; the
  operation still succeeds and surfaces the copyable links.
- Token rotation is the single source of truth for link validity; the old link
  returns the existing "Invalid signing link" path.

## Testing

Extend `e2e/esign.spec.ts` (and/or add a sibling spec):
1. **Multi-signer send:** add a co-borrower, send, assert two signer rows and
   two links; both can sign in either order; package completes when both sign.
2. **List status:** after sending, the list row shows "signed 0 of 2" and
   per-signer chips; after one signs, "signed 1 of 2" + amber "partially signed".
3. **Resend:** click Resend on a pending doc → fresh link returned, old link no
   longer valid, a `reminder_sent` event appears in the audit trail.
4. **Resend hidden** on completed/voided docs.

Respect the known pre-existing failing e2e baseline — do not attribute those to
this change.

## Files Touched (summary)

- `src/components/esign/send-document-dialog.tsx` — multi-signer UI
- `src/components/esign/signature-status-badge.tsx` — **new** shared badge
- `src/components/esign/resend-button.tsx` — **new** client resend + link dialog
- `src/app/portal/documents/page.tsx` — per-signer status + resend on rows
- `src/app/portal/documents/[id]/page.tsx` — shared badge + resend in header
- `src/server/modules/esign/service.ts` — `resendSignatureRequest`, auto-email in `sendForSignature`
- `src/server/modules/esign/actions.ts` — `resendDocumentAction`
- `e2e/esign.spec.ts` — extended coverage
