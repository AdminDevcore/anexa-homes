import { PageSkeleton } from "@/components/portal/page-skeleton";

/**
 * The portal-wide fallback. One file covers every route under /portal that
 * does not ship a closer-fitting skeleton of its own, so no navigation in the
 * CRM is ever silent.
 */
export default function PortalLoading() {
  return <PageSkeleton />;
}
