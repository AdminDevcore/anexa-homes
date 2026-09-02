# Authorised signers, and the co-owner who can finally sign

Date: 2026-09-02
Status: approved

## The problem

Two halves of the same gap, both found on the same screen.

**Our side of a contract has nowhere to live.** Every template field is already
assigned to a signer role — `customer`, `co_customer`, `company_rep`, `witness`
— but nothing is stored about the person who signs for us. At send time whoever
is sending types the rep's name and email by hand, and that person then has to
open a signing link and draw a signature exactly like a customer would. The
owner signs every contract in principle and is available for none of them in
practice, so in practice a teammate signs, and the CRM has no idea who, with
what title, under what licence.

There is also no way to put those details on the page. The autofill catalogue
has Customer, Property, Project, Company, Permitting and Custom groups; none of
them can answer "which individual is signing, and what is their licence
number", so a contract's signature block has blanks that only a human can fill.

Some documents have no customer signer at all. The Installer Attestation in
`Signed Final Permit` is signed by the installer and nobody else — today it must
still be routed through a signing link to a person, to collect a signature the
company has already authorised.

**The co-owner is half-built.** `Lead.coOwnerName` exists and
`{{customer.coOwner}}` maps to it, but there is no co-owner email or phone. That
absence is load-bearing: `sendFinalDocsAction` and the `send_for_signature`
automation action both hard-code the customer as the only signer, each with a
comment saying a co-owner cannot be sent to because there is no address on file.
A spouse on the title cannot sign anything.

## What this builds

### 1. `CompanySigner` — a saved, authorised signer

A new company-wide model. Company-wide rather than per-vertical because a person
is a person: the same owner signs a roof contract and a solar install agreement.
Which signer a *document* uses is settled per template, and templates are
already per-vertical, so the vertical difference is expressed where it belongs.

```prisma
model CompanySigner {
  id            String   @id @default(uuid())
  companyId     String
  company       Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  name          String
  title         String?
  email         String?
  phone         String?
  licenseNumber String?
  /// Extra labelled credential lines: [{ key, label, value }]. `key` is the
  /// slugified label, frozen on creation so renaming a label cannot orphan a
  /// template that already maps {{signer.cred.<key>}}.
  credentials   Json     @default("[]")
  /// The saved signature, a PNG data URL — the same shape
  /// `DocumentSigner.signatureData` already holds, so the PDF stamper draws it
  /// through its existing `embedPng` path with no new branch.
  signatureData String?
  /// A separate mark for Initials fields. Falls back to signatureData.
  initialsData  String?
  isDefault     Boolean  @default(false)
  active        Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  templates DocumentTemplate[]

  @@index([companyId, active])
  @@map("company_signers")
}
```

Signature images are normalised through `sharp` on upload — fit inside 600×200,
PNG, transparency preserved — which caps a stored data URL at roughly 40 KB.
Drawn and typed signatures arrive from the browser already as PNG data URLs and
go through the same normalisation, so all three capture methods produce one
shape.

`isDefault` is enforced in the action rather than by a partial index: setting a
new default clears the others in the same transaction.

### 2. `DocumentTemplate.companySignerId`

Nullable. When set, this template is signed by that person. When null, the
company default signs it. Deliberately not copied into `folderKey`'s pattern of
freezing at send: the *resolved* signer is frozen into the package's signer row
and its field values, which is the thing that must not move. The template's
pointer stays live.

### 3. `Lead.coOwnerEmail`, `Lead.coOwnerPhone`

Both added to `leadContactFields` — the single shared definition — so the deal
edit form, the homeowner card and the solar proposal's Customer step all gain
them without three separate edits and three chances to drift.

### 4. Settings → Authorised signers

`/portal/settings/signers`, a new section keyed `company_signers` in the
*Documents & money* band beside Document Templates. Built from the settings kit
— `RailLayout` + `ItemRail` + `SaveBar` — the shape the Lenders screen was
rebuilt into, so it reads like every other list-of-things settings screen.

The rail lists signers, default first, with the default badged. The panel holds
one signer's whole record: name, title, email, phone, licence number, the
credential rows (label + value, add and remove), the signature, the initials,
and the two toggles.

Signature capture offers three ways in one control: draw on a canvas, type the
name in a script face, or upload a PNG or JPG. All three resolve to the same
normalised PNG data URL before saving.

URL state — which signer is open — is read on the **server** from `searchParams`
and passed in as a prop. A client that reads `window.location` during hydration
renders something the server never did, and React repairs that by throwing the
server's markup away. This is the trap the Lenders screen already documents.

RBAC: `read Settings` to view, `update Settings` to change — owner and admin.

A short standing-authorisation note sits at the top of the panel: a signature
applied without the signer present rests on that person's written authorisation,
which belongs on file outside the CRM. Stated at the point where someone is
added, which is the only moment it is useful.

**Hub inventory:** the card carries a live count — "2 signers" / "None yet" —
and `workspaceSetupGaps` raises an amber gap when any active template has a
`company_rep` field but the company has no active signer. That gap is the exact
condition that blocks a send, surfaced before anyone hits it.

### 5. Two new token groups

**Signer** — resolved from the signer this template would use, so the builder's
preview and the sent document agree:

| Token | Value |
|---|---|
| `{{signer.name}}` | Mustafa Joulani |
| `{{signer.title}}` | Owner |
| `{{signer.email}}` | — |
| `{{signer.phone}}` | — |
| `{{signer.license}}` | licence / registration number |
| `{{signer.date}}` | the date the company signature was applied |
| `{{signer.cred.<key>}}` | one per credential line defined on that signer |

