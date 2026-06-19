# AI Avatar Call — Design Spec

**Date:** 2026-06-17
**Status:** Approved (design), ready for implementation
**Builds on:** the existing Call Templates feature (`src/server/modules/welcome-call/`, `kind` = welcome/completion). This adds an **avatar-call delivery mode** alongside the current text-confirm mode.

## Summary

A new **AI avatar call** delivery mode for call templates. When a rep sends an avatar-mode call,
we generate a personalized HeyGen talking-head **clip per question**. The customer opens the link,
consents to camera + mic, and goes through a **recorded video call**: the avatar asks each question,
the customer answers out loud and clicks Next, and the **entire session is captured as one
picture-in-picture video** (avatar + customer webcam, both audio tracks mixed). That recording **is
the confirmation** — saved on the deal for staff to play back.

## Decisions (from brainstorming)

- **Delivery:** scripted HeyGen avatar (not real-time interactive).
- **Flow:** one question at a time — avatar asks → customer answers out loud → Next.
- **Consent:** before the call starts, prompt for camera + mic; show "this will be recorded."
- **Recording:** composite client-side (canvas PiP of avatar + webcam, Web-Audio-mixed audio) into
  ONE video via MediaRecorder. No OS screen-share prompt.
- **Confirmation:** the recording itself is the record — no checkboxes in avatar mode.
- **Storage:** avatar clips + the final call recording saved via the app's `putObject` (S3 in prod).
- **Vendor:** HeyGen, key provided by the owner. Graceful fallback + placeholder avatar when no key.

## Scope (v1 / Phase 1)

In: template `mode` toggle; per-question HeyGen generation (async + webhook); the consent →
turn-taking → composite-recording → upload → complete customer flow; storage + staff playback;
graceful no-key fallback with a placeholder avatar.

Out (later): combined server-side compositing/editing, per-template avatar/voice pickers,
transcription/AI scoring of answers, real-time interactive avatar.

## Architecture

### Data model (additions — one migration)

```prisma
enum CallMode { confirm avatar }

enum AvatarStatus { none generating ready failed }

// WelcomeCallTemplate += 
mode CallMode @default(confirm)
// (avatar id/voice come from company/env default in v1; per-template later)

// WelcomeCallSession +=
mode          CallMode     @default(confirm)
avatarStatus  AvatarStatus @default(none)
// Per-question generated clips, in play order:
// [{ key: "intro"|"closing"|itemId, text, heygenVideoId, storageKey, status }]
segments      Json         @default("[]")
recordingStorageKey String?
recordedAt          DateTime?
```

### Modules

- **`welcome-call/avatar.ts`** — HeyGen client. `generateClip(text) -> { heygenVideoId }`
  (`POST /v2/video/generate`, `X-Api-Key`, company default `avatar_id`/`voice_id`).
  `downloadClip(url) -> Buffer` → `putObject`. `narrationSegments(snapshot)` builds the ordered
  segment list (intro + each item body + closing). `heygenConfigured()` guard. When unconfigured,
  segments are marked `ready` with a bundled **placeholder clip** key so the flow is testable.
