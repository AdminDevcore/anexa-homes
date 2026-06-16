# Welcome Call — Design Spec

**Date:** 2026-06-16
**Status:** Approved (design), ready for implementation
**Author:** Super Admin + Claude

## Summary

A **Welcome Call** is a reusable, customer-facing confirmation flow. An admin authors a
"welcome call script" once (a set of confirmation items with merge variables). A rep sends it
to a customer as a branded public link. The customer opens the link, reviews their project
info (pulled live from the deal and snapshotted at send time), acknowledges each item, and
clicks **"I confirm everything is correct"** — recorded with a timestamp + IP as a lightweight
confirmation record. The assigned rep is notified on completion.

This is the post-sale "welcome call" digitized as self-service confirmation. It is **not** a
live call, a scheduler, or a signature ceremony.

## Decisions (from brainstorming)

- **Customer experience:** self-service confirm page (no live call).
- **Template content:** admin-authored ordered items, each with title + body text supporting
  merge variables. Reusable; multiple templates allowed.
- **Confirmation mechanism:** acknowledge each item (checkbox) + a final "I confirm everything
  is correct" button. Recorded with timestamp + IP. **No drawn/typed signature** in v1.
- **Location:** templates authored in **Settings → Welcome Call Templates**; sending happens
  **per-lead**; a **"Welcome Calls"** list lives under **Documents**.

## Scope (v1)

In scope: template CRUD, per-lead send, public confirm page, tracking list + resend, rep
notification on completion.

Out of scope (note for later): SMS delivery (email link only), drawn/typed signature, hard
link expiry (link valid until completed or voided), customer editing/correcting their info
(read-and-acknowledge only — the "flag issues" hybrid was declined).

## Architecture

Reuses existing infrastructure wherever possible:

- **Merge variables:** `src/server/modules/esign/autofill.ts` — the existing `AutofillContext`
  + token catalog (`{{customer.fullName}}`, `{{property.full}}`, `{{project.contractValue}}`,
  `{{claim.deductible}}`, `{{company.*}}`, `{{today}}`, `{{custom.*}}`, etc.) is the single
  source of truth for tokens. Tokens are resolved **once at send time** and snapshotted.
- **Public token link:** mirror `src/server/modules/esign/tokens.ts` — 32-byte base64url raw
  token in the URL, **SHA-256 hash stored** in the DB (raw never persisted), same as e-sign.
- **Public route shell:** mirror `/sign/[token]` / `/present/[token]` — no auth, branded with
  company logo + accent color, host-resolved branding.
- **Delivery:** `src/server/modules/notifications/delivery.ts` (`sendEmail`) +
  `brandedEmailTemplate` + `emailBrandFor`.
- **Notifications:** existing `Notification` model. Completion alert reuses the
  `document_completed` NotificationEvent value (no enum migration needed); title/body say
  "Welcome call confirmed."

### Data model (new — one migration)

```prisma
model WelcomeCallTemplate {
  id        String   @id @default(uuid())
  companyId String
  company   Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  name      String
  intro     String?  // shown above the items
  closing   String?  // thank-you message after confirm
  // Ordered confirmation items: [{ id, title, body }] — body may contain merge tokens.
  items     Json     @default("[]")
  active    Boolean  @default(true)
  position  Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  sessions  WelcomeCallSession[]

  @@index([companyId])
  @@map("welcome_call_templates")
}

enum WelcomeCallStatus {
  sent
  viewed
  completed
  voided
}

model WelcomeCallSession {
  id          String            @id @default(uuid())
  companyId   String
  company     Company           @relation(fields: [companyId], references: [id], onDelete: Cascade)
  templateId  String?
  template    WelcomeCallTemplate? @relation(fields: [templateId], references: [id], onDelete: SetNull)
  leadId      String
  lead        Lead              @relation(fields: [leadId], references: [id], onDelete: Cascade)
  projectId   String?

  customerName  String
  customerEmail String?
  status        WelcomeCallStatus @default(sent)
  tokenHash     String            @unique
  // Frozen at send time: { intro, closing, items: [{ id, title, body }] } with all merge
  // tokens already resolved against the deal. The customer confirms THIS snapshot.
  snapshot      Json
  // Item ids the customer acknowledged.
  acknowledged  Json              @default("[]")
  sentAt        DateTime          @default(now())
  viewedAt      DateTime?
  completedAt   DateTime?
  voidedAt      DateTime?
  confirmedIp   String?
  createdById   String?

  @@index([companyId, leadId])
  @@index([companyId, status])
  @@map("welcome_call_sessions")
}
```