Credential tokens are appended to the catalogue dynamically, the same mechanism
that makes a company's custom fields appear in the picker without a code change.

**Co-owner** — `{{coOwner.fullName}}`, `{{coOwner.email}}`,
`{{coOwner.phone}}`. `{{customer.coOwner}}` remains as an alias of
`{{coOwner.fullName}}`, so every template that already maps it keeps working.

`AutofillContext` gains `signer` and `coOwner` branches. `buildAutofillContext`
takes the resolved signer as an optional argument; absent, the `signer` branch
resolves to empty strings rather than being missing, so `resolvePath` behaves
identically to every other unset field.

### 6. The company signature is applied at send

In `sendForSignature`, before the transaction:

1. **Resolve the signer** — the primary template's `companySignerId`, else the
   company's active default.
2. **Refuse the send** if any template in the envelope carries a `company_rep`
   field and no signer resolves. A contract that goes out with an empty
   signature block is worse than one that does not go out, and the message names
   the fix: "No authorised signer is set. Add one in Settings → Authorised
   signers."
3. **Create the `company_rep` signer row already `signed`** — `signedAt` now,
   `signatureData` set to the saved image, `signatureType` `drawn`, `email`
   deliberately null so the existing best-effort mailer skips it. A token hash is
   still generated because the column is unique and required; it is never handed
   out.
4. **Write `DocumentFieldValue` rows for every `company_rep` field**:
   signature and initials fields get the saved images; a `date` field with no
   token mapping gets the application date; text fields resolve through their
   token mapping exactly as they do now.
5. **Append a `signed` event** whose actor names both people, with
   `{ onBehalfOf, onBehalfOfId, appliedBy, appliedById }` in `metadata`.
6. **Finalise immediately when nobody is left to sign.** The count of signers
   whose status is not `signed` is already what `recordSignature` finalises on;
   a company-only document reaches zero at creation, so it produces a finished,
   filed PDF from the send itself.

The signer's identity is frozen into the package the moment it is created —
signer row, field values, event metadata — so editing or deleting a
`CompanySigner` afterwards cannot alter a document already sent. Deleting one is
therefore a soft delete: `active = false`, keeping the row for any template still
pointing at it.

### 7. The certificate names both

`toCertSigners` gains `appliedBy` and `title`. The company row renders as its
signer's, with the authorisation immediately beneath it:

```
Mustafa Joulani — Owner, Licence #TX-12345
Signed Sep 2, 2026 4:41 AM CDT
Applied on standing authorisation by Sarah Chen · 24.28.x.x · Chrome on macOS
```

Same pair in the `signed` event, so the audit trail and the certificate cannot
tell different stories.

### 8. `defaultSignersForLead`

One helper in the esign module answering "who signs for this household":
the customer at order 1, plus the co-owner at order 1 when the deal has both a
co-owner name and a co-owner email. Used by:

- `sendFinalDocsAction` — replacing its hard-coded single customer
- the `send_for_signature` automation action — same
- both send dialogs, as the prefill

The two comments explaining that a co-owner cannot be sent to are removed,
because the reason they gave no longer holds.

The company rep is *not* part of this helper. It is resolved inside
`sendForSignature` from the template, so every caller — dialog, button,
automation — gets the company signature without having to know about it.

### 9. The screens that change

**Template builder** — the field-properties "Signer" dropdown relabels to
Customer · Co-Owner · **Company (auto-signed)** · Witness. The amber "N of M
fillable fields aren't mapped" banner stops counting `company_rep` signature,
initials and date fields, because those now fill themselves; counting them would
warn about the exact thing this feature fixed.

**Template settings card** — gains "Signed on our behalf by": Company default
(naming who that currently is) or a specific signer.

**Both send dialogs** — the company rep stops being two blank boxes and becomes
a line: *Signed for Anexa Homes by Mustafa Joulani (Owner) · change*. The
co-borrower section prefills name and email from the deal when a co-owner is on
file, and stays a removable row.

## Out of scope

Signing order beyond what exists today, witness auto-signing, and per-state
licence selection. Each is a real thing eventually; none is needed for a
countersigned contract or a co-owner who can sign.

## Testing

**Unit**
- `defaultSignersForLead`: customer alone; customer + co-owner when both name
  and email are present; customer alone when the co-owner has a name but no
  email.
- Credential key slugging, and that a key survives its label being renamed.
- Signer resolution precedence: template override wins over company default;
  default used when the template names none; nothing resolves when no signer is
  active.
- `buildAutofillContext` with and without a signer, including a credential token
  and the `{{customer.coOwner}}` alias.

**Integration**
- Sending a template with `company_rep` fields produces a package whose company
  signer row is already `signed`, with field values holding the saved images.
- A company-only template (no customer fields, no customer signer) completes at
  send and files its PDF.
- Sending when a `company_rep` field exists and no signer is configured is
  refused, and no package row is written.
- A deal with a co-owner email gets two signer rows at order 1, and the envelope
  completes only after both sign.
- Editing a `CompanySigner` after a send leaves the sent package's stamped
  values untouched.

**E2E**
- Add a signer in Settings with a typed signature, map `{{signer.name}}` and a
  company signature field onto a template, send it, and confirm the generated
  PDF carries the signature and the certificate names both people.

## Migration

One Prisma migration: create `company_signers`, add
`document_templates.company_signer_id`, add `leads.co_owner_email` and
`leads.co_owner_phone`. All additive and nullable — no backfill, and every
existing template keeps behaving as it does today until a signer is configured.
The production build applies migrations, so deploying is the application.
