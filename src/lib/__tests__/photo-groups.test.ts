import { describe, it, expect } from "vitest";
import {
  GROUP_KIND,
  PHOTO_GROUPS,
  PHOTO_GROUP_KEYS,
  photoGroupFor,
  type PhotoGroup,
} from "../photo-groups";
import { ROOFING_FOLDERS, SOLAR_FOLDERS, folderKeyFor, FALLBACK_FOLDER_KEY } from "../deal-folders";
import { defaultItems, defaultName } from "../../server/modules/photos/defaults";

/**
 * A deal's photo folder picks its checklist with
 * `checklists.find(c => c.kind === GROUP_KIND[folder.key])`, and files it with
 * `FileAsset.category = folder.key`. Both sides therefore depend on every
 * `special: "photos"` folder key — in EITHER vertical — being a known photo
 * group. Solar's two were not, which is why its photo folders rendered as plain
 * file lists with no checklist and no report.
 */

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

/**
 * The round trip that puts a checklist photo in its folder.
 *
 * `uploadFileAction` stamps `category = photoGroupFor(vertical, slot's kind)`;
 * the folder grid then finds it with `folderKeyFor(vertical, category)`. If
 * those two ever disagree the photo does not go missing loudly — it quietly
 * lands in "Other" while the folder it belongs to reads 0, which is exactly the
 * bug this pair replaced (the label was being written into `category`).
 */
describe("filing a checklist photo", () => {
  it("files into a real folder of the deal's own vertical", () => {
    for (const [vertical, folders] of [
      ["roofing", ROOFING_FOLDERS],
      ["solar", SOLAR_FOLDERS],
    ] as const) {
      for (const kind of ["site", "install"] as const) {
        const group = photoGroupFor(vertical, kind);
        // Filed where the grid will look for it, not in the fallback drawer.
        expect(folderKeyFor(vertical, group)).toBe(group);
        expect(folderKeyFor(vertical, group)).not.toBe(FALLBACK_FOLDER_KEY);
        // And that folder is the one that opens this very checklist back up.
        const folder = folders.find((f) => f.key === group);
        expect(folder?.special).toBe("photos");
        expect(GROUP_KIND[group]).toBe(kind);
      }
    }
  });

  it("treats any non-solar vertical as roofing, matching foldersFor", () => {
    for (const v of [null, undefined, "roofing", "something-new"]) {
      expect(photoGroupFor(v, "site")).toBe("survey");
      expect(photoGroupFor(v, "install")).toBe("install");
    }
  });

  it("keeps the two verticals' keys distinct", () => {
    expect(photoGroupFor("solar", "site")).toBe("survey_photos");
    expect(photoGroupFor("solar", "install")).toBe("install_photos");
    // A solar key on a roofing deal is not a roofing folder, and vice versa —
    // which is why the vertical has to be read off the deal, not assumed.
    expect(folderKeyFor("roofing", "survey_photos")).toBe(FALLBACK_FOLDER_KEY);
    expect(folderKeyFor("solar", "survey")).toBe(FALLBACK_FOLDER_KEY);
  });
});
