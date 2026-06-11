"use client";

import { useActionState } from "react";
import { Loader2, AlertCircle, MailCheck } from "lucide-react";
import { requestPasswordReset, type ResetRequestState } from "@/server/auth/password-reset";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<ResetRequestState, FormData>(
    requestPasswordReset,
    undefined
  );

  if (state?.ok) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-muted/40 p-8 text-center">
        <MailCheck className="size-10 text-gold" />
        <p className="font-medium">Check your email</p>
        <p className="text-sm text-muted-foreground">
          If an account exists for that address, we&rsquo;ve sent a password reset link.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {state?.error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          {state.error}
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required placeholder="you@anexahomes.com" />
      </div>
      <Button
        type="submit"
        size="lg"
        disabled={pending}
        className="w-full bg-gold text-gold-foreground hover:bg-gold/90"
      >
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Sending…
          </>
        ) : (
          "Send reset link"
        )}
      </Button>
    </form>
  );
}
