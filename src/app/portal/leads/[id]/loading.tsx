import { PageSkeleton } from "@/components/portal/page-skeleton";

/** The deal page is the heaviest read in the app, and the one reps open most. */
export default function DealLoading() {
  return <PageSkeleton layout="detail" />;
}
