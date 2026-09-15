import { redirect } from "next/navigation";

// Projects merged into the deal/pipeline. The pipeline List view is the deal list.
export const metadata = { title: "Projects" };

export default function ProjectsPage() {
  redirect("/portal/pipeline");
}
