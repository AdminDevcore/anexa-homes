# Weekly Open-Task Reminders — Design

**Date:** 2026-06-15

## Problem

Follow-up tasks assigned to sales reps can sit open for months/years with no
nudge. There's no recurring reminder, so stale follow-ups are forgotten.

## Decisions (from brainstorming)

- **Scope:** all open tasks (todo/in_progress), sorted by age with overdue
  called out ("open & aging").
- **Format:** one weekly digest per recipient (not one notification per task).
- **Channels:** in-app bell + branded email.
- **Audience:** the assigned rep (their own tasks) AND managers/admins (a team /
  company rollup).

## Approach

Time-driven, so it's a scheduled cron (not the event-driven NotificationRule
system). Mirrors the existing `stage-alerts` cron + notification pattern.

### 1. Cron — `src/app/api/cron/task-reminders/route.ts` (new)
GET endpoint, `maxDuration = 60`, `dynamic = "force-dynamic"`, same
`Authorization: Bearer ${CRON_SECRET}` check as stage-alerts. Calls
`runTaskReminders()`. Registered in `vercel.json` as `0 14 * * 1` (Mondays,
~9am CT). The weekly schedule itself provides cadence — no per-task state flag.

### 2. Job — `src/server/modules/tasks/reminders.ts` (new) → `runTaskReminders()`
1. Load all open tasks across companies: `status in (todo, in_progress)`,
   `assigneeId` set, assignee `status: "active"` (no disabled/deleted users),
   including `lead` (deal name), `dueAt`, `createdAt`, `priority`, `companyId`.
2. Group by company.
3. **Rep digests:** group a company's tasks by `assigneeId`; for each rep with
   ≥1 open task, build a personal digest (sorted oldest-first, overdue flagged)
   and send it to that rep.
4. **Manager/admin rollups:** for each active `manager` in the company, compute
   their team's tasks via `managerTeamUserFilter(managerId)` applied to the
   assignees; for each `admin`/`super_admin`, use the whole company. Build a
   one-line-per-rep rollup ("Sarah — 6 open, 2 overdue, oldest 21d") and send.
5. **Dedupe:** skip a recipient if a `task_reminder` notification was created for
   them in the last 5 days (guards an accidental double cron fire).
6. Cache `emailBrandFor(companyId)` per company. Return
   `{ companies, repDigests, managerDigests }` for logging.

### 3. Delivery (reuse stage-alerts helpers)
- In-app: `prisma.notification.create({ ..., event: "task_reminder",
  channel: "in_app", link: "/portal/tasks" })`.
- Email: `brandedEmailTemplate({ brand, subject, heading, paragraphs, cta })`
  then `sendEmail(email, subject, text, { fromName, html })`.

### 4. Schema — add `task_reminder` to `NotificationEvent`
A safe additive enum value (migration). Needed because in-app `Notification`
rows require a valid `event`, and a distinct value makes the 5-day dedupe query
precise.

## Digest content
- **Rep:** heading "You have N open follow-ups (M overdue)"; each task line:
  title · deal name · "open Xd" · due date (⚠ if overdue). CTA → /portal/tasks.
- **Manager/admin:** heading "N open follow-ups across your team"; one line per
  rep with counts + oldest age. CTA → /portal/tasks.

## Testing
Unit-test the pure digest builder (grouping, overdue detection, age formatting,
oldest-first sort) with a fixed `now`. The cron/delivery wiring mirrors the
verified stage-alerts path.

## Out of scope (v1)
Per-user opt-out / quiet hours (none exists today), UI-configurable cadence/day,
SMS.

## Files
- `prisma/schema.prisma` + migration — add `task_reminder` to `NotificationEvent`
- `src/server/modules/tasks/reminders.ts` (new)
- `src/app/api/cron/task-reminders/route.ts` (new)
- `vercel.json` — register `0 14 * * 1`
