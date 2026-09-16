-- Starter agent rows for every company that already exists. Additive and
-- idempotent: re-running writes nothing a previous run already wrote.
--
-- The Hello Agent for every company: disabled, unscheduled, gated. It exists so
-- an admin can press Run now and watch the runner and the run log work end to
-- end, with nothing outside the app involved.
INSERT INTO "agents" (
  "id", "companyId", "name", "description", "handlerKey", "vertical", "department",
  "enabled", "schedule", "nextRunAt", "timeoutSeconds", "config", "requiresHumanGate",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text, c."id", 'Hello Agent',
  'Test agent. Logs hello and records a successful run, proving the runner and run log work end to end.',
  'system.hello', NULL, 'operations',
  false, NULL, NULL, 60, '{}'::jsonb, true,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "companies" AS c
ON CONFLICT ("companyId", "name") DO NOTHING;

-- Starter alerts. fireEvent reaches people only through a matching rule, and a
-- rule belongs to one workspace, so every company gets both events in both
-- workspaces: the owner, admins, and everyone holding the Agents access switch.
INSERT INTO "notification_rules" (
  "id", "companyId", "vertical", "name", "event", "conditions", "recipients", "channels",
  "titleTemplate", "bodyTemplate", "active", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text, c."id", v.vertical::"Industry", e.rule_name, e.event::"NotificationEvent", '{}'::jsonb,
  '{"roles":["super_admin","admin"],"userIds":[],"dynamic":["agents_access"]}'::jsonb,
  '["in_app"]'::jsonb,
  e.title, '{{status}}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "companies" AS c
CROSS JOIN (VALUES ('roofing'), ('solar')) AS v(vertical)
CROSS JOIN (VALUES
  ('agent_run_failed',  'Agent run failed → Agents access',    'Agent failed: {{agent}}'),
  ('agent_needs_human', 'Agent needs a human → Agents access', 'Needs a human: {{agent}}')
) AS e(event, rule_name, title)
WHERE NOT EXISTS (
  SELECT 1 FROM "notification_rules" AS r
  WHERE r."companyId" = c."id"
    AND r."vertical" = v.vertical::"Industry"
    AND r."event" = e.event::"NotificationEvent"
);
