/**
 * Document folders on a deal — the Pipe-style "Cloud storage" grid.
 *
 * Files already carry a `category` string, so this is pure arrangement of data
 * we already store: no new table, no migration. Each folder set is the
 * paperwork that vertical's jobs actually generate, in roughly the order it
 * arrives.
 *
 * THE KEYS ARE LOAD-BEARING. `survey`, `install` and `qc_call` are not new
 * names invented for this grid — they are the exact category values the photo
 * checklists and the QC-call slot have been writing all along. Reusing them is
 * why every photo and recording already on a deal shows up in the right folder
 * the moment this ships. Rename one and you orphan its files into "Other".
 *
 * Solar spells its photo folders `survey_photos` / `install_photos` and roofing
 * spells them `survey` / `install`. That inconsistency is deliberate and
 * harmless: `foldersFor` never mixes the two sets, and each spelling matches
 * what its own vertical already wrote to the database.
 *
 * There is deliberately no "internal" folder and no customer-visibility flag.
 * The `customer` role cannot even sign in (see src/server/auth/config.ts), so
 * there is no customer-facing surface anywhere in the app — every one of these
 * folders is staff-only. Marking one of them "internal" implied the others
 * were visible to a homeowner, which was never true of any of them.
 */
import {
  Camera,
  ClipboardList,
  DraftingCompass,
  FileSignature,
  Folder,
  Hammer,
  Package,
  Phone,
  Plug,
  Receipt,
  ShieldCheck,
  Stamp,
  UserRound,
  Zap,
  type LucideIcon,
} from "lucide-react";

export type DealFolder = {
  key: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  /**
   * Opens an existing specialised UI instead of the generic file list:
   * "photos" → the slot-by-slot checklist with Compile PDF,
   * "calls"  → the one-recording-per-slot QC call uploader.
   */
  special?: "photos" | "calls";
  /**
   * This folder also lists the deal's e-signature packages, above its files.
   * They are DocumentPackage rows rather than uploads, but a proposal sent for
   * signature and the countersigned PDF that comes back are the same thing to
   * whoever is looking for it — so they share one folder instead of sitting in
   * a separate list beside the grid.
   */
  hostsPackages?: boolean;
};

/** The bucket every uncategorised or unrecognised file falls into. */
export const FALLBACK_FOLDER_KEY = "other";

export const ROOFING_FOLDERS: DealFolder[] = [
  { key: "contract", label: "Contract", hint: "Proposals sent for signature, the signed agreement, change orders", icon: FileSignature, hostsPackages: true },
  { key: "insurance_docs", label: "Insurance Documents", hint: "Policy, declarations page, carrier correspondence", icon: ShieldCheck },
  { key: "adjuster_scope", label: "Adjuster Scope", hint: "Carrier scope, estimate, supplements", icon: ClipboardList },
  { key: "survey", label: "Survey Photos", hint: "Roof, elevations, damage — the inspection set", icon: Camera, special: "photos" },
  { key: "install", label: "Install Photos", hint: "Progress and completion", icon: Hammer, special: "photos" },
  { key: "materials", label: "Materials", hint: "Shingle spec, colour selection, material orders", icon: Package },
  { key: "permits", label: "Permits", hint: "Applications, corrections, approvals", icon: Stamp },
  { key: "personal_files", label: "Personal Files", hint: "ID, mortgage docs, W-9", icon: UserRound },
  { key: "invoices", label: "Invoices & Payments", hint: "Certificate of completion, depreciation invoice, receipts", icon: Receipt },
  { key: "qc_call", label: "Call Recordings", hint: "QC call audio", icon: Phone, special: "calls" },
  { key: FALLBACK_FOLDER_KEY, label: "Other", hint: "Anything that does not fit above", icon: Folder },
];

export const SOLAR_FOLDERS: DealFolder[] = [
  { key: "contract", label: "Contract", hint: "Proposals sent for signature, the signed agreement, change orders", icon: FileSignature, hostsPackages: true },
  { key: "utility_bill", label: "Utility Bill", hint: "12 months of usage — the basis for the design", icon: Zap },
  { key: "personal_files", label: "Personal Files", hint: "ID, proof of income, anything the lender asked for", icon: UserRound },
  { key: "materials", label: "Materials", hint: "Spec sheets and datasheets for what is going on the roof", icon: Package },
  { key: "survey_photos", label: "Survey Photos", hint: "Roof, attic, main panel, meter", icon: Camera },
  { key: "engineering", label: "Engineering Plan Sets", hint: "Stamped plan set, single-line, load calc", icon: DraftingCompass },
  { key: "permits", label: "Permits", hint: "Applications, corrections, approvals", icon: Stamp },
  { key: "interconnection", label: "Interconnection", hint: "Utility application, approval, PTO letter", icon: Plug },
  { key: "install_photos", label: "Installation Photos", hint: "Progress and completion", icon: Hammer },
  { key: FALLBACK_FOLDER_KEY, label: "Other", hint: "Anything that does not fit above", icon: Folder },
];

/** The folder set for a deal, chosen by its vertical. Roofing is the default. */
export function foldersFor(vertical: string | null | undefined): DealFolder[] {
  return vertical === "solar" ? SOLAR_FOLDERS : ROOFING_FOLDERS;
}

/**
 * Which folder a file belongs in. A category that is null, or that this
 * vertical does not recognise, lands in "Other" — so a file is always in
 * exactly one folder and nothing is ever invisible.
 */
export function folderKeyFor(vertical: string | null | undefined, category: string | null): string {
  if (!category) return FALLBACK_FOLDER_KEY;
  return foldersFor(vertical).some((f) => f.key === category) ? category : FALLBACK_FOLDER_KEY;
}

export function folderLabel(vertical: string | null | undefined, key: string | null): string {
  return foldersFor(vertical).find((f) => f.key === key)?.label ?? "Other";
}
