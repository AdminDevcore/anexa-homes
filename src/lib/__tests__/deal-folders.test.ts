import { describe, expect, it } from "vitest";
import {
  FALLBACK_FOLDER_KEY,
  ROOFING_FOLDERS,
  SOLAR_FOLDERS,
  folderKeyFor,
  folderLabel,
  foldersFor,
} from "../deal-folders";

describe("foldersFor", () => {
  it("gives solar its own set and everything else the roofing set", () => {
    expect(foldersFor("solar")).toBe(SOLAR_FOLDERS);
    expect(foldersFor("roofing")).toBe(ROOFING_FOLDERS);
  });

  it("defaults to roofing for a null or unknown vertical", () => {
    expect(foldersFor(null)).toBe(ROOFING_FOLDERS);
    expect(foldersFor(undefined)).toBe(ROOFING_FOLDERS);
    expect(foldersFor("plumbing")).toBe(ROOFING_FOLDERS);
  });
});

describe.each([
  ["roofing", ROOFING_FOLDERS],
  ["solar", SOLAR_FOLDERS],
])("%s folder set", (_vertical, folders) => {
  it("has unique keys", () => {
    const keys = folders.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("has an Other folder — the fallback every stray file needs", () => {
    expect(folders.some((f) => f.key === FALLBACK_FOLDER_KEY)).toBe(true);
  });

  it("has exactly one internal folder", () => {
    expect(folders.filter((f) => f.internal)).toHaveLength(1);
  });

  it("gives every folder a label, a hint and an icon", () => {
    for (const f of folders) {
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.hint.length).toBeGreaterThan(0);
      expect(f.icon).toBeTruthy();
    }
  });
});

describe("roofing key compatibility", () => {
  // These keys are what the photo checklists and the QC-call slot already
  // write. Renaming one silently orphans every existing file into "Other",
  // which is exactly the regression this test exists to catch.
  it("keeps the photo-checklist and call-slot category keys", () => {
    const keys = ROOFING_FOLDERS.map((f) => f.key);
    expect(keys).toContain("survey");
    expect(keys).toContain("install");
    expect(keys).toContain("qc_call");
  });

  it("routes those keys to their purpose-built UI", () => {
    const byKey = Object.fromEntries(ROOFING_FOLDERS.map((f) => [f.key, f]));
    expect(byKey.survey.special).toBe("photos");
    expect(byKey.install.special).toBe("photos");
    expect(byKey.qc_call.special).toBe("calls");
  });
});

describe("solar key compatibility", () => {
  it("keeps the keys solar deals already wrote", () => {
    const keys = SOLAR_FOLDERS.map((f) => f.key);
    for (const k of [
      "contract",
      "utility_bill",
      "personal_files",
      "materials",
      "survey_photos",
      "engineering",
      "permits",
      "interconnection",
      "install_photos",
      "other",
      "internal",
    ]) {
      expect(keys).toContain(k);
    }
  });
});

describe("folderKeyFor", () => {
  it("keeps a category this vertical recognises", () => {
    expect(folderKeyFor("roofing", "permits")).toBe("permits");
    expect(folderKeyFor("solar", "interconnection")).toBe("interconnection");
  });

  it("sends an uncategorised file to Other", () => {
    expect(folderKeyFor("roofing", null)).toBe(FALLBACK_FOLDER_KEY);
  });

  it("sends an unrecognised category to Other rather than losing it", () => {
    expect(folderKeyFor("roofing", "before")).toBe(FALLBACK_FOLDER_KEY);
    // Cross-vertical keys are not shared: solar's spelling is meaningless here.
    expect(folderKeyFor("roofing", "interconnection")).toBe(FALLBACK_FOLDER_KEY);
    expect(folderKeyFor("solar", "adjuster_scope")).toBe(FALLBACK_FOLDER_KEY);
  });
});

describe("folderLabel", () => {
  it("labels a known key", () => {
    expect(folderLabel("roofing", "adjuster_scope")).toBe("Adjuster Scope");
    expect(folderLabel("solar", "utility_bill")).toBe("Utility Bill");
  });

  it("falls back to Other for null and unknown keys", () => {
    expect(folderLabel("roofing", null)).toBe("Other");
    expect(folderLabel("roofing", "nonsense")).toBe("Other");
  });
});
