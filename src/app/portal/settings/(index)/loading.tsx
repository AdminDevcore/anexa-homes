import { PageSkeleton } from "@/components/portal/page-skeleton";

/**
 * The settings LIST only — in a route group so this boundary cannot reach settings/[id], which must stay able to answer 404.
 *
 * The portal-wide `loading.tsx` had to go: a Suspense boundary flushes the
 * shell — and the 200 status with it — before anything beneath it can call
 * `notFound()`, which is what made a record nobody may see render as blank
 * chrome instead of a 404. Skeletons live per-segment now, only where they
 * cannot cover a route that refuses by id.
 *
 * src/lib/__tests__/not-found-boundary.test.ts fails the build if one ever does.
 */
export default function SettingsIndexLoading() {
  return <PageSkeleton />;
}
