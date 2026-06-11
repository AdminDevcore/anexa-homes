import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { getSessionUser, dashboardPathForRole } from "@/server/auth/session";

export const metadata: Metadata = { title: "Sign in" };

const PORTAL_COPY: Record<string, { title: string; subtitle: string }> = {
  customer: {
    title: "Customer Login",
    subtitle: "Track your project, view documents, and sign agreements.",
  },
  staff: {
    title: "Staff Login",
    subtitle: "Reps, project managers, crews, and office staff.",
  },
  admin: {
    title: "Admin Login",
    subtitle: "Administrators and owners — full operations access.",
  },
  team: {
    title: "Team Login",
    subtitle: "Sign in to the Anexa Homes team portal.",
  },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ portal?: string; next?: string }>;
}) {
  const { portal, next } = await searchParams;

  const existing = await getSessionUser();
  if (existing) {
    redirect(dashboardPathForRole(existing.role));
  }

  const copy = PORTAL_COPY[portal ?? "team"] ?? PORTAL_COPY.team;

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{copy.title}</h1>
        <p className="mt-2 text-muted-foreground">{copy.subtitle}</p>
      </div>
      <LoginForm next={next} />
    </div>
  );
}
