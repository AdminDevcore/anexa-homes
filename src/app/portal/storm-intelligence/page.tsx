import { redirect } from "next/navigation";

// Storm Intelligence was merged into the Field Map (its tools are tabs there:
// Storm leads / Address checker / Storm zones). Old links/bookmarks land there.
// The /export and /pdf sub-routes still work independently.
export default function StormIntelligencePage() {
  redirect("/portal/canvassing");
}
