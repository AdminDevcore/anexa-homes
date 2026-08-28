import { describe, expect, it } from "vitest";
import {
  FALLBACK_FOLDER_KEY,
  ROOFING_FOLDERS,
  SOLAR_FOLDERS,
  folderKeyFor,
  folderLabel,
  foldersFor,
  packageDestinations,
  packagesByFolder,
  visibleFiles,
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
      "solar_layout",
      "other",
    ]) {
      expect(keys).toContain(k);
    }
  });

  // The panel-layout designer has written `solar_layout` since it shipped, so
  // every drawing ever saved fell into "Other" for want of this one key. It is
  // the same failure as `signed_contract` below, and this is the test that
  // stops the folder being renamed back out from under those files.
  it("files the designer's panel layout in its own folder, not Other", () => {
    expect(folderKeyFor("solar", "solar_layout")).toBe("solar_layout");
    expect(folderLabel("solar", "solar_layout")).toBe("Panel Layout");
  });

  // A drawing is a document a rep opens and reads, not a checklist slot. Giving
  // it `special` would swap the file list for a photo checklist that has no
  // slots to fill.
  it("shows the layout as an ordinary file list", () => {
    expect(SOLAR_FOLDERS.find((f) => f.key === "solar_layout")?.special).toBeUndefined();
  });

  // The completion paperwork the install agreement names, each in its own
  // folder so "where is the signed acceptance?" has one answer. PTO left
  // Interconnection's hint and became a folder of its own for the same reason.
  // Roofing files contractor billing under its broad "Invoices & Payments"
  // folder. Solar keeps the contractor's invoice on its own so it is not mixed
  // in with anything else, which is why the two verticals use different keys.
  it("files the contractor's invoice in its own folder", () => {
    const folder = SOLAR_FOLDERS.find((f) => f.key === "contractor_invoice");
    expect(folder).toBeDefined();
    expect(folder?.special).toBeUndefined();
  });

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

  // The permit APPLICATION and the permit signed off at final inspection are
  // two different documents that arrive months apart, so "Permits" holding both
  // meant nobody could answer "has final passed?" without opening every file.
  it("separates the signed final permit from the permit applications", () => {
    expect(folderKeyFor("solar", "signed_final_permit")).toBe("signed_final_permit");
    expect(folderLabel("solar", "signed_final_permit")).toBe("Signed Final Permit");
    expect(SOLAR_FOLDERS.find((f) => f.key === "signed_final_permit")?.special).toBeUndefined();
    // Still its own folder, not a rename of the application one.
    expect(SOLAR_FOLDERS.map((f) => f.key)).toContain("permits");
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
    "contractor_invoice",
    "attestation_payment",
    "lien_waiver_progress",
    "lien_waiver_final",
    "pto",
    "solar_layout",
    "signed_final_permit",
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

// The countersigned PDF is stored with category "signed_contract", which is in
// neither folder set — so before this it landed in "Other" on every deal, on
// both verticals, while the Contract folder sat one tile away. It is not filed
// into Contract either: the package row already represents it there, and two
// rows for one contract is its own kind of wrong.
describe("visibleFiles", () => {
  const pdf = { id: "f1", category: "signed_contract" };
  const bill = { id: "f2", category: "utility_bill" };

  it("drops the PDF that a package already represents", () => {
    const out = visibleFiles([pdf, bill], [{ signedFileId: "f1" }]);
    expect(out).toEqual([bill]);
  });

  it("leaves every other file alone", () => {
    expect(visibleFiles([bill], [{ signedFileId: "f1" }])).toEqual([bill]);
  });

  it("keeps a signed PDF whose package is gone, rather than hiding it", () => {
    // No row stands in for it, so it must stay reachable — in "Other", where
    // an unrecognised category belongs.
    expect(visibleFiles([pdf], [])).toEqual([pdf]);
    expect(folderKeyFor("solar", pdf.category)).toBe(FALLBACK_FOLDER_KEY);
    expect(folderKeyFor("roofing", pdf.category)).toBe(FALLBACK_FOLDER_KEY);
  });

  it("ignores packages that have not been signed yet", () => {
    expect(visibleFiles([pdf, bill], [{ signedFileId: null }])).toEqual([pdf, bill]);
  });

  it("returns the same list untouched when nothing is signed", () => {
    const files = [pdf, bill];
    expect(visibleFiles(files, [])).toBe(files);
  });
});

describe("packageDestinations", () => {
  it("omits the photo and call folders", () => {
    // Their bodies are a slot checklist and a one-recording-per-slot uploader.
    // Filing a signed PDF into either would render it as a missing photo.
    for (const v of ["roofing", "solar"]) {
      expect(packageDestinations(v).some((f) => f.special)).toBe(false);
    }
    expect(packageDestinations("roofing").map((f) => f.key)).not.toContain("qc_call");
    expect(packageDestinations("roofing").map((f) => f.key)).not.toContain("survey");
  });

  it("keeps every folder a document could legitimately go in", () => {
    const solar = packageDestinations("solar").map((f) => f.key);
    for (const k of ["contract", "certificate_acceptance", "lien_waiver_final", "pto"]) {
      expect(solar).toContain(k);
    }
  });
});

// updateTemplateAction validates a chosen destination with exactly this call,
// so the cross-vertical guard is asserted here rather than by mocking Prisma
// for a single action — there is no server-action test harness in this repo.
describe("destination validation (the guard updateTemplateAction applies)", () => {
  const allows = (vertical: string, key: string) =>
    packageDestinations(vertical).some((f) => f.key === key);

  it("refuses a solar folder on a roofing template", () => {
    expect(allows("roofing", "pto")).toBe(false);
    expect(allows("roofing", "lien_waiver_final")).toBe(false);
    expect(allows("solar", "pto")).toBe(true);
  });

  it("refuses a roofing folder on a solar template", () => {
    expect(allows("solar", "adjuster_scope")).toBe(false);
    expect(allows("roofing", "adjuster_scope")).toBe(true);
  });

  it("refuses a made-up key", () => {
    expect(allows("solar", "'; drop table --")).toBe(false);
    expect(allows("solar", "")).toBe(false);
  });
});

describe("packagesByFolder", () => {
  const pkg = (folderKey: string | null) => ({ folderKey });

  it("files a package where its template said", () => {
    const map = packagesByFolder("solar", [pkg("certificate_acceptance")]);
    expect(map.get("certificate_acceptance")).toHaveLength(1);
    expect(map.get("contract")).toBeUndefined();
  });

  // Everything sent before routing existed has a null key. It must keep landing
  // in Contract, which is why the column needed no backfill.
  it("falls back to Contract when nothing was configured", () => {
    for (const v of ["roofing", "solar"]) {
      expect(packagesByFolder(v, [pkg(null)]).get("contract")).toHaveLength(1);
    }
  });

  // A solar folder key on a roofing deal is not "unidentified" — it came from a
  // template someone set up — so it goes to Contract, not Other.
  it("falls back to Contract for a key this vertical does not have", () => {
    const map = packagesByFolder("roofing", [pkg("pto")]);
    expect(map.get("contract")).toHaveLength(1);
    expect(map.get(FALLBACK_FOLDER_KEY)).toBeUndefined();
  });

  it("never files a package into a photo or call folder", () => {
    const map = packagesByFolder("roofing", [pkg("survey"), pkg("qc_call")]);
    expect(map.get("survey")).toBeUndefined();
    expect(map.get("qc_call")).toBeUndefined();
    expect(map.get("contract")).toHaveLength(2);
  });

  it("groups several packages across several folders", () => {
    const map = packagesByFolder("solar", [
      pkg("contract"),
      pkg("lien_waiver_progress"),
      pkg("lien_waiver_progress"),
      pkg(null),
    ]);
    expect(map.get("contract")).toHaveLength(2);
    expect(map.get("lien_waiver_progress")).toHaveLength(2);
  });
});
