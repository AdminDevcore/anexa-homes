import { redirect } from "next/navigation";

// /portal has no page of its own — it's the dashboard. Redirect so any link to
// "/portal" (onboarding completion, login default, bookmarks) lands correctly
// instead of 404ing.
export default function PortalIndex() {
  redirect("/portal/dashboard");
}
