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
