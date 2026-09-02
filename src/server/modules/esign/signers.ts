import { prisma } from "@/server/db/client";
import { pickSigner, toResolvedSigner, type ResolvedSigner } from "@/lib/company-signer";
import type { SnapshotSigner } from "./pdf";
import type { SignerForCtx } from "./context";

/**
 * Reading the company's authorised signers — the half of the e-sign module that
 * answers "who signs this for us".
 *
 * Separate from `actions.ts` because the automation engine resolves a signer
 * with NOBODY LOGGED IN, and from `service.ts` because the settings screen
 * needs the list without dragging the sender in. Same reason `context.ts`
 * exists.
 */

/** Every column a resolved signer is built from. */
export const SIGNER_SELECT = {
  id: true,
  name: true,
  title: true,
  email: true,
  phone: true,
  licenseNumber: true,
  credentials: true,
  signatureData: true,
  initialsData: true,
  isDefault: true,
  active: true,
} as const;

export type SignerListRow = ResolvedSigner & { isDefault: boolean; active: boolean };

/**
 * The company's signers, default first, then alphabetical.
 *
 * Company-wide on purpose: a signer is a person, not a workspace setting. See
 * the model comment on CompanySigner.
 *
 * `initialsData` is the RAW column here, not the resolved one. This list feeds
 * the settings screen, which has to be able to show that no initials mark of
 * its own is saved; `toResolvedSigner`'s fallback to the signature is for the
 * send path, where a blank slot on a contract is the worse answer.
 */
export async function listCompanySigners(companyId: string): Promise<SignerListRow[]> {
  const rows = await prisma.companySigner.findMany({
    where: { companyId },
    orderBy: [{ isDefault: "desc" }, { active: "desc" }, { name: "asc" }],
    select: SIGNER_SELECT,
  });
  return rows.map((r) => ({
    ...toResolvedSigner(r),
    initialsData: r.initialsData,
    isDefault: r.isDefault,
    active: r.active,
  }));
}

/**
 * The signer a given template would use, or null when none applies.
 *
 * Reads the whole list and decides in memory rather than querying for the
 * template's signer and then the default: two round trips to answer one
 * question, and the fallback case would need the second anyway.
 */
export async function resolveSignerForTemplate(
  companyId: string,
  templateSignerId: string | null | undefined
): Promise<ResolvedSigner | null> {
  const rows = await prisma.companySigner.findMany({
    where: { companyId, active: true },
    select: SIGNER_SELECT,
  });
  const picked = pickSigner(rows, templateSignerId);
  return picked ? toResolvedSigner(picked) : null;
}

/**
 * The union of every credential line defined on any signer, for the template
 * builder's field picker.
 *
 * The union rather than one signer's, because a template is authored once and
 * may be signed by any of them — offering only the default's lines would hide a
 * token the document actually needs the day somebody else signs it.
 */
export async function signerCredentialCatalog(
  companyId: string
): Promise<{ key: string; label: string }[]> {
  const signers = await listCompanySigners(companyId);
  const seen = new Set<string>();
  const out: { key: string; label: string }[] = [];
  for (const s of signers) {
    for (const c of s.credentials) {
      if (seen.has(c.key)) continue;
      seen.add(c.key);
      out.push({ key: c.key, label: c.label });
    }
  }
  return out;
}

/**
 * The signer half of an autofill context, read back from a package's snapshot.
 *
 * Every PDF a package produces — the signer's preview, the executed copy, the
 * re-download years later — must show the same name, title and licence, so all
 * of them resolve `{{signer.*}}` through this rather than through the live row.
 */
export function signerCtxFromSnapshot(
  snapshot: { companySigner?: SnapshotSigner | null } | null | undefined
): SignerForCtx | undefined {
  const s = snapshot?.companySigner;
  if (!s) return undefined;
  return {
    signer: {
      id: s.id,
      name: s.name,
      title: s.title,
      email: s.email,
      phone: s.phone,
      licenseNumber: s.license,
      credentials: s.credentials,
      // The images were never stored here; nothing that reads a context needs
      // them, because the stamper draws from the field values instead.
      signatureData: null,
      initialsData: null,
    },
    signedOn: new Date(s.signedAt),
  };
}

/** Freeze a resolved signer into the shape a snapshot keeps. */
export function toSnapshotSigner(
  signer: ResolvedSigner,
  at: Date,
  actor: { id: string; name: string } | null
): SnapshotSigner {
  return {
    id: signer.id,
    name: signer.name,
    title: signer.title,
    email: signer.email,
    phone: signer.phone,
    license: signer.licenseNumber,
    credentials: signer.credentials,
    signedAt: at.toISOString(),
    appliedBy: actor?.name ?? null,
    appliedById: actor?.id ?? null,
  };
}
