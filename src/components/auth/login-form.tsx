"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { Loader2, AlertCircle } from "lucide-react";
import { signIn } from "next-auth/react";
import { loginAction, type LoginState } from "@/server/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// The demo quick-login panel. The accounts come from the server (see
// server/auth/demo-accounts.ts) so the list reflects whoever is actually in the
// database and no real email address is baked into this bundle. An empty list —
// which is what production always sends — renders nothing.
const DEMO_PASSWORD = "Passw0rd!";

/** Google's mark, inline so the button needs no network request to render. */
function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.4a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.6-5.2 3.6-8.8z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3a7.2 7.2 0 0 1-10.7-3.8h-4v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.1 7.1 0 0 1 0-4.6v-3.1h-4a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1A7.2 7.2 0 0 1 12 4.8z" />
    </svg>
  );
}

export function LoginForm({
  next,
  googleEnabled = false,
  googleError = null,
  demoAccounts = [],
}: {
  next?: string;
  googleEnabled?: boolean;
  /** A sentence explaining a refused Google sign-in, already resolved. */
  googleError?: string | null;
  /** Quick-login accounts. Always empty in production. */
  demoAccounts?: { email: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    loginAction,
    undefined
  );
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");

  // Full-page navigation on success → discards the client Router Cache so no prior
  // account's cached pages can show for the user who just signed in.
  React.useEffect(() => {
    if (state?.redirectTo) window.location.assign(state.redirectTo);
  }, [state]);

  function fillDemo(demoEmail: string) {
    setEmail(demoEmail);
    setPassword(DEMO_PASSWORD);
  }

  return (
    <div className="space-y-6">
      {/* A refused Google sign-in comes back as a redirect, so it is reported
          here rather than through the form's own action state. */}
      {googleError && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {googleError}
        </div>
      )}

      {googleEnabled && (
        <>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full"
            onClick={() => signIn("google", { callbackUrl: next || "/portal/dashboard" })}
          >
            <GoogleGlyph />
            Continue with Google
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-background px-2 text-xs uppercase tracking-wider text-muted-foreground">
                or
              </span>
            </div>
          </div>
        </>
      )}

      <form action={formAction} className="space-y-4" autoComplete="off">
        {next && <input type="hidden" name="next" value={next} />}

        {state?.error && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            {state.error}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="off"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@anexahomes.com"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link href="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground">
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        <Button
          type="submit"
          size="lg"
          disabled={pending || !!state?.redirectTo}
          className="glass-pill-gold w-full border-0 text-white hover:text-white"
        >
          {pending || state?.redirectTo ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Signing in…
            </>
          ) : (
            "Sign in"
          )}
        </Button>
      </form>

      {demoAccounts.length > 0 && (
        <div className="rounded-xl border border-border bg-muted/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Demo accounts · password <span className="text-foreground">{DEMO_PASSWORD}</span>
          </p>
          <div className="mt-3 grid grid-cols-2 gap-1.5">
            {demoAccounts.map((a) => (
              <button
                key={a.email}
                type="button"
                onClick={() => fillDemo(a.email)}
                className="rounded-md border border-border bg-background px-2.5 py-1.5 text-left text-xs font-medium transition-colors hover:border-gold/40 hover:bg-card"
              >
                {a.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Click an account to fill credentials, then press Sign in.
          </p>
        </div>
      )}
    </div>
  );
}
