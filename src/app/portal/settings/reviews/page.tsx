import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { PageHeader } from "@/components/portal/ui";
import { ReviewsManager } from "@/components/portal/reviews-manager";
import {
  getReviewsForAdmin,
  getReviewCounts,
  type AdminReviewFilter,
} from "@/server/modules/reviews/queries";

export const metadata = { title: "Reviews" };

const VALID: AdminReviewFilter[] = ["all", "pending", "approved", "rejected"];

export default async function ReviewsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string }>;
}) {
  const user = await requireUser();
  if (!can(user, "read", "Review")) redirect("/portal/settings");

  const sp = await searchParams;
  const filter: AdminReviewFilter = VALID.includes(sp.filter as AdminReviewFilter)
    ? (sp.filter as AdminReviewFilter)
    : "all";
  const q = (sp.q ?? "").slice(0, 80);

  const [reviews, counts] = await Promise.all([
    getReviewsForAdmin(user.companyId, filter, q),
    getReviewCounts(user.companyId),
  ]);

  return (
    <div className="space-y-6">
      <Link
        href="/portal/settings"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to settings
      </Link>
      <PageHeader
        title="Website Reviews"
        description="Moderate reviews submitted from anexahomes.com. Approved reviews appear on the homepage and the Reviews page; pending ones stay private until you approve them."
      />
      <ReviewsManager
        reviews={reviews}
        counts={counts}
        filter={filter}
        query={q}
        canDelete={can(user, "delete", "Review")}
      />
    </div>
  );
}
