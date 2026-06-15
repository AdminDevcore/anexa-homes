# Branding Logo Upload — Design

**Date:** 2026-06-14

## Problem

The Branding settings page only lets users paste a **Logo URL**. The sidebar
(and login page, emails, proposals) already render `branding.logoUrl` when set —
but there's no way to upload a logo file, so users who don't already host their
logo somewhere have nowhere to "put" it.

## Decision

Add an **Upload logo** button to the Branding form. The file is stored and the
Logo URL is set automatically so the sidebar updates immediately. Keep the
paste-a-URL field as well.

## Approach (no DB migration)

Reuse the existing `FileAsset` + object-storage infra and serve the logo from a
small **public** route so it works in every context (authed portal sidebar,
public login page, emails, proposals).

### 1. Upload action — `src/server/modules/settings/actions.ts`
`uploadBrandingLogoAction(formData)`:
- `requireUser` + `can(user, "update", "Settings")`.
- Validate: a `File`, ≤ 5 MB, mime ∈ {png, jpeg, webp}. (SVG excluded — serving
  user SVG is an XSS surface; users export PNG.)
- Process with `sharp`: resize within 512×512 (no enlargement), output **PNG**
  (preserves transparency, unlike the JPEG path used for photos).
- `putObject` under `companies/{companyId}/branding/{nanoid}.png`.
- Replace: `deleteMany` prior `FileAsset` rows with `category="branding_logo"`
  for this company (one logo), then create a new `FileAsset`
  `{ companyId, kind: "photo", category: "branding_logo", storageKey, mimeType,
  size, uploadedById }`. (These rows have no leadId/projectId, so they never
  appear in lead/project file lists.)
- Set `CompanySettings.logoUrl = /api/branding/logo?company={companyId}&v={now}`
  (relative; the `v` busts caches on change) via upsert.
- `revalidatePath("/portal", "layout")` + the branding page. Return
  `{ ok, logoUrl }`.

### 2. Public serving route — `src/app/api/branding/logo/route.ts` (GET)
- Read `company` param (400 if missing).
- Find the latest `FileAsset` with `companyId` + `category="branding_logo"`
  (404 if none).
- `getObject(storageKey)` → return bytes with `Content-Type` = its mimeType,
  `Cache-Control: public, max-age=300`, `X-Content-Type-Options: nosniff`.
- No auth — logos aren't sensitive and must render pre-auth (login page) and in
  emails.

### 3. Branding form — `src/components/portal/branding-form.tsx`
- Add an **Upload logo** button beside the Logo URL field; a hidden
  `accept="image/png,image/jpeg,image/webp"` file input.
- On pick: call `uploadBrandingLogoAction`; on success `setLogoUrl(res.logoUrl)`,
  toast, `router.refresh()` (sidebar updates). The URL input + existing preview
  stay; manual paste still works.

## Why relative logoUrl is fine
- Sidebar / login / proposals render `<img src={logoUrl}>` same-origin.
- Emails already absolutize relative asset paths via `absUrl(appUrl, logoUrl)`
  using `NEXT_PUBLIC_APP_URL`.

## Out of scope
SVG logos, favicon upload (still URL-only), per-logo dark/light variants.

## Files touched
- `src/server/modules/settings/actions.ts` (new `uploadBrandingLogoAction`)
- `src/app/api/branding/logo/route.ts` (new public route)
- `src/components/portal/branding-form.tsx` (upload button)
