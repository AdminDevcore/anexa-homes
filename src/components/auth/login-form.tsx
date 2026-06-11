"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { Loader2, AlertCircle } from "lucide-react";
import { loginAction, type LoginState } from "@/server/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Demo accounts (with the shared password) are only shown when explicitly enabled.
// Keep NEXT_PUBLIC_DEMO_MODE unset in production so this block is stripped.
const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

const DEMO_ACCOUNTS = [
  { label: "Owner (Super Admin)", email: "owner@anexahomes.com" },
  { label: "Admin", email: "admin@anexahomes.com" },
  { label: "Sales Manager", email: "manager@anexahomes.com" },
  { label: "Sales Rep", email: "rep@anexahomes.com" },
  { label: "Canvasser", email: "canvasser@anexahomes.com" },
  { label: "Marketing", email: "marketing@anexahomes.com" },
  { label: "Installer / Crew", email: "installer@anexahomes.com" },
  { label: "Accounting", email: "accounting@anexahomes.com" },
];

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    loginAction,
    undefined
  );
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");

  function fillDemo(demoEmail: string) {
    setEmail(demoEmail);
    setPassword("Passw0rd!");
  }

  return (
    <div className="space-y-6">
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
          disabled={pending}
          className="glass-pill-gold w-full border-0 text-white hover:text-white"
        >
          {pending ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Signing in…
            </>
          ) : (
            "Sign in"
          )}
        </Button>
      </form>

      {DEMO_MODE && (
        <div className="rounded-xl border border-border bg-muted/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Demo accounts · password <span className="text-foreground">Passw0rd!</span>
          </p>
          <div className="mt-3 grid grid-cols-2 gap-1.5">
            {DEMO_ACCOUNTS.map((a) => (
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
