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

  // The `customer` role cannot sign in, so nothing on a deal is customer-facing
  // and no folder may imply otherwise. A folder called "Internal" only made
  // sense next to folders that were external, and there are none.
  //
  // This matches visibility CLAIMS, not the bare word "customer" — a folder
  // named for a legal document that happens to say customer ("Attestation of
  // Customer Payment") is a document title, not a promise that a homeowner can
  // see it.
  it("claims no customer visibility anywhere", () => {
    for (const f of folders) {
      expect(`${f.key} ${f.label} ${f.hint}`.toLowerCase()).not.toMatch(
        /customer[ _-]?(facing|visible|view|portal|access)|(^|\W)internal(\W|$)|share[d]? with the customer/,
      );
    }
  });

  it("hosts the e-sign packages in exactly one folder", () => {
    expect(folders.filter((f) => f.hostsPackages)).toHaveLength(1);
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
    ]) {
      expect(keys).toContain(k);
    }
  });

  // The completion paperwork the install agreement names, each in its own
  // folder so "where is the signed acceptance?" has one answer. PTO left
  // Interconnection's hint and became a folder of its own for the same reason.
  it("has a folder for every document the install agreement names", () => {
    const keys = SOLAR_FOLDERS.map((f) => f.key);
    for (const k of [
      "proposal",
      "certificate_acceptance",
      "attestation_payment",
      "lien_waiver_progress",
      "lien_waiver_final",
      "pto",
    ]) {
      expect(keys).toContain(k);
    }
  });
});

// The solar install agreement's paperwork is solar's alone. A roofing deal
// must not grow a PTO folder or a lien waiver because someone edited the wrong
// array, and a roofing file that somehow carries one of those categories must
// land in Other rather than conjuring a folder that vertical never had.
describe("solar paperwork stays out of roofing", () => {
  const SOLAR_ONLY = [
    "proposal",
    "certificate_acceptance",
    "attestation_payment",
    "lien_waiver_progress",
    "lien_waiver_final",
    "pto",
  ];

  it("gives roofing none of those folders", () => {
    const keys = ROOFING_FOLDERS.map((f) => f.key);
    for (const k of SOLAR_ONLY) expect(keys).not.toContain(k);
  });

  it("routes those categories to Other on a roofing deal", () => {
    for (const k of SOLAR_ONLY) {
      expect(folderKeyFor("roofing", k)).toBe(FALLBACK_FOLDER_KEY);
      expect(folderKeyFor("solar", k)).toBe(k);
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
