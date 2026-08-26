"use client";

import * as React from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/server/auth/actions";

/**
 * Sign out from a page that has no portal chrome (onboarding). Without this the
 * onboarding gate is a dead end: /portal/* redirects here and /login bounces a
 * signed-in user back to /portal, so there is no way to reach another account.
 */
export function SignOutButton({ label = "Sign out" }: { label?: string }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await logoutAction();
        } finally {
          // Full-page load so the Router Cache is discarded for the next user.
          window.location.assign("/login");
        }
      }}
      className="text-muted-foreground"
    >
      <LogOut className="size-4" />
      {label}
    </Button>
  );
}
