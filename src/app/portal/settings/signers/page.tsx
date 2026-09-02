import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { SettingsScreenHeader } from "@/components/portal/settings-kit/screen-header";
import { CompanySignerManager } from "@/components/portal/company-signer-manager";
import { listCompanySigners } from "@/server/modules/esign/signers";

export const dynamic = "force-dynamic";

/**
 * Who signs contracts for us.
 *
 * Company-wide, unlike almost everything else under Settings: a signer is a
 * person, and the same person signs a roof contract and a solar install
 * agreement. Which of them signs a given DOCUMENT is settled on the template,
 * and templates are already per workspace — so the vertical difference is
 * expressed where it belongs and this screen answers the same in both.
 */
export default async function SignersPage({
  searchParams,
}: {
  /**
   * Which signer is open.
   *
   * Read HERE rather than in the browser, for the reason the lenders screen
   * documents: a client that reads `window.location` during hydration renders
   * something the server never did, React calls that a mismatch, and repairs it
   * by throwing the server's markup away.
   */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  const user = await requireUser("/portal/settings/signers");
  if (!can(user, "read", "Settings")) redirect("/portal/dashboard");

  const signers = await listCompanySigners(user.companyId);
  const withMark = signers.filter((s) => s.active && s.signatureData).length;

  return (
    <div className="space-y-5">
      <SettingsScreenHeader
        section="company_signers"
        description={
          <>
            Whoever signs on the company&apos;s behalf, and the signature applied for them. A
            document with a company signature block fills itself when it is sent — nobody has to be
            at a desk. One list for every workspace.
          </>
        }
        pills={
          signers.length > 0 ? (
            <span className="text-xs text-muted-foreground">
              {withMark} of {signers.filter((s) => s.active).length} ready to sign
            </span>
          ) : undefined
        }
      />
      <CompanySignerManager
        signers={signers.map((s) => ({
          id: s.id,
          name: s.name,
          title: s.title,
          email: s.email,
          phone: s.phone,
          licenseNumber: s.licenseNumber,
          credentials: s.credentials,
          signatureData: s.signatureData,
          initialsData: s.initialsData,
          isDefault: s.isDefault,
          active: s.active,
        }))}
        canEdit={can(user, "update", "Settings")}
        initialSignerId={one(params.signer)}
      />
    </div>
  );
}
