# Auto-file signed documents into their own deal folders

Date: 2026-08-19
Status: approved

## Problem

A solar deal now has sixteen document folders, six of them added today for the
paperwork the install agreement names: Proposal, Certificate of Acceptance,
Attestation of Customer Payment, Conditional Progress Lien Waiver, Conditional
Waiver & Release (Final Payment), and PTO.

All sixteen are manual drop targets. Four of the new ones hold documents that
are signed inside Anexa, and those arrive by a path that ignores folders
entirely: the deal page passes **every** `DocumentPackage` to the folder grid,
and `deal-folders.ts` marks exactly one folder `hostsPackages: true`. So a
signed Certificate of Acceptance appears under **Contract**, and the folder made
for it stays empty forever.

Two smaller facts fall out of the same investigation and shape the work:

- **Templates cannot be renamed.** `createTemplateAction` hard-codes
  `name: "Untitled contract"`; no action anywhere writes `name`, and every
  surface that shows it (`documents/page.tsx`, the builder's heading) is
  read-only. `sendDocumentAction` then sets `title: template.name`, so packages
  inherit the placeholder too. Four documents that are all called "Untitled
  contract" cannot be told apart, let alone routed.
- `solar_layout` and `invoice` are categories written by other parts of the app
  that no solar folder claims, so they resolve to Other. Out of scope here,
  noted so the next person does not rediscover them.

## Decisions

| Question | Decision |
|---|---|
| How do the four documents get signed? | E-sign templates inside Anexa |
| How does a template know its folder? | A "Files into" dropdown on the template, set once |
| Proposal and PTO | Stay manual — no PDF generation, no milestone routing |
| Renaming templates | In scope; the feature does not work without it |

Rejected: matching template *name* to folder label (a rename silently breaks
routing, near-matches misfile) and a hard-coded document→folder map in code
(every new document would need a deploy).

## Design

### 1 · `DocumentTemplate.folderKey`

New nullable `String`. The deal folder this template's document belongs in.

`null` means Contract. Every template that exists today has `null`, so existing
behaviour is preserved exactly rather than migrated.

### 2 · Template editor: name + destination

The editor at `/portal/documents/templates/[id]` gains a **Name** field and a
**Files into** dropdown. The dropdown lists the folders of the template's *own*
vertical — `foldersFor(template.vertical)` — so a solar template offers solar's
sixteen and a roofing template offers roofing's eleven. Folders with
`special: "photos" | "calls"` are excluded: a signed PDF does not belong in a
photo checklist.

One new server action:

```ts
updateTemplateAction({ id, name, folderKey })
```

Guarded by `requireCan(user, "update", "Document")`, matching the neighbouring
template actions. `folderKey` is validated against that template's vertical, the
way `moveFileAction` validates its target — an arbitrary string must not reach
the column.

### 3 · The package carries the folder

New nullable `DocumentPackage.folderKey`, copied from the template inside
`sendDocumentAction`'s existing transaction.

Copied, not read live, for the reason the body/fields snapshot already exists:
editing a template must not mutate documents already sent. Re-pointing a
template next month does not relocate contracts signed last month.

### 4 · The grid routes by that key

`hostsPackages` — a boolean hard-coded onto the Contract folder — is replaced by
real routing. A new pure function in `deal-folders.ts`, tested the way
`visibleFiles` is:

```ts
packagesByFolder(vertical, packages): Map<string, FolderPackage[]>
```

Rules:

- `folderKey` naming a folder this vertical has → that folder
- `null` → Contract (today's behaviour)
- a key this vertical does not have → Contract, **not** Other

That last rule is deliberate and differs from how *files* fall back. An
unrecognised file category means "we do not know what this is", and Other is
honest. A package always came from a template someone configured, so the
fallback is the folder packages have always lived in — Contract — rather than
the drawer of unidentified things.

Each folder shows its packages above its files, exactly as Contract does now,
and counts them in its badge.

### 5 · Proposal and PTO stay manual

No PDF generation, no milestone hook. They remain upload targets.

## Testing

Unit, in `src/lib/__tests__/deal-folders.test.ts`, matching the existing style:

- `packagesByFolder` — null → contract; unknown key → contract; a solar key
  routes to that folder; a solar key on a roofing deal → contract
- photo/call folders are not offered as destinations
- roofing's folder list is still untouched (the guard added earlier today)

Server: `updateTemplateAction` rejects a folder key from the other vertical.

E2E: `document-folders.spec.ts` must stay green unchanged — proof that a deal
with no configured templates behaves exactly as it did.

## Migration

Two additive nullable columns: `document_templates.folderKey`,
`document_packages.folderKey`. No backfill — `null` is the intended value for
everything that exists.

**Prod is manual.** Vercel runs `prisma generate`, not `migrate deploy`. The
migration must be applied **before** the deploy lands, or the deal page will 500
reading a column that is not there. Session pooler on port 5432, not the
transaction pooler on 6543.

## Out of scope

- Generating a proposal PDF server-side
- Routing PTO from a `SolarMilestone`
- Re-homing `solar_layout` and `invoice` out of Other
- Moving a *package* between folders after the fact (files already have this;
  packages would need their own affordance)