(Add back-relations on `Company` and `Lead`.)

### Components / files

**Server module** `src/server/modules/welcome-call/`
- `templates.ts` — template CRUD actions (create/rename/update-items/reorder/setActive/delete),
  gated `Settings: update`. Mirrors lead-sources / scope-template managers.
- `service.ts` — `sendWelcomeCall(user, leadId, templateId)`: resolve+snapshot via autofill,
  generate token, create session, email link, return ok. `getWelcomeCallByToken(rawToken)`:
  hash → lookup → record first view → return view model. `confirmWelcomeCall(rawToken, acked, ip)`:
  validate, mark completed, notify assigned rep. `resendWelcomeCall(sessionId)`, `voidWelcomeCall(sessionId)`.
- `queries.ts` — `getWelcomeCallTemplates(companyId)`, `listWelcomeCalls(companyId)`.

**Settings UI**
- `src/app/portal/settings/welcome-call-templates/page.tsx` + `[id]/page.tsx` (edit one template).
- `src/components/portal/welcome-call-template-manager.tsx` — list (add/rename/reorder/activate/delete).
- `src/components/portal/welcome-call-template-editor.tsx` — edit intro/closing + ordered items
  with a merge-variable picker (reuse the token catalog).
- Add a **"Welcome Call Templates"** card to the Settings hub.

**Send (per-lead)**
- A "Send Welcome Call" control on the lead page (template picker → `sendWelcomeCall`).

**Public page**
- `src/app/welcome/[token]/page.tsx` — public, branded; renders intro + items w/ acknowledge
  checkboxes + final confirm. On confirm → `confirmWelcomeCall`.
- `src/components/welcome-call/welcome-call-experience.tsx` — client confirm UI.

**Documents tracking**
- A "Welcome Calls" section/list under `/portal/documents` (status, timestamps, resend/void).

### Data flow

1. Admin authors a template in Settings (items + merge tokens).
2. Rep opens a lead → "Send Welcome Call" → picks template.
3. `sendWelcomeCall` builds `AutofillContext` for the lead, resolves every token in
   intro/closing/items, writes the resolved copy into `session.snapshot`, generates a token,
   creates the session (status `sent`), emails the branded link.
4. Customer opens `/welcome/[token]` → first view sets `viewedAt` + status `viewed`.
5. Customer checks each item, clicks confirm → `confirmWelcomeCall` records `acknowledged`,
   `confirmedIp`, `completedAt`, status `completed`; notifies the assigned rep (in-app + email).
6. Tracking list under Documents reflects status throughout.

### Error handling / edge cases

- Invalid/unknown token → friendly "link not found" public page.
- Voided session → "this link is no longer active."
- Already completed → show the thank-you/closing state (idempotent; no double-confirm).
- Confirm with not-all-acknowledged → button disabled client-side; server re-validates and
  rejects if the acked set doesn't cover all items.
- Deleting a template used by sessions → block hard delete (deactivate instead), matching the
  lead-sources pattern; `templateId` is `SetNull` so historical sessions keep their snapshot.

### RBAC

- Template authoring: `Settings: update` (admins).
- Sending / resend / void: `Document: create` (staff, incl. reps).
- Public confirm page: no auth (token is the access control).

### Testing

- Unit: token resolution/snapshotting (merge against a fixture context), confirm-validation
  (rejects partial acknowledgement), status transitions.
- The public page + send flow verified by compile + manual smoke (auth-gated routes return 307,
  public route renders).

## Verification before prod

- One new migration (two tables + enum). Must be applied to prod manually (`prisma migrate
  deploy` against the direct connection) before/with deploy, or the new pages error.
- typecheck + eslint clean; affected pages compile.
