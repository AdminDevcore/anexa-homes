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
 * `solar_layout` is the same kind of key: it is the category
 * `uploadPanelLayoutAction` has always written for the panel-layout drawing.
 * Until this folder existed the key matched nothing in the set, so every
 * drawing the designer produced landed in "Other".
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
  BadgeCheck,
  Camera,
  ClipboardList,
  DraftingCompass,
  FileBadge,
  FileCheck,
  FileSignature,
  FileText,
  Folder,
  Hammer,
  HandCoins,
  LayoutGrid,
  Package,
  Phone,
  Plug,
  PlugZap,
  Receipt,
  ReceiptText,
  ScrollText,
  ShieldCheck,
  Stamp,
  UserRound,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { CONTRACTOR_INVOICE_CATEGORY } from "./contractor-invoice";

export type DealFolder = {
  key: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  /**
   * Opens an existing specialised UI instead of the generic file list:
   * "photos"  → the slot-by-slot checklist with Compile PDF,
   * "calls"   → the one-recording-per-slot QC call uploader,
   * "dropbox" → a letter slot: files go IN and are never listed here again.
   *
   * All three are excluded from the "Move to…" and "Upload a file" destination
   * pickers, because all three own their own uploader. For "dropbox" that
   * exclusion is also a security property — see src/lib/contractor-invoice.ts.
   */
  special?: "photos" | "calls" | "dropbox";
  /**
   * Where e-signature packages land when their template names no folder, and
   * the fallback for a key this vertical does not recognise. Exactly one folder
   * per set carries it — see the assertion in deal-folders.test.ts.
   *
   * Packages are DocumentPackage rows rather than uploads, but a document sent
   * for signature and the countersigned PDF that comes back are the same thing
   * to whoever is looking for it, so they share a folder instead of sitting in
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

/**
 * Solar's folder keys differ from roofing's (`survey_photos` vs `survey`) because
 * they were chosen independently and FileAsset.category stores them verbatim.
 * The two photo folders carry `special: "photos"` for the same reason roofing's
 * do: a site survey and an installation are photographed against a checklist,
 * not dumped into a file list. Without it solar got a bare uploader and the
 * checklist in Settings had no way to reach a job.
 */
export const SOLAR_FOLDERS: DealFolder[] = [
  { key: "proposal", label: "Proposal", hint: "The proposal as presented — the copy of what was sold", icon: FileText },
  { key: "contract", label: "Contract", hint: "Proposals sent for signature, the signed agreement, change orders", icon: FileSignature, hostsPackages: true },
  { key: "utility_bill", label: "Utility Bill", hint: "12 months of usage — the basis for the design", icon: Zap },
  { key: "solar_layout", label: "Panel Layout", hint: "The array as drawn — the picture the proposal shows", icon: LayoutGrid },
  { key: "personal_files", label: "Personal Files", hint: "ID, proof of income, anything the lender asked for", icon: UserRound },
  { key: "materials", label: "Materials", hint: "Spec sheets and datasheets for what is going on the roof", icon: Package },
  { key: "survey_photos", label: "Survey Photos", hint: "Roof, attic, main panel, meter", icon: Camera, special: "photos" },
  { key: "engineering", label: "Engineering Plan Sets", hint: "Stamped plan set, single-line, load calc", icon: DraftingCompass },
  { key: "permits", label: "Permits", hint: "Applications, corrections, approvals", icon: Stamp },
  { key: "signed_final_permit", label: "Signed Final Permit", hint: "The permit card signed off at final inspection", icon: FileBadge },
  { key: "interconnection", label: "Interconnection", hint: "Utility application and approval", icon: Plug },
  { key: "install_photos", label: "Installation Photos", hint: "Progress and completion", icon: Hammer, special: "photos" },
  { key: "certificate_acceptance", label: "Certificate of Acceptance", hint: "Signed off that the system was installed as sold", icon: BadgeCheck },
  { key: CONTRACTOR_INVOICE_CATEGORY, label: "Contractor Invoice", hint: "Drop the contractor's bill here — it is read in Contractor Pay, not on the job", icon: ReceiptText, special: "dropbox" },
  { key: "attestation_payment", label: "Attestation of Customer Payment", hint: "Signed attestation that the amount due was paid", icon: HandCoins },
  { key: "lien_waiver_progress", label: "Conditional Progress Lien Waiver", hint: "Waiver released against a progress payment", icon: FileCheck },
  { key: "lien_waiver_final", label: "Conditional Waiver & Release (Final Payment)", hint: "Waiver released against the final payment", icon: ScrollText },
  { key: "pto", label: "PTO", hint: "Permission to operate — the utility letter that turns the system on", icon: PlugZap },
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

/**
 * The files the folder grid should show.
 *
 * A completed e-signature package stores its countersigned PDF as a FileAsset
 * with category "signed_contract" — a key neither folder set has, so it fell
 * into "Other". Every signed contract ever produced therefore sat filed under
 * "anything that does not fit above" while the Contract folder it belonged to
 * was one tile away.
 *
 * Filing it into Contract would have listed the same document twice: once as
 * the package row, once as a loose PDF. So the file is dropped and the row
 * kept — the row links to the same PDF and carries the signing status a bare
 * file cannot. A signed PDF whose package is gone has no row to stand in for
 * it, so it stays visible in "Other" rather than disappearing.
 */
export function visibleFiles<T extends { id: string }>(
  files: T[],
  packages: { signedFileId: string | null }[],
): T[] {
  const signed = new Set(
    packages.map((p) => p.signedFileId).filter((id): id is string => Boolean(id)),
  );
  return signed.size === 0 ? files : files.filter((f) => !signed.has(f.id));
}

/**
 * The folder keys on this deal that are write-only letter slots.
 *
 * The caller is expected to strip these files BEFORE handing the grid its
 * `files` array — not to hide them in the component. A file the browser was
 * sent is a file the browser has, and "the list doesn't render it" is a
 * different claim from "nobody on this deal can read it". See
 * src/lib/contractor-invoice.ts.
 */
export function dropboxKeys(vertical: string | null | undefined): Set<string> {
  return new Set(
    foldersFor(vertical)
      .filter((f) => f.special === "dropbox")
      .map((f) => f.key),
  );
}

/**
 * Every write-only key in the product, both verticals at once — the set a page
 * must strip by, which is NOT the same question as `dropboxKeys`.
 *
 * The two differ in exactly one case, and it is a live one. Roofing has no
 * Contractor Invoice folder (it files contractor billing under "Invoices &
 * Payments"), but the installer's job page offers the drop box on every job,
 * roofing included. Strip a roofing deal by its OWN folder set and the invoice
 * is not recognised, so it falls into "Other" and is listed on the deal as a
 * link — pointing at a route that then refuses it. A confidential document
 * advertised by name, one 403 away from everyone on the job.
 *
 * So: `dropboxKeys` decides what this vertical's GRID draws; this decides what
 * may reach the browser at all, and the answer never depends on the vertical.
 */
export const ALL_DROPBOX_KEYS: ReadonlySet<string> = new Set(
  [...ROOFING_FOLDERS, ...SOLAR_FOLDERS].filter((f) => f.special === "dropbox").map((f) => f.key),
);

/** Folders a signed document can be filed into. */
export function packageDestinations(vertical: string | null | undefined): DealFolder[] {
  // A photo checklist and a call-recording slot render their own purpose-built
  // UI and hold one kind of thing each. A signed PDF is not that thing, so they
  // are not offered as destinations.
  return foldersFor(vertical).filter((f) => !f.special);
}

/**
 * Which folder each e-signature package belongs in.
 *
 * A template names its destination (`folderKey`) and the package copies it at
 * send time. Two cases fall back to the packages folder — the one flagged
 * `hostsPackages`, which is Contract in both verticals:
 *
 *  - `null`, meaning nobody configured a destination. Every package created
 *    before routing existed is in this state, which is why the column needed no
 *    backfill.
 *  - a key this vertical does not have — a solar folder on a roofing deal, or a
 *    folder deleted from the set since.
 *
 * Note this differs from how a FILE with an unrecognised category falls back.
 * A file lands in "Other", because an unknown category genuinely means "we do
 * not know what this is". A package always came from a template someone set up,
 * so the honest fallback is where packages have always lived, not the drawer of
 * unidentified things.
 */
export function packagesByFolder<T extends { folderKey: string | null }>(
  vertical: string | null | undefined,
  packages: T[],
): Map<string, T[]> {
  const folders = foldersFor(vertical);
  const fallback = folders.find((f) => f.hostsPackages)?.key ?? FALLBACK_FOLDER_KEY;
  const known = new Set(packageDestinations(vertical).map((f) => f.key));

  const map = new Map<string, T[]>();
  for (const p of packages) {
    const key = p.folderKey && known.has(p.folderKey) ? p.folderKey : fallback;
    const bucket = map.get(key);
    if (bucket) bucket.push(p);
    else map.set(key, [p]);
  }
  return map;
}

export function folderLabel(vertical: string | null | undefined, key: string | null): string {
  return foldersFor(vertical).find((f) => f.key === key)?.label ?? "Other";
}
