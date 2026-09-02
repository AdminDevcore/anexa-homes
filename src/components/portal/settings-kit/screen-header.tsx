import * as React from "react";
import { SETTINGS_SECTIONS, type SettingsSectionKey } from "@/lib/settings-sections";
import type { ActiveVertical } from "@/lib/vertical";
import { PanelHeader } from "./panel-header";

/**
 * The head of a Settings screen, taken from the same registry the rail is built
 * from.
 *
 * Every screen used to hand-write its own title and blurb, so the card in the
 * hub and the heading on the page it opened drifted apart — the card promised
 * "Modules, inverters, batteries and rank-ordered adders" and the page said
 * "Solar Equipment". One source, one name, one sentence, and the icon a person
 * just clicked is the icon at the top of what opened.
 *
 * `title` / `description` override it where a screen genuinely knows more than
 * the registry can — a count, or which workspace it is answering for.
 */
export function SettingsScreenHeader({
  section,
  vertical,
  icon,
  title,
  description,
  pills,
  actions,
}: {
  section?: SettingsSectionKey;
  /** Only the two sections with per-workspace wording need this. */
  vertical?: ActiveVertical;
  /** For screens with no card of their own — a template library, say. */
  icon?: React.ComponentType<{ className?: string }>;
  title?: string;
  description?: React.ReactNode;
  pills?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const registered = section ? SETTINGS_SECTIONS.find((s) => s.key === section) : undefined;
  const label = vertical ? registered?.labels?.[vertical] : undefined;

  return (
    <PanelHeader
      icon={icon ?? registered?.icon}
      title={title ?? label?.title ?? registered?.title ?? ""}
      description={description ?? label?.body ?? registered?.body}
      pills={pills}
      actions={actions}
    />
  );
}
