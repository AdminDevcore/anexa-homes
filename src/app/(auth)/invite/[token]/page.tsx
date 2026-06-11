import type { Metadata } from "next";
import Link from "next/link";
import { getInvitation } from "@/server/auth/invite";
import { AcceptInviteForm } from "@/components/auth/accept-invite-form";
import { ROLE_LABELS } from "@/lib/roles";

export const metadata: Metadata = { title: "Activate your account" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await getInvitation(token);

  if (!inv.ok) {
    return (
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Invite unavailable</h1>
        <p className="mt-2 text-muted-foreground">{inv.error}</p>
        <Link href="/login" className="mt-6 inline-block text-sm font-medium text-gold-muted hover:underline">Go to sign in →</Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Activate your account</h1>
        <p className="mt-2 text-muted-foreground">
          You&rsquo;ve been invited to join <strong>{inv.company}</strong> as{" "}
          <strong>{(ROLE_LABELS as Record<string, string>)[inv.role] ?? inv.role}</strong>. Set your password to get started.
        </p>
      </div>
      <AcceptInviteForm token={token} email={inv.email} />
    </div>
  );
}
