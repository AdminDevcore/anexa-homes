import { compilePhotosAction } from "./actions/compile-photos";
import { generateDocumentAction } from "./actions/generate-document";
import { moveStageAction } from "./actions/move-stage";
import { sendForSignatureAction } from "./actions/send-for-signature";
import { setProjectStatusAction } from "./actions/set-project-status";
import type { AutomationActionModule } from "./types";

/**
 * The only file that knows about every action.
 *
 * Adding a sixth action is a new file plus one line here — never an edit to a
 * growing switch statement inside the engine.
 *
 * Actions must never import the engine back. An action whose own effect is a
 * trigger reports it on its StepResult and the engine re-enters; see
 * StepResult.follow.
 */
export const ACTION_REGISTRY: Record<string, AutomationActionModule> = {
  [compilePhotosAction.type]: compilePhotosAction,
  [generateDocumentAction.type]: generateDocumentAction,
  [moveStageAction.type]: moveStageAction,
  [sendForSignatureAction.type]: sendForSignatureAction,
  [setProjectStatusAction.type]: setProjectStatusAction,
};

export function actionFor(type: unknown): AutomationActionModule | null {
  return typeof type === "string" ? (ACTION_REGISTRY[type] ?? null) : null;
}