- **`/api/webhooks/heygen/route.ts`** — on clip completion: download → `putObject` → update that
  segment's `status`/`storageKey`; when all segments ready, set `session.avatarStatus = ready`.
  (Fallback: a status-poll path if webhooks aren't configured.)
- **`welcome-call/service.ts`** (extend) — `createWelcomeCall` branches on template `mode`:
  - `confirm`: unchanged.
  - `avatar`: snapshot as today + build segments + kick off HeyGen generation (`avatarStatus =
    generating`), or mark ready with placeholders if unconfigured.
  - `getWelcomeCallByToken` returns `mode`, `avatarStatus`, and ordered segment playback URLs (via
    a file-serving route) for ready clips.
  - `completeAvatarCall(token, recordingKey, ip)` — set status `completed`, `recordingStorageKey`,
    `recordedAt`, notify the rep (reuse `document_completed`).
- **`/api/welcome-call/[token]/recording/route.ts`** — POST the recorded blob → `putObject`
  (`welcome-calls/<sessionId>/recording.webm`) → calls `completeAvatarCall`. Body-size limit raised;
  presigned-S3 direct upload noted as the scale path.
- **File serving** — reuse the existing storage file-serving route to stream avatar clips + the
  recording back to authorized viewers (staff) / the public token page (clips only).

### Customer experience — `/welcome/[token]` (avatar mode)

1. **Pre-call gate:** "This call will be recorded. Allow camera & microphone to begin." → Start.
   `getUserMedia({video, audio})`. If `avatarStatus !== ready`: "Your call is being prepared…" with
   poll/refresh.
2. **Recording starts:** a `<canvas>` composites the playing avatar `<video>` (full) + the webcam
   (PiP corner) on a rAF loop; avatar audio + mic mixed via Web Audio → one stream;
   `canvas.captureStream()` + mixed audio → `MediaRecorder` (webm; mp4 fallback for Safari).
3. **Turn-taking:** play segment[i] (avatar asks); on `ended`, show "Your turn — answer, then Next";
   Next advances to segment[i+1]. Recording runs continuously.
4. **Finish:** after the closing segment → stop recorder → upload blob to the recording route →
   show thank-you. Session `completed`; rep notified.

`welcome-call-experience.tsx` stays the **confirm**-mode UI; a new
`avatar-call-experience.tsx` handles avatar mode. The page picks by `view.mode`.

### Settings / template editor

- Template editor gets a **mode** toggle (Text confirmation vs AI avatar call). Avatar mode shows a
  note about the HeyGen requirement + that items are read as questions.
- Company HeyGen config (`HEYGEN_API_KEY`, `HEYGEN_AVATAR_ID`, `HEYGEN_VOICE_ID`) via env in v1.

### Staff playback

- Documents → Welcome Calls → a completed avatar call links to a viewer that plays the **call
  recording** (and lists the avatar clips). Reuses the file-serving route, staff-gated.

## Error handling / edge cases

- No HeyGen key → placeholder avatar clips; flow fully works for testing.
- Generation still running when customer opens → "preparing" + poll.
- Generation failed → mark `failed`; staff can resend; customer sees a friendly retry message.
- Camera/mic denied → can't proceed; show how to enable, allow retry.
- Upload failure → keep the blob client-side, retry; don't mark completed until stored.
- Browser without MediaRecorder/canvas.captureStream (old Safari) → graceful message; recommend Chrome.

## Dependencies & realities

- HeyGen account + `HEYGEN_API_KEY` + one `HEYGEN_AVATAR_ID` + `HEYGEN_VOICE_ID`.
- **Cost scales with items × sends** (one clip per question per send). Documented for the owner.
- **Prod must use S3 storage** (`STORAGE_DRIVER=s3` + bucket); recordings are tens of MB.
- HTTPS required for webcam (prod ✓, localhost ✓). Chrome is the smoothest; Safari needs mp4 fallback.
- HeyGen webhook URL registered in the HeyGen dashboard → `/api/webhooks/heygen`.

## Testing

- Unit: `narrationSegments` (snapshot → ordered segments), `heygenConfigured` gating, segment
  completion → `avatarStatus` transition.
- Compile/smoke: pages compile; public token page renders the consent gate; placeholder path lets the
  full record→upload→playback loop run locally without a HeyGen key.
- Media capture/compositing is browser-runtime — verified manually in Chrome.

## Verification before prod

- One migration (CallMode + AvatarStatus enums + template `mode` + session fields). Manual
  `prisma migrate deploy` to prod.
- Set `HEYGEN_*` env + `STORAGE_DRIVER=s3` in prod for the real avatar path; without them it falls
  back to placeholder/text so nothing breaks.
