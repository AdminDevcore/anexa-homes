import { describe, it, expect } from "vitest";
import { PHOTO_GROUPS, PHOTO_GROUP_KEYS, type PhotoGroup } from "../photo-groups";
import { ROOFING_FOLDERS, SOLAR_FOLDERS } from "../deal-folders";
import { defaultItems, defaultName } from "../../server/modules/photos/defaults";

/**
 * A deal's photo folder picks its checklist with
 * `checklists.find(c => c.kind === GROUP_KIND[folder.key])`, and files it with
 * `FileAsset.category = folder.key`. Both sides therefore depend on every
 * `special: "photos"` folder key — in EITHER vertical — being a known photo
 * group. Solar's two were not, which is why its photo folders rendered as plain
 * file lists with no checklist and no report.
 *
 * GROUP_KIND lives in a "use client" module, so it is re-stated here rather
 * than imported; the assertion below pins the keys it must cover.
 */
const GROUP_KIND: Record<PhotoGroup, "site" | "install"> = {
  survey: "site",
  install: "install",
  survey_photos: "site",
  install_photos: "install",
};

describe("photo groups cover every photo folder", () => {
  it("has a group for each vertical's photo folder keys", () => {
    for (const folders of [ROOFING_FOLDERS, SOLAR_FOLDERS]) {
      const photoKeys = folders.filter((f) => f.special === "photos").map((f) => f.key);
      expect(photoKeys.length).toBe(2);
      for (const key of photoKeys) {
        expect(PHOTO_GROUP_KEYS).toContain(key);
        expect(PHOTO_GROUPS[key as PhotoGroup]).toBeTruthy();
        expect(GROUP_KIND[key as PhotoGroup]).toBeTruthy();
      }
    }
  });

  it("maps each vertical's pair onto one site and one install checklist", () => {
    for (const folders of [ROOFING_FOLDERS, SOLAR_FOLDERS]) {
      const kinds = folders
        .filter((f) => f.special === "photos")
        .map((f) => GROUP_KIND[f.key as PhotoGroup]);
      expect(kinds.sort()).toEqual(["install", "site"]);
    }
  });
});

describe("default checklists", () => {
  it("gives each vertical its own named, non-empty pair", () => {
    for (const v of ["roofing", "solar"] as const) {
      for (const kind of ["site", "install"] as const) {
        expect(defaultName(v, kind).length).toBeGreaterThan(0);
        expect(defaultItems(v, kind).length).toBeGreaterThan(0);
      }
    }
    // Solar photographs a panel and a meter; roofing photographs hail hits.
    // Sharing one list is the thing this replaced.
    expect(defaultItems("solar", "site")).not.toEqual(defaultItems("roofing", "site"));
    expect(defaultName("solar", "site")).not.toBe(defaultName("roofing", "site"));
  });

  it("has no duplicate labels within a checklist, so seeding is idempotent", () => {
    for (const v of ["roofing", "solar"] as const) {
      for (const kind of ["site", "install"] as const) {
        const labels = defaultItems(v, kind).map((i) => i.label.toLowerCase());
        expect(new Set(labels).size).toBe(labels.length);
      }
    }
  });
});
