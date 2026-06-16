import type { CallKind } from "@prisma/client";

export type { CallKind };

/** All call kinds, in display order — drives the Settings list + send picker. */
export const CALL_KINDS = ["welcome", "completion"] as const;

/** Human label for each call kind. */
export const CALL_KIND_LABELS: Record<CallKind, string> = {
  welcome: "Welcome Call",
  completion: "Completion Call",
};

/** Coerce arbitrary input to a valid CallKind (defaults to welcome). */
export function asCallKind(v: unknown): CallKind {
  return v === "completion" ? "completion" : "welcome";
}

/** One confirmation item in a call script. `body` may contain merge tokens. */
export type WelcomeCallItem = { id: string; title: string; body: string };

/** A template's editable content (also the shape frozen into a session snapshot). */
export type WelcomeCallContent = { intro: string; closing: string; items: WelcomeCallItem[] };

/** Safe-parse arbitrary JSON (from Prisma) into typed welcome-call items. */
export function parseItems(json: unknown): WelcomeCallItem[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && typeof (x as Record<string, unknown>).id === "string")
    .map((x) => ({ id: String(x.id), title: String(x.title ?? ""), body: String(x.body ?? "") }));
}
