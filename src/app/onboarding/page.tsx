import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { getMyOnboarding } from "@/server/modules/onboarding/queries";
import { OnboardingWizard } from "@/components/portal/onboarding-wizard";

export const metadata: Metadata = { title: "Welcome — Onboarding" };

export default async function OnboardingPage() {
  const user = await requireUser();
  const data = await getMyOnboarding(user.userId);
  if (data?.completedAt) redirect("/portal/dashboard");
  const me = await prisma.user.findUnique({ where: { id: user.userId }, select: { phone: true } });

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-4 py-10">
      <div className="mb-8">
        <p className="text-sm font-medium text-gold-muted">Welcome, {user.firstName} 👋</p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Let&rsquo;s finish setting up your profile</h1>
        <p className="mt-2 text-muted-foreground">
          We need a few details to set up payroll and your 1099. Your SSN and bank account are encrypted and only visible to you and accounting.
        </p>
      </div>
      <OnboardingWizard initial={data} firstName={user.firstName} lastName={user.lastName} phone={me?.phone ?? ""} />
    </div>
  );
}
