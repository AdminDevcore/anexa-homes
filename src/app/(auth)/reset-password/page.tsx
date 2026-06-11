import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = { title: "Set a new password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <div className="text-center">
        <h1 className="font-display text-2xl font-semibold">Invalid reset link</h1>
        <p className="mt-2 text-muted-foreground">
          This link is missing a token.{" "}
          <Link href="/forgot-password" className="font-medium text-foreground hover:underline">
            Request a new one
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Set a new password</h1>
        <p className="mt-2 text-muted-foreground">Choose a strong password for your account.</p>
      </div>
      <ResetPasswordForm token={token} />
    </div>
  );
}
