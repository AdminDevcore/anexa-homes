-- Drop the welcome/completion confirmation-call feature entirely. The whole
-- surface (Send Call, Settings → Call Templates, the public /welcome page and
-- the AI-avatar call) was removed from the product, so the tables and their
-- enums go with it. Sessions cascade from the templates' own FK, but drop
-- sessions first so the order is explicit.
DROP TABLE IF EXISTS "welcome_call_sessions";
DROP TABLE IF EXISTS "welcome_call_templates";

DROP TYPE IF EXISTS "WelcomeCallStatus";
DROP TYPE IF EXISTS "AvatarStatus";
DROP TYPE IF EXISTS "CallMode";
DROP TYPE IF EXISTS "CallKind";
