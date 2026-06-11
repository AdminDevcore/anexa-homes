// Deal-level photo groups. Photos are tagged via FileAsset.category = the group
// key, so Survey and Install/Roof photos stay separate and compile separately.

export type PhotoGroup = "survey" | "install";

export const PHOTO_GROUPS: Record<PhotoGroup, { label: string; reportSection: string }> = {
  survey: { label: "Survey", reportSection: "Survey Photos" },
  install: { label: "Install Photos", reportSection: "Roof / Install Photos" },
};

export const PHOTO_GROUP_KEYS: PhotoGroup[] = ["survey", "install"];
