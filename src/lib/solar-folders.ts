/**
 * Document folders on a solar deal.
 *
 * Files already carry a `category` string (the roofing photo checklists use the
 * same column), so this is pure arrangement of data we already store — no new
 * table. The folder set is the paperwork a solar job actually generates, in
 * roughly the order it arrives.
 *
 * `internal` folders are never shown to the homeowner in the customer portal.
 */
export type SolarFolder = {
  key: string;
  label: string;
  hint: string;
  internal?: boolean;
};

export const SOLAR_FOLDERS: SolarFolder[] = [
  { key: "contract", label: "Contract", hint: "Signed agreement and any change orders" },
  { key: "utility_bill", label: "Utility Bill", hint: "12 months of usage — the basis for the design" },
  { key: "personal_files", label: "Personal Files", hint: "ID, proof of income, anything the lender asked for" },
  { key: "materials", label: "Materials", hint: "Spec sheets and datasheets for what is going on the roof" },
  { key: "survey_photos", label: "Survey Photos", hint: "Roof, attic, main panel, meter" },
  { key: "engineering", label: "Engineering Plan Sets", hint: "Stamped plan set, single-line, load calc" },
  { key: "permits", label: "Permits", hint: "Applications, corrections, approvals" },
  { key: "interconnection", label: "Interconnection", hint: "Utility application, approval, PTO letter" },
  { key: "install_photos", label: "Installation Photos", hint: "Progress and completion" },
  { key: "other", label: "Other", hint: "Anything that does not fit above" },
  { key: "internal", label: "Internal Documents", hint: "Never shown to the customer", internal: true },
];

export const SOLAR_FOLDER_KEYS = SOLAR_FOLDERS.map((f) => f.key);

export function folderLabel(key: string | null): string {
  return SOLAR_FOLDERS.find((f) => f.key === key)?.label ?? "Other";
}
