# Send final docs to customer

**Date:** 2026-08-30
**Scope:** Solar only. Roofing's deal page, the e-sign service and the automation engine are untouched.

## The problem

When a solar install finishes, the homeowner still has to sign the closeout
paperwork — certificate of acceptance, attestation of payment, lien waiver.
Today the only way to send it is the Documents page, with a lead picker and a
template list, by somebody sitting in an office. Nobody standing on the finished
job can send it, and nobody looking at the job can see whether it came back
signed.

## What ships

One row in the solar deal's **Field production** slide, directly under the QC
Checklist:

    [ Send final docs to customer ]   Signed 8/30
    Certificate of Acceptance · Attestation of Customer Payment · Lien Waiver

## 1 · Marking what "final docs" means

`DocumentTemplate.finalPacket Boolean @default(false)` — a new column, one
migration.

The template editor's existing name/destination card (`TemplateSettings`) gains
a third control: *"Part of the final documents packet"*. It renders **only on
solar templates**, so roofing's editor is unchanged. The card names the position
the document will print in ("2nd of 3 in the packet").

Packet order is template **creation order** (`createdAt asc`). It is stable, it
needs no second column, and it needs no drag-and-drop UI.

`updateTemplateAction` takes the new flag alongside name and folder. Nothing
else writes it.

## 2 · The button

Rendered inside the `project` branch of the solar Field production slide — no
job, no button. It is not gated on photos or QC: the person on site decides the
install is done.

Clicking opens a confirm dialog, because this emails a homeowner. The dialog
states exactly what goes and where — the ordered document list and the recipient
address — then sends.

Everything goes as **one envelope**: one email, one signing link, one signature,
one merged PDF, filed into the folder the first packet template names. The
customer is the only signer, matching the automation action's rule: `Lead` holds
`coOwnerName` but no co-owner email, so there is no second address to send to.

Blocked states say why rather than going quietly dead:

| Condition | Button |
|---|---|
| No solar template ticked | Disabled · "No documents are marked as final documents yet" + link to Templates |
| Deal has no email address | Disabled · "This deal has no email address on file" |
| A completed packet already exists | Enabled, reads *Send again* |

Server action `sendFinalDocsAction(leadId)` resolves the packet and delegates to
the existing `sendForSignature(user, …)`, so `requireCan(create, Document)` and
the lead scope check apply unchanged. No new code in the e-sign engine.

## 3 · The status

Reads the newest `DocumentPackage` on the deal whose `templateId` is in the
packet:

- none → `Not sent`
- `sent` → `Sent 8/30`
- `viewed` → `Viewed 8/30`
- `partially_signed` → `Partially signed`
- `completed` → `Signed 8/30` (green)
- `declined` / `voided` / `expired` → shown as-is

Signed rows offer **Download signed PDF** (the package's `signedFileId`).
Rows still out for signature offer **Resend** (the existing `ResendButton`).

The resolver is a pure function over `(packages, packetTemplateIds)` so it can be
tested without a database.

## 4 · Why the Settings automation lights up the same chip

The chip matches on *template in the packet*, never on who sent it. A
Settings → Automations rule (stage entered → *Send a document for signature*,
template = a packet document) therefore fills the same status line. The manual
tap and the automation are one thing on screen — there is no second indicator to
contradict the first. The automations engine is not modified.

## 5 · Data

`getLeadForDetail`'s `documentPackages` select gains `templateId`, `sentAt` and
`completedAt`. The deal page queries the company's solar packet templates
(id + name, `active`, ordered by `createdAt`) once, for solar deals only.

## 6 · Testing

Integration tests (vitest):

- packet resolution and order — ticked templates only, creation order, active only
- refuses when no template is ticked
- refuses when the lead has no email
- RBAC: a user without `create Document` is refused
- status resolver: each ladder state, newest package wins, ignores packages
  whose template is not in the packet

## 7 · Proving roofing untouched

The diff touches: `prisma/schema.prisma` (+1 column), `TemplateSettings` (solar-
only control), `esign/actions.ts` (+2 actions), a new panel component, a new
status lib, and the **solar** branch of the deal page. No file under the roofing
branch of `page.tsx` changes; the roofing template editor renders exactly what it
rendered before.
