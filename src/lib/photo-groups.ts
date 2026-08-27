// Deal-level photo groups. Photos are tagged via FileAsset.category = the group
// key, so Survey and Install/Roof photos stay separate and compile separately.

export type PhotoGroup = "survey" | "install" | "survey_photos" | "install_photos";

export const PHOTO_GROUPS: Record<PhotoGroup, { label: string; reportSection: string }> = {
  survey: { label: "Survey", reportSection: "Survey Photos" },
  install: { label: "Install Photos", reportSection: "Roof / Install Photos" },
  // Solar's folder keys for the same two sets.
  //
  // They are separate keys rather than aliases of roofing's because
  // FileAsset.category stores the folder key verbatim, and solar deals have
  // been writing "survey_photos" / "install_photos" since the solar folder grid
  // shipped. Collapsing them onto "survey"/"install" would strand every photo
  // already filed on a solar job in the Other folder.
  survey_photos: { label: "Site Survey", reportSection: "Site Survey Photos" },
  install_photos: { label: "Installation Photos", reportSection: "Installation Photos" },
};

export const PHOTO_GROUP_KEYS = Object.keys(PHOTO_GROUPS) as PhotoGroup[];

/**
 * Which checklist a photo folder opens — Survey → the "site" template,
 * Install → the "install" one. Solar spells its two folder keys differently but
 * means the same two checklists.
 *
 * This lives here, next to `photoGroupFor` below, because the two are inverses
 * of each other and have to agree: the folder opens the checklist, and the
 * checklist files its photos back into that folder. Kept in separate modules
 * they can drift, and a photo filed under a key its vertical does not have
 * disappears into "Other".
 */
export const GROUP_KIND: Record<PhotoGroup, "site" | "install"> = {
  survey: "site",
  install: "install",
  survey_photos: "site",
  install_photos: "install",
};

/**
 * Where a photo taken against a checklist slot is filed — GROUP_KIND inverted,
 * for one vertical.
 *
 * A photo shot for a slot on the Site Survey checklist belongs in that deal's
 * Survey Photos folder, and the folder grid finds it by `FileAsset.category`.
 * Roofing and solar spell that pair of keys differently, so the deal's vertical
 * picks which pair; anything that is not solar is roofing, matching
 * `foldersFor` in deal-folders.ts.
 */
export function photoGroupFor(
  vertical: string | null | undefined,
  kind: "site" | "install",
): PhotoGroup {
  if (vertical === "solar") return kind === "site" ? "survey_photos" : "install_photos";
  return kind === "site" ? "survey" : "install";
}
